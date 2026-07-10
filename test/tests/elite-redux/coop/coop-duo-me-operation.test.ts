/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op MYSTERY ENCOUNTERS through the AUTHORITATIVE OPERATION PRIMITIVE
// (Wave-2c run-state migration; docs/plans/2026-07-10-coop-authoritative-run-state-migration.md
// §2.5 item 2, §5.1/§5.3). The migrated-path proof obligation:
//
//   1. END-TO-END, all THREE authoritative ME legs (flag ON): a full ME each of
//      - HOST-OWNED non-battle (DEPARTMENT_STORE_SALE): the guest's terminal is gated through
//        the operation primitive and adopts a host-stated terminal "leave".
//      - GUEST-OWNED non-battle (DEPARTMENT_STORE_SALE, odd counter): the guest mints an
//        ME_PICK intent; the HOST commits it (invariant 3).
//      - BATTLE-HANDOFF (FIGHT_OR_FLIGHT opt 1): the committed terminal STATES "battle" BEFORE
//        the guest builds its ME-battle phases - the #859/#860 phantom-turn structural cure.
//   2. ADVERSARIAL (engine-free, deterministic): a STALE decision from a PREVIOUS ME is REJECTED
//      (invariant 6, the #861 shape); a DUPLICATE re-delivery of an applied op is a no-op
//      (invariant 5); a LATE terminal arriving after the ME already terminal-adopted is dropped.
//   3. #859-SHAPE (engine-free): when the committed op states a NON-battle terminal, the watcher's
//      derived terminal is "leave" (it never routes to finishWithoutLeaving / builds the phantom
//      battle chain); a stale battle-handoff from an earlier ME is REJECTED, so it can never build
//      the phantom either. The type is stated by the OPERATION before any phase is constructed.
//
// The operation-gating (2/3) is ITSELF proof the primitive is active: with the flag OFF the
// watcher adopts the relayed sentinel verbatim (legacy pass-through). The companion duo suites
// (coop-duo-mystery, coop-duo-me-*) prove the surface stays green under BOTH flag states; this
// suite proves the NEW behavior the flag turns on.
//
// HOW TO RUN (gated ER_SCENARIO=1):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-me-operation.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import * as coopEngine from "#data/elite-redux/coop/coop-battle-engine";
import * as meOp from "#data/elite-redux/coop/coop-me-operation";
import {
  isCoopMeOperationEnabled,
  resetCoopMeOperationFlag,
  resetCoopMeOperationState,
  setCoopMeOperationEnabled,
} from "#data/elite-redux/coop/coop-me-operation";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { BattleType } from "#enums/battle-type";
import { GameModes } from "#enums/game-modes";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuoForMe,
  drainGuestMeReplayToSettle,
  drainLoopback,
  driveGuestMeReplay,
  driveHostRewardShopOwner,
  installDuoLogCapture,
  relayGuestMeOptionIndexOnly,
  relayGuestMeShopLeaveSync,
  type ShopPhaseSeam,
  startGuestMeOutcomeRace,
  startGuestMeReplay,
  startGuestMeShopOwner,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import { runMysteryEncounterToEnd, runSelectMysteryEncounterOption } from "#test/utils/encounter-test-utils";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** A valid ME wave (WILD, non-boss, in [10,180], waveIndex % 10 != 1). */
const ME_WAVE = 12;

