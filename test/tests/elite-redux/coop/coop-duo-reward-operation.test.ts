/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op REWARD SHOP through the AUTHORITATIVE OPERATION PRIMITIVE
// (Wave-2d run-state migration; docs/plans/2026-07-10-coop-authoritative-run-state-migration.md
// §2.5 item 3, §5.1). SURFACE 3 - the highest-traffic interaction (where #861 lived).
// The migrated path proof obligation (§5.3):
//
//   1. END-TO-END (flag ON): a FULL reward round on the migrated path. The OWNER picks a
//      PARTY-TARGET reward (a held item whose party-slot SUB-PICK is folded into the ONE
//      reward operation - the multi-step op payload, §8.2); the WATCHER adopts it THROUGH the
//      operation primitive; both leave. Both real engines converge (the modifier is granted on
//      both) - proof the gate adopts a legitimate stream with the flag ON.
//   2. ADVERSARIAL (the classes the operation model makes structurally impossible):
//      a. #861 STALE-BUFFERED choice: a pick from a strictly-EARLIER interaction, arriving after a
//         newer one resolved, is REJECTED - never applied (the cross-interaction late-rejection).
//      b. LATE-AFTER-LEAVE: a choice for an interaction the watcher already LEFT is REJECTED (the
//         late-choice-after-leave shape - a stale buffered pick can never satisfy a completed op).
//      c. #866 CONTINUATION identity: a second action on the SAME pinned interaction (a move-learn
//         continuation copy re-opening the shop) is ADOPTED - its operation identity SURVIVES the
//         copy, it is not orphaned/rejected as stale. This is exactly the #866 unpinned-orphan class,
//         made impossible because the op-id derives from the inherited interaction pin.
//
// The rejections are THEMSELVES proof the primitive is active: with the flag OFF the watcher would
// adopt every relayed action verbatim (legacy pass-through). The companion suites
// coop-duo-reward-items/-reroll/-subpickers prove the surface stays green under BOTH flag states;
// this suite proves the NEW behavior the flag turns on.
//
// HOW TO RUN (gated ER_SCENARIO=1):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-reward-operation.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { parseCoopOperationId } from "#data/elite-redux/coop/coop-operation-envelope";
import { createCoopRuntimeOpState, setActiveCoopRuntimeOpState } from "#data/elite-redux/coop/coop-operation-runtime";
import {
  adoptRewardWatcherChoice,
  COOP_REWARD_ACTION_STRIDE,
  commitRewardOwnerIntent,
  isCoopRewardOperationEnabled,
  resetCoopRewardOperationFlag,
  resetCoopRewardOperationState,
  setCoopRewardOperationEnabled,
} from "#data/elite-redux/coop/coop-reward-operation";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import {
  beginRewardShopWatch,
  buildDuo,
  type DuoRig,
  driveGuestReplayTurn,
  driveGuestRewardWatch,
  driveHostPartyRewardOwner,
  forceItemRewards,
  installDuoLogCapture,
  reachQueuedRewardShop,
  type ShopPhaseSeam,
  withClient,
} from "#test/tools/coop-duo-harness";
import { wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Flip a freshly-built scene into the co-op game mode (shared by host + guest). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)("co-op DUO reward shop via the operation primitive (Wave-2d)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    // Explicitly select the MIGRATED path and start from clean operation state (no leftover from a prior file).
    setCoopRewardOperationEnabled(true);
    resetCoopRewardOperationState();
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`reward-op-${Date.now()}`);
    game.override
      .battleStyle("double")
      .startingWave(1)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(1)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(50)
      .moveset([MoveId.TACKLE, MoveId.SPLASH])
      .disableTrainerWaves();
  });

  afterEach(() => {
    resetCoopRewardOperationFlag();
    resetCoopRewardOperationState();
    logs.dispose();
    clearCoopRuntime();
    // harness-citizenship: restore the host GameManager scene (buildDuo builds a 2nd BattleScene).
    initGlobalScene(game.scene);
  });

  afterAll(() => {
    // best-effort
  });

  /** Wire the guest's OWN-slot command answer (the genuine production CoopBattleSync relay). */
  function wireGuestCommand(rig: DuoRig): void {
    rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
      command: Command.FIGHT,
      cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
      moveId: MoveId.TACKLE,
      targets: [BattlerIndex.ENEMY_2],
    }));
  }

  /** Install the one logical guest runtime modeled by the direct watcher-gate adversarial cases. */
  function installDirectGuestRewardRuntime(): void {
    setActiveCoopRuntimeOpState(createCoopRuntimeOpState("guest"));
    resetCoopRewardOperationState();
  }

  function installDirectRewardRuntime(role: "host" | "guest"): void {
    setActiveCoopRuntimeOpState(createCoopRuntimeOpState(role));
    resetCoopRewardOperationState();
  }

  /** Drive ONE host wave to a win (both player slots FIGHT the frail enemies) under the host ctx. */
  async function hostPlayWave(rig: DuoRig): Promise<void> {
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
      game.move.select(MoveId.TACKLE, COOP_GUEST_FIELD_INDEX, BattlerIndex.ENEMY_2);
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });
  }

  // =====================================================================================
  // 1. END-TO-END: a full reward round with a party-target sub-pick, adopted through the primitive.
  // =====================================================================================
  it("END-TO-END: owner picks a party-target reward (folded sub-pick), watcher ADOPTS through the primitive; both converge", async () => {
    expect(isCoopRewardOperationEnabled(), "the migrated reward-operation path is active for this test").toBe(true);

    // Wave 1 (host-owned, even counter) forces a LEFTOVERS held item: a PARTY-TARGET reward whose party-slot
    // choice is a NESTED sub-pick folded into the ONE reward operation (the multi-step op payload). No level
    // change -> no downstream move-learn, so the round is a clean single interaction.
    const SLOT = 0;
    forceItemRewards(game.override, [{ name: "LEFTOVERS" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    wireGuestCommand(rig);

    const turn = rig.hostScene.currentBattle.turn;
    await hostPlayWave(rig);
    await withClient(rig.guestCtx, async () => {
      await driveGuestReplayTurn(rig.guestScene, turn);
    });

    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    expect(counterBefore % 2, "wave 1 reward is host-owned (even counter)").toBe(0);

    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("SelectModifierPhase", false);
    });
    const hostShop = rig.hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
    expect(hostShop.phaseName, "host reached SelectModifierPhase").toBe("SelectModifierPhase");
    const guestShop = await withClient(rig.guestCtx, () => reachQueuedRewardShop(rig.guestScene));

    const hostModsBefore = rig.hostScene.modifiers.length;
    const guestModsBefore = rig.guestScene.modifiers.length;

    // OWNER drives the party-target sub-pick (its openModifierMenu PARTY open is auto-answered with SLOT,
    // firing the GENUINE owner relay AND the dual-run operation commit). WATCHER adopts THROUGH the primitive.
    // V2 reciprocal shop rendezvous: park the watcher at shop:<wave>:<counter> BEFORE the owner commits so
    // the commit is admitted (not refused into a shared-session terminal), then drain its relayed terminal.
    await withClient(rig.guestCtx, () => beginRewardShopWatch(guestShop));
    await withClient(rig.hostCtx, () => driveHostPartyRewardOwner(hostShop, { slot: SLOT }));
    await withClient(rig.guestCtx, () => driveGuestRewardWatch(guestShop, { alreadyStarted: true }));

    // THE CONVERGENCE: the held item was granted on the OWNER engine AND mirrored on the WATCHER's (the
    // relayed pick adopted through the migrated gate applied against the identical pool). Counter lockstep.
    expect(rig.hostScene.modifiers.length, "host granted the held item").toBe(hostModsBefore + 1);
    expect(rig.guestScene.modifiers.length, "guest ADOPTED the grant through the primitive (no desync)").toBe(
      guestModsBefore + 1,
    );
    expect(rig.hostRuntime.controller.interactionCounter(), "host advanced the counter once").toBe(counterBefore + 1);
    expect(rig.guestRuntime.controller.interactionCounter(), "guest advanced the counter once").toBe(counterBefore + 1);
    logs.flush();
  }, 300_000);

  it("DURABILITY: dropping only the reward relay still applies the committed party-target action on the guest", async () => {
    expect(isCoopRewardOperationEnabled(), "the migrated reward-operation path is active for this test").toBe(true);

    const SLOT = 0;
    forceItemRewards(game.override, [{ name: "LEFTOVERS" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      {
        drop: 1,
        reorder: 0,
        delay: 0,
        faultable: msg => msg.t === "interactionChoice" && msg.kind === "reward",
      },
      { seed: 0x5e7a2d },
    );
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    wireGuestCommand(rig);

    const turn = rig.hostScene.currentBattle.turn;
    await hostPlayWave(rig);
    await withClient(rig.guestCtx, async () => {
      await driveGuestReplayTurn(rig.guestScene, turn);
    });

    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    expect(counterBefore % 2, "wave 1 reward is host-owned (even counter)").toBe(0);
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("SelectModifierPhase", false);
    });
    const hostShop = rig.hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
    const guestShop = await withClient(rig.guestCtx, () => reachQueuedRewardShop(rig.guestScene));
    const guestModsBefore = rig.guestScene.modifiers.length;

    await withClient(rig.guestCtx, () => beginRewardShopWatch(guestShop));
    await withClient(rig.hostCtx, () => driveHostPartyRewardOwner(hostShop, { slot: SLOT }));
    expect(pair.faultsInjected(), "the legacy reward action must actually be dropped").toBeGreaterThan(0);
    await withClient(rig.guestCtx, () => driveGuestRewardWatch(guestShop, { alreadyStarted: true }));

    expect(
      rig.guestScene.modifiers.length,
      "the journal-delivered committed action, including its nested party sub-pick, mutates live guest state",
    ).toBe(guestModsBefore + 1);
    expect(rig.guestRuntime.controller.interactionCounter(), "the durable terminal advances the guest once").toBe(
      counterBefore + 1,
    );
    logs.flush();
  }, 300_000);

  // =====================================================================================
  // 2. ADVERSARIAL: the stale / late / continuation classes, driving the watcher gate directly.
  //    With the flag OFF every one of these would adopt verbatim (legacy pass-through), so the
  //    rejections/adoptions below are proof the primitive is gating adoption (invariants 5, 6, §1.6).
  //    Host-owned EVEN interactions -> the GUEST watches (localRole "guest").
  // =====================================================================================
  it("ADVERSARIAL runtime guard: a watcher without its owning runtime fails loud instead of falling back", () => {
    setActiveCoopRuntimeOpState(null);

    expect(() =>
      adoptRewardWatcherChoice({
        surface: "reward",
        pinned: 2,
        action: { choice: 0, data: [1, 0, 0, 0] },
        terminal: false,
        localRole: "guest",
        wave: 11,
      }),
    ).toThrow(/no runtime installed for surface=reward/);
    logs.flush();
  });

  it("ADVERSARIAL a: a STALE buffered pick from a strictly-EARLIER interaction is REJECTED (#861 shape)", () => {
    installDirectGuestRewardRuntime();
    const LATER = 6; // even -> host owns, guest watches
    const EARLIER = 4; // an EARLIER host-owned interaction

    // A newer interaction resolves on the watcher first (a shop buy).
    const fresh = adoptRewardWatcherChoice({
      surface: "reward",
      pinned: LATER,
      action: { choice: 0, data: [1 /* COOP_ACT_SHOP */, 0, 0, 0] },
      terminal: false,
      localRole: "guest",
      wave: 11,
    });
    expect(fresh.adopt, "the newer interaction's action is adopted").toBe(true);

    // The STALE action from the EARLIER interaction now arrives late - it MUST be rejected, never applied.
    const stale = adoptRewardWatcherChoice({
      surface: "reward",
      pinned: EARLIER,
      action: { choice: 1, data: [1, 0, 0, 0] },
      terminal: false,
      localRole: "guest",
      wave: 11,
    });
    expect(stale.adopt, "the stale earlier-interaction pick is REJECTED (#861 shape)").toBe(false);
    if (stale.adopt === false) {
      expect(stale.reason).toBe("stale-or-late");
    }
    logs.flush();
  });

  it("ADVERSARIAL b: a LATE choice for an interaction the watcher already LEFT is REJECTED", () => {
    installDirectGuestRewardRuntime();
    const START = 8; // even -> host owns, guest watches

    // Adopt a buy, then the LEAVE terminal for interaction START.
    const buy = adoptRewardWatcherChoice({
      surface: "reward",
      pinned: START,
      action: { choice: 0, data: [1, 0, 0, 0] },
      terminal: false,
      localRole: "guest",
      wave: 11,
    });
    expect(buy.adopt, "the buy is adopted").toBe(true);
    const leave = adoptRewardWatcherChoice({
      surface: "reward",
      pinned: START,
      action: { choice: -1 /* COOP_INTERACTION_LEAVE */, data: undefined },
      terminal: true,
      localRole: "guest",
      wave: 11,
    });
    expect(leave.adopt, "the LEAVE terminal is adopted").toBe(true);

    // A late buffered choice for the interaction we already LEFT must be rejected, never applied.
    const late = adoptRewardWatcherChoice({
      surface: "reward",
      pinned: START,
      action: { choice: 2, data: [1, 0, 0, 0] },
      terminal: false,
      localRole: "guest",
      wave: 11,
    });
    expect(late.adopt, "a late choice after the interaction LEFT is REJECTED").toBe(false);
    if (late.adopt === false) {
      expect(late.reason).toBe("stale-or-late");
    }
    logs.flush();
  });

  it("ADVERSARIAL P36: leaving surface A does not reject surface B at the same Mystery pin", () => {
    installDirectGuestRewardRuntime();
    const START = 12;
    const firstSurface = { surfaceId: "modifier:me:graves:0", ordinal: 0 } as const;
    const secondSurface = { surfaceId: "modifier:me:graves:1", ordinal: 1 } as const;

    const firstLeave = adoptRewardWatcherChoice({
      surface: "reward",
      rewardSurface: firstSurface,
      pinned: START,
      action: { choice: -1, rewardSurface: firstSurface },
      terminal: true,
      localRole: "guest",
      wave: 11,
    });
    expect(firstLeave.adopt, "surface A terminal is adopted").toBe(true);

    const secondAction = adoptRewardWatcherChoice({
      surface: "reward",
      rewardSurface: secondSurface,
      pinned: START,
      action: { choice: 0, data: [0], rewardSurface: secondSurface },
      terminal: false,
      localRole: "guest",
      wave: 11,
    });
    expect(secondAction.adopt, "surface B owns an independent same-pin ordinal and terminal fence").toBe(true);

    const lateFirstAction = adoptRewardWatcherChoice({
      surface: "reward",
      rewardSurface: firstSurface,
      pinned: START,
      action: { choice: 1, data: [0], rewardSurface: firstSurface },
      terminal: false,
      localRole: "guest",
      wave: 11,
    });
    expect(lateFirstAction).toEqual({ adopt: false, reason: "stale-or-late" });
    logs.flush();
  });

  it.each([
    { ownerRole: "host", watcherRole: "guest", pinned: 14, order: ["reward", "market", "reward"] },
    { ownerRole: "host", watcherRole: "guest", pinned: 14, order: ["market", "reward", "market"] },
    { ownerRole: "guest", watcherRole: "host", pinned: 15, order: ["reward", "market", "reward"] },
    { ownerRole: "guest", watcherRole: "host", pinned: 15, order: ["market", "reward", "market"] },
  ] as const)("ADVERSARIAL stream parity: $ownerRole owner and $watcherRole watcher agree for same-pin $order", ({
    ownerRole,
    watcherRole,
    pinned,
    order,
  }) => {
    installDirectRewardRuntime(ownerRole);
    const ownerIds = order.map(surface => {
      const committed = commitRewardOwnerIntent({
        surface,
        pinned,
        label: surface === "reward" ? "reward" : "biomeShop",
        choice: 0,
        data: surface === "reward" ? [0] : undefined,
        terminal: false,
        localRole: ownerRole,
        wave: 11,
      });
      if (committed == null) {
        throw new Error(`owner did not mint ${surface} operation`);
      }
      return committed.operationId;
    });

    installDirectRewardRuntime(watcherRole);
    const watcherIds = order.map(surface => {
      const adopted = adoptRewardWatcherChoice({
        surface,
        pinned,
        action: {
          label: surface === "reward" ? "reward" : "biomeShop",
          choice: 0,
          data: surface === "reward" ? [0] : undefined,
        },
        terminal: false,
        localRole: watcherRole,
        wave: 11,
      });
      if (!adopted.adopt || adopted.operationId == null) {
        throw new Error(`watcher did not address ${surface} operation: ${JSON.stringify(adopted)}`);
      }
      return adopted.operationId;
    });

    expect(watcherIds, "owner and watcher derive the same operation ids in the same surface order").toEqual(ownerIds);
    expect(
      ownerIds.map(id => parseCoopOperationId(id)?.pinnedSeq),
      "each operation class has an independent ordinal and returning to the first stream advances without reuse",
    ).toEqual([
      pinned * COOP_REWARD_ACTION_STRIDE,
      pinned * COOP_REWARD_ACTION_STRIDE,
      pinned * COOP_REWARD_ACTION_STRIDE + 1,
    ]);
    expect(
      ownerIds.map(id => parseCoopOperationId(id)?.kind),
      "the equal numeric address remains disambiguated by the canonical operation class",
    ).toEqual(order.map(surface => (surface === "reward" ? "REWARD" : "SHOP_BUY")));
    logs.flush();
  });

  it("ADVERSARIAL c: a CONTINUATION action on the SAME pinned interaction KEEPS its operation identity (#866)", () => {
    installDirectGuestRewardRuntime();
    const START = 10; // even -> host owns, guest watches

    // The owner buys a TM (a continuation-class reward): the watcher adopts the first action...
    const tmBuy = adoptRewardWatcherChoice({
      surface: "reward",
      pinned: START,
      action: { choice: 0, data: [0 /* COOP_ACT_REWARD */, 1 /* slot */, 3 /* move sub-pick */] },
      terminal: false,
      localRole: "guest",
      wave: 11,
    });
    expect(tmBuy.adopt, "the TM buy is adopted").toBe(true);

    // ...then the move-learn CONTINUATION copy re-opens the SAME shop on the ALREADY-PINNED interaction and
    // relays another action. Because the op-id derives from the INHERITED interaction pin (not a raw counter),
    // this is NOT orphaned/rejected as stale - the operation identity SURVIVES the copy (the #866 fix).
    const continuation = adoptRewardWatcherChoice({
      surface: "reward",
      pinned: START,
      action: { choice: -1 /* COOP_INTERACTION_LEAVE */, data: undefined },
      terminal: true,
      localRole: "guest",
      wave: 11,
    });
    expect(continuation.adopt, "the continuation action on the SAME interaction is ADOPTED, not orphaned (#866)").toBe(
      true,
    );

    // Sanity: a NEWER interaction still advances cleanly (the watermark climbed past START, not stuck on it).
    const next = adoptRewardWatcherChoice({
      surface: "reward",
      pinned: START + 2,
      action: { choice: 0, data: [1, 0, 0, 0] },
      terminal: false,
      localRole: "guest",
      wave: 11,
    });
    expect(next.adopt, "a subsequent interaction adopts cleanly").toBe(true);
    logs.flush();
  });
});