/** Flip a freshly-built scene into the co-op game mode (shared by host + guest). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)("co-op DUO mystery encounter via the operation primitive (Wave-2c)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`me-op-${Date.now()}`);
    // Explicitly select the MIGRATED path from clean operation state (no leftover from a prior file).
    setCoopMeOperationEnabled(true);
    resetCoopMeOperationState();
    game.override
      .battleStyle("double")
      .startingWave(ME_WAVE)
      .mysteryEncounterChance(100)
      .startingLevel(50)
      .disableTrainerWaves();
  });

  afterEach(() => {
    resetCoopMeOperationFlag();
    resetCoopMeOperationState();
    logs.dispose();
    clearCoopRuntime();
    vi.restoreAllMocks();
    // #710 harness-citizenship: buildDuoForMe builds a 2nd BattleScene (the guest) whose ctor steals
    // globalScene. Restore the host GameManager scene for the NEXT ER_SCENARIO file's GameManager.
    initGlobalScene(game.scene);
  });

  afterAll(() => {
    // best-effort
  });

  // =====================================================================================
  // LEG 1 - HOST-OWNED non-battle ME: the guest's terminal is gated through the operation
  // primitive and adopts a host-stated terminal "leave".
  // =====================================================================================
  it("LEG 1 (host-owned non-battle): the guest adopts the ME terminal THROUGH the operation primitive (terminal 'leave')", async () => {
    expect(isCoopMeOperationEnabled(), "the migrated ME-operation path is active for this test").toBe(true);

    await game.runToMysteryEncounter(MysteryEncounterType.DEPARTMENT_STORE_SALE, [SpeciesId.SNORLAX, SpeciesId.GENGAR]);
    const hostScene = game.scene;
    expect(hostScene.currentBattle.battleType, "host reached a MYSTERY_ENCOUNTER wave").toBe(
      BattleType.MYSTERY_ENCOUNTER,
    );

    const pair = createLoopbackPair();
    const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    expect(counterBefore, "the ME opens on interaction counter 0 (host owns even)").toBe(0);

    // Spy the watcher-adopt gate (calls through - vi.spyOn preserves the original impl in vitest).
    const adoptSpy = vi.spyOn(meOp, "adoptMeWatcherChoice");

    // Drive the HOST through the whole ME (buffers present + meResync + LEAVE), then the guest replays.
    await withClient(rig.hostCtx, async () => {
      await runMysteryEncounterToEnd(game, 1);
      await game.phaseInterceptor.to("SelectModifierPhase", false);
      const hostShop = hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
      // Drive the embedded reward shop to its leave (the host is the forced reward owner mid-ME).
      await driveHostRewardShopOwner(hostShop, { takeReward: false });
      await game.phaseInterceptor.to("PostMysteryEncounterPhase");
    });

    const guestReplay = await withClient(rig.guestCtx, () => driveGuestMeReplay(rig.guestScene));
    expect(guestReplay.settled, "guest CoopReplayMePhase settled (left once)").toBe(true);

    // THE MIGRATED BEHAVIOR: the guest gated its terminal THROUGH the operation primitive, which STATED
    // the ME resolved as a non-battle "leave" - the watcher routed off the OPERATION, not a leftover chain.
    const terminalAdopts = adoptSpy.mock.results
      .map(r => (r.type === "return" ? r.value : null))
      .filter((v): v is Extract<meOp.CoopMeAdoptDecision, { adopt: true }> => v != null && v.adopt === true);
    expect(
      terminalAdopts.some(v => v.kind === "ME_TERMINAL" && v.terminal === "leave"),
      "the guest adopted a host-stated NON-BATTLE terminal ('leave') through the operation primitive",
    ).toBe(true);
    expect(
      terminalAdopts.some(v => v.kind === "ME_TERMINAL" && v.terminal === "battle"),
      "a host-owned non-battle ME NEVER states a battle terminal",
    ).toBe(false);

    // Lockstep, same as the legacy suite: both advanced once for the whole ME.
    expect(rig.hostRuntime.controller.interactionCounter()).toBe(counterBefore + 1);
    expect(rig.guestRuntime.controller.interactionCounter()).toBe(counterBefore + 1);
    logs.flush();
  }, 300_000);

  it("DURABILITY: dropping only the 9M leave sentinel still materializes the host-stated terminal", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.DEPARTMENT_STORE_SALE, [SpeciesId.SNORLAX, SpeciesId.GENGAR]);
    const hostScene = game.scene;
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      {
        drop: 1,
        reorder: 0,
        delay: 0,
        faultable: msg =>
          msg.t === "interactionChoice" && msg.kind === "meBtn" && msg.seq >= 9_000_000 && msg.choice === -1,
      },
      { seed: 0x6d3e },
    );
    const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    const adoptSpy = vi.spyOn(meOp, "adoptMeWatcherChoice");

    await withClient(rig.hostCtx, async () => {
      await runMysteryEncounterToEnd(game, 1);
      await game.phaseInterceptor.to("SelectModifierPhase", false);
      const hostShop = hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
      await driveHostRewardShopOwner(hostShop, { takeReward: false });
      await game.phaseInterceptor.to("PostMysteryEncounterPhase");
    });
    expect(pair.faultsInjected(), "the legacy 9M ME leave sentinel must actually be dropped").toBeGreaterThan(0);

    const guestReplay = await withClient(rig.guestCtx, () => driveGuestMeReplay(rig.guestScene));
    expect(guestReplay.settled, "the durable ME_TERMINAL must settle the real guest replay phase").toBe(true);
    const terminalAdopts = adoptSpy.mock.results
      .map(result => (result.type === "return" ? result.value : null))
      .filter((value): value is Extract<meOp.CoopMeAdoptDecision, { adopt: true }> => value?.adopt === true);
    expect(
      terminalAdopts.some(value => value.kind === "ME_TERMINAL" && value.terminal === "leave"),
      "the journal-delivered terminal states leave before the guest exits the encounter",
    ).toBe(true);
    expect(rig.guestRuntime.controller.interactionCounter()).toBe(counterBefore + 1);
    logs.flush();
  }, 300_000);

  // =====================================================================================
  // LEG 2 - GUEST-OWNED non-battle ME: the guest MINTS an ME_PICK intent; the HOST COMMITS it.
  // =====================================================================================
  it("LEG 2 (guest-owned non-battle): the guest mints an ME_PICK intent, the HOST commits it through the primitive", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.DEPARTMENT_STORE_SALE, [SpeciesId.SNORLAX, SpeciesId.GENGAR]);
    const hostScene = game.scene;

    const pair = createLoopbackPair();
    const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);

    // Seed the interaction counter to 1 (ODD -> guest owns the ME) via the real controller API.
    await withClient(rig.hostCtx, () => rig.hostRuntime.controller.advanceInteraction());
    await withClient(rig.guestCtx, () => rig.guestRuntime.controller.advanceInteraction());
    await drainLoopback();
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    expect(counterBefore, "the ME opens on interaction counter 1 (guest owns odd)").toBe(1);

    const commitSpy = vi.spyOn(meOp, "commitMeOwnerIntent");

    // STEP A (host): reach MysteryEncounterPhase; the host parks awaiting the guest's relayed index.
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("MysteryEncounterPhase", false);
      await game.phaseInterceptor.to("MysteryEncounterPhase");
    });
    await drainLoopback();

    // STEP B (guest): start the divert, relay option index 0 synchronously (send-only). NOTE: the harness's
    // relayGuestMeOptionIndexOnly sends the raw "me" wire directly (bypassing handleGuestOptionSelect, for
    // cross-ctx control), so the guest-side mint isn't exercised here - the host-side COMMIT below is the
    // load-bearing guest-owned proof (the production guest mint is exercised by coop-duo-mystery IT #2).
    const replay = await withClient(rig.guestCtx, () => startGuestMeReplay(rig.guestScene));
    withClientSync(rig.guestCtx, () => relayGuestMeOptionIndexOnly(replay, 0));

    // STEP C (host): flush the relayed index; the host commits the guest's ME_PICK (invariant 3) + applies it,
    // then reaches the embedded reward shop (the #828 pick-watcher on a guest-owned ME - rolls + streams).
    let hostShop!: ShopPhaseSeam;
    await withClient(rig.hostCtx, async () => {
      await drainLoopback();
      await game.phaseInterceptor.to("SelectModifierPhase", false);
      hostShop = hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
      hostShop.start();
      await drainLoopback();
    });

    // THE MIGRATED BEHAVIOR: the HOST committed the guest-owned ME_PICK it received (a host-role commit).
    const hostPickCommits = commitSpy.mock.calls.filter(c => c[0].kind === "ME_PICK" && c[0].localRole === "host");
    expect(
      hostPickCommits.length,
      "the HOST committed the guest's relayed ME_PICK through the operation primitive (invariant 3)",
    ).toBeGreaterThan(0);
    expect(
      (hostPickCommits[0][0].payload as { optionIndex: number }).optionIndex,
      "the committed ME_PICK carries the guest's relayed option index (0)",
    ).toBe(0);

    // STEP C2 (guest): the guest OWNS the reward pick (#828) - open its shop as owner, relay LEAVE sync.
    const guestShop = await withClient(rig.guestCtx, () => startGuestMeShopOwner(rig.guestScene));
    withClientSync(rig.guestCtx, () => relayGuestMeShopLeaveSync(guestShop));

    // STEP C3 (host): drain the guest owner's LEAVE, run the option chain to the ME terminal (advances once).
    await withClient(rig.hostCtx, async () => {
      for (let i = 0; i < 16; i++) {
        await drainLoopback();
        if (hostScene.phaseManager.getCurrentPhase()?.phaseName !== "SelectModifierPhase") {
          break;
        }
      }
      await game.phaseInterceptor.to("PostMysteryEncounterPhase");
    });
    expect(rig.hostRuntime.controller.interactionCounter(), "host advanced the counter once for the ME").toBe(
      counterBefore + 1,
    );

    // STEP D (guest): settle the guest's outcome/terminal race so nothing dangles past the test.
    const guestReplay = await withClient(rig.guestCtx, async () => {
      startGuestMeOutcomeRace(replay);
      return drainGuestMeReplayToSettle(replay);
    });
    expect(guestReplay.settled, "guest CoopReplayMePhase settled (left once)").toBe(true);
    expect(rig.guestRuntime.controller.interactionCounter(), "guest counter lockstep after the ME").toBe(
      counterBefore + 1,
    );

    logs.flush();
  }, 300_000);

  // =====================================================================================
  // LEG 3 - BATTLE-HANDOFF ME (the #859/#860 phantom class). The committed terminal STATES "battle"
  // BEFORE the guest builds its ME-battle phases, so it routes off the OPERATION, never a leftover chain.
  // =====================================================================================
  it("LEG 3 (battle-handoff): the committed terminal STATES 'battle' before the guest builds phases (#859 structural cure)", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.FIGHT_OR_FLIGHT, [SpeciesId.SNORLAX, SpeciesId.GENGAR]);
    const hostScene = game.scene;

    const pair = createLoopbackPair();
    const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    expect(counterBefore, "the ME opens on interaction counter 0 (host owns even)").toBe(0);

    const applyMeOutcomeSpy = vi.spyOn(coopEngine, "applyCoopMeOutcome");
    const adoptSpy = vi.spyOn(meOp, "adoptMeWatcherChoice");

    // Drive the HOST through the BATTLE option (relays COOP_ME_BATTLE_HANDOFF on 9M, NO meResync on 8M).
    await withClient(rig.hostCtx, async () => {
      await runSelectMysteryEncounterOption(game, 1);
      await game.phaseInterceptor.to("MysteryEncounterBattlePhase", false);
      expect(hostScene.phaseManager.getCurrentPhase()?.phaseName, "host spawned the ME battle").toBe(
        "MysteryEncounterBattlePhase",
      );
    });

    // Drive the guest: the terminal race resolves the 9M battle-handoff; the guest finishes WITHOUT leaving.
    const guestReplay = await withClient(rig.guestCtx, () => driveGuestMeReplay(rig.guestScene));
    expect(guestReplay.settled, "guest CoopReplayMePhase settled at the battle-handoff").toBe(true);

    // THE #859 STRUCTURAL CURE: the operation STATED a "battle" terminal, and the guest adopted THAT (not an
    // inferred battle turn from a leftover chain). A non-battle ME would have stated "leave" -> leaveDefensive.
    const terminalAdopts = adoptSpy.mock.results
      .map(r => (r.type === "return" ? r.value : null))
      .filter((v): v is Extract<meOp.CoopMeAdoptDecision, { adopt: true }> => v != null && v.adopt === true);
    expect(
      terminalAdopts.some(v => v.kind === "ME_TERMINAL" && v.terminal === "battle"),
      "the committed op STATED a battle terminal BEFORE the watcher built its ME-battle phases (#859)",
    ).toBe(true);

    // The signatures of the handoff class (unchanged from legacy): NO meResync, counter NOT advanced, the
    // encounter NOT left (the spawned battle now runs host-authoritatively on both engines).
    expect(applyMeOutcomeSpy.mock.calls.length, "guest applied NO meResync at a battle-handoff").toBe(0);
    expect(rig.guestRuntime.controller.interactionCounter(), "guest did NOT advance at the battle-handoff").toBe(
      counterBefore,
    );
    expect(rig.guestScene.currentBattle.mysteryEncounter, "guest did NOT leave the encounter").toBeDefined();

    logs.flush();
  }, 300_000);

  // =====================================================================================
  // ADVERSARIAL (engine-free): a STALE decision from a PREVIOUS ME is rejected; a DUPLICATE re-delivery
  // is a no-op; a LATE terminal after the ME already terminal-adopted is dropped. With the flag OFF every
  // one of these would adopt verbatim (legacy pass-through), so the rejections prove the primitive gates.
  // =====================================================================================
  it("ADVERSARIAL: a stale previous-ME pick is REJECTED; a duplicate is a no-op; a late terminal after terminal is dropped (#861 shape)", () => {
    resetCoopMeOperationState();
    const EARLIER = 2; // an EARLIER ME (host-owned even counter)
    const LATER = 4; // a NEWER ME (host-owned even counter)
    const wave = 20;

    // A NEWER ME resolves its terminal on the watcher first (advances the cross-ME stale order to LATER).
    const freshTerminal = meOp.adoptMeWatcherChoice({
      kind: "ME_TERMINAL",
      seq: 9_000_000 + LATER,
      pinned: LATER,
      res: { choice: -1000 }, // battle-handoff sentinel
      terminal: "battle",
      hostTurn: 3,
      localRole: "guest",
      wave,
      turn: 0,
    });
    expect(freshTerminal.adopt, "the newer ME's terminal is adopted").toBe(true);
    if (freshTerminal.adopt) {
      expect(freshTerminal.terminal, "the newer terminal states 'battle'").toBe("battle");
    }

    // A STALE pick from the EARLIER ME arrives late - it must be REJECTED (its pinned is below the last
    // adopted terminal's pinned), never applied. A leftover pick can NEVER overwrite a resolved later ME.
    const stalePick = meOp.adoptMeWatcherChoice({
      kind: "ME_PICK",
      seq: 8_000_000 + EARLIER,
      pinned: EARLIER,
      res: { choice: 1 },
      localRole: "guest",
      wave,
      turn: 0,
    });
    expect(stalePick.adopt, "the stale previous-ME pick is REJECTED (invariant 6, #861 shape)").toBe(false);
    if (!stalePick.adopt) {
      expect(stalePick.reason).toBe("stale-or-duplicate");
    }

    // A DUPLICATE re-delivery of the already-applied newer terminal is also a no-op (idempotency).
    const dupTerminal = meOp.adoptMeWatcherChoice({
      kind: "ME_TERMINAL",
      seq: 9_000_000 + LATER,
      pinned: LATER,
      res: { choice: -1000 },
      terminal: "battle",
      hostTurn: 3,
      localRole: "guest",
      wave,
      turn: 0,
    });
    expect(dupTerminal.adopt, "a duplicate re-delivery of an already-applied terminal is a no-op (invariant 5)").toBe(
      false,
    );

    // A LATE trailing meResync-equivalent (a leave terminal for the SAME already-resolved ME on the same
    // seq/step) is ALSO dropped by the id dedupe - the ME is already terminal, so nothing re-runs.
    const lateLeave = meOp.adoptMeWatcherChoice({
      kind: "ME_TERMINAL",
      seq: 9_000_000 + LATER,
      pinned: LATER,
      res: { choice: -2 }, // leave sentinel
      terminal: "leave",
      localRole: "guest",
      wave,
      turn: 0,
    });
    expect(lateLeave.adopt, "a late terminal for an already-terminal ME is dropped (no double-leave)").toBe(false);
  });

  // =====================================================================================
  // #859-SHAPE (engine-free): when the committed op states a NON-battle terminal, the watcher's derived
  // terminal is "leave" (it NEVER routes to finishWithoutLeaving / the phantom battle chain); and a stale
  // battle-handoff from an earlier ME is REJECTED so it can't build the phantom either.
  // =====================================================================================
  it("#859-SHAPE: a committed NON-battle terminal yields 'leave' (never a phantom battle chain); a stale battle-handoff is rejected", () => {
    resetCoopMeOperationState();
    const wave = 30;

    // A committed NON-battle terminal: the operation STATES "leave", so the watcher routes to the leave
    // path - it can NEVER construct the ME-battle phase chain for this ME (the #859/#860 phantom is
    // structurally impossible: the type is stated by the op BEFORE any phase is built).
    const nonBattle = meOp.adoptMeWatcherChoice({
      kind: "ME_TERMINAL",
      seq: 9_000_000 + 6,
      pinned: 6,
      res: { choice: -2 }, // leave sentinel
      terminal: "leave",
      localRole: "guest",
      wave,
      turn: 0,
    });
    expect(nonBattle.adopt, "the non-battle terminal is adopted").toBe(true);
    if (nonBattle.adopt) {
      expect(nonBattle.terminal, "the op states a NON-battle 'leave' terminal").toBe("leave");
      // The watcher's routing predicate (handleTerminalAction) is `terminal === "battle"` - here false, so
      // finishWithoutLeaving (which builds the phantom battle chain) is NEVER reached for this ME.
      const isBattleTerminal = nonBattle.terminal === "battle";
      expect(isBattleTerminal, "the watcher NEVER routes a stated-leave terminal to the battle chain (#859)").toBe(
        false,
      );
    }

    // A STALE battle-handoff from an EARLIER ME (a leftover 9M sentinel, the exact #859/#860 wire shape)
    // arriving after ME 6 resolved is REJECTED: it can NEVER re-open a phantom battle chain, because the
    // committed later terminal already advanced the cross-ME stale order past it.
    const staleHandoff = meOp.adoptMeWatcherChoice({
      kind: "ME_TERMINAL",
      seq: 9_000_000 + 4,
      pinned: 4, // an EARLIER ME than the just-resolved 6
      res: { choice: -1000 }, // battle-handoff sentinel
      terminal: "battle",
      hostTurn: 9,
      localRole: "guest",
      wave,
      turn: 0,
    });
    expect(
      staleHandoff.adopt,
      "a stale battle-handoff from an earlier ME is REJECTED - it can never build the phantom chain (#859/#860)",
    ).toBe(false);
    if (!staleHandoff.adopt) {
      expect(staleHandoff.reason).toBe("stale-or-duplicate");
    }
  });
});
