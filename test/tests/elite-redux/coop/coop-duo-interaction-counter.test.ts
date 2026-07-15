/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op INTERACTION-COUNTER symmetry (#837). A CONTINUATION-class shop item
// (TM / Ability Capsule / Learner's Shroom) queues a back-out `SelectModifierPhase` COPY.
// Pre-fix that copy started with coopInteractionStart = -1 (copy() did not carry the pin), so
// if its own terminal ever advanced, coopAdvanceInteraction fired an UNPINNED
// advanceInteraction(undefined) that unconditionally bumped + broadcast the shared interaction
// counter on the APPLIER only (the live "advance interaction from=-1 counter 11 -> 12"). The
// partner DEFERS that broadcast (mergeRemote) and lags N-behind, wedging the next battle - "after
// browsing the market i suddenly cannot choose a move for my mon anymore" (seed lCSO1cfpilUUG07bQvwnROJJ).
//
// This asserts the two-part fix over BOTH real engines:
//   1. copy() CARRIES coopInteractionStart (the continuation copy stays pinned to the same interaction).
//   2. coopAdvanceInteraction REFUSES an unpinned (start<0) advance in co-op (no asymmetric bump).
// and that after a normal reward the counters advance by EXACTLY ONE, stay IDENTICAL on both
// clients, and the NEXT battle resolves turns 1-2 with no stall.
//
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-interaction-counter.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { resetCoopRendezvousWaitMs, setCoopRendezvousWaitMs } from "#data/elite-redux/coop/coop-rendezvous";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { getCoopUiRelayEdges, resetCoopUiRelayTrace } from "#data/elite-redux/coop/coop-ui-relay-trace";
import { BattlerIndex } from "#enums/battler-index";
import { Button } from "#enums/buttons";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { type ModifierSelectCallback, SelectModifierPhase } from "#phases/select-modifier-phase";
import { GameManager } from "#test/framework/game-manager";
import {
  beginRewardShopWatch,
  buildDuo,
  type DuoRig,
  drainLoopback,
  driveClientPhaseQueueTo,
  driveDuoGuestTackleThroughPublicUi,
  driveGuestReplayTurn,
  forceItemRewards,
  installDuoLogCapture,
  reachQueuedRewardShop,
  type ShopPhaseSeam,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { createScheduledCoopPair } from "#test/tools/coop-scheduled-transport";
import type { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import Phaser from "phaser";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

/** The copy() + advance seam of a real SelectModifierPhase (extends the shop seam). */
interface CounterPhaseSeam extends ShopPhaseSeam {
  copy(): { coopInteractionStart: number };
  resetModifierSelect(callback: ModifierSelectCallback): void;
}

describe.skipIf(!RUN)("co-op DUO interaction-counter symmetry (#837): no asymmetric unpinned advance", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    setCoopWaveBarrierMs(50);
    setCoopRendezvousWaitMs(50);
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`interaction-counter-${Date.now()}`);
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

  afterAll(() => {
    setCoopWaveBarrierMs(60_000);
    resetCoopRendezvousWaitMs();
    logs?.dispose();
    clearCoopRuntime();
    initGlobalScene(game.scene);
  });

  async function hostPlayWave(rig: DuoRig, guestCommandAlreadyCommitted = false): Promise<void> {
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
      if (!guestCommandAlreadyCommitted) {
        game.move.select(MoveId.TACKLE, COOP_GUEST_FIELD_INDEX, BattlerIndex.ENEMY_2);
      }
      await game.phaseInterceptor.to("CoopSealTurnPhase");
    });
  }

  async function takeFirstRewardThroughPublicUi(
    rig: DuoRig,
    ownerArgs: unknown[],
    expectedCallback: ModifierSelectCallback,
    mirrorSeq: number,
  ): Promise<boolean> {
    resetCoopUiRelayTrace();
    const handler = rig.hostScene.ui.getHandler() as ModifierSelectUiHandler & {
      awaitingActionInput: boolean;
      onActionInput: ModifierSelectCallback | null;
    };
    // UI.setMode intentionally no-ops when this mode is already active. Call the handler's public
    // active-show lifecycle directly so it re-arms the exact owner callback after the shared-process
    // watcher projection. The actual choice still crosses UI.processInput below.
    handler.show(ownerArgs);
    // The headless Phaser tween mock does not provide a reliable onUpdate/final cursor position. Use
    // the handler's public cursor surface to finish that cosmetic setup, then make the choice only
    // through UI.processInput. The carrier assertion below still proves the production callback and
    // interaction relay ran; no private SelectModifierPhase selection seam is invoked.
    handler.setRowCursor(1);
    handler.setCursor(0);
    handler.tutorialActive = false;
    expect(handler.awaitingActionInput, "the reward handler is armed for the public action").toBe(true);
    expect(handler.onActionInput, "the installed callback belongs to the host owner phase").toBe(expectedCallback);
    rig.hostRuntime.uiMirror.beginSession("owner", UiMode.MODIFIER_SELECT, mirrorSeq);
    rig.hostScene.ui.processInput(Button.ACTION);
    return getCoopUiRelayEdges().some(
      edge => edge.mode === UiMode.MODIFIER_SELECT && edge.carrier === "interactionChoice",
    );
  }

  it("copy() carries the pin, an unpinned advance is refused, counters stay lockstep, wave 2 resolves", async () => {
    forceItemRewards(game.override, [{ name: "LURE" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createScheduledCoopPair({ automatic: true });
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    // Align the directly-constructed guest to its real TurnInit/Command queue, then make all gameplay
    // delivery addressed-context-only. Wave 1 and wave 2 both use the public command UI below.
    await withClient(rig.guestCtx, () => {
      rig.guestScene.phaseManager.clearAllPhases();
      rig.guestScene.phaseManager.shiftPhase();
    });
    pair.setAutomaticDelivery(false);
    // This scenario verifies reward relay/counter symmetry for returning players. The first-time item
    // tutorial is a separate MESSAGE interaction that deliberately blocks reward ACTION input until its
    // text is acknowledged; keep it out of this call-chain proof on both simulated clients.
    rig.hostScene.enableTutorials = false;
    rig.guestScene.enableTutorials = false;

    // ===== Wave 1: host plays to a win + guest replays (reach the reward shop, counter 0 = host owns). =====
    const turn = rig.hostScene.currentBattle.turn;
    await driveDuoGuestTackleThroughPublicUi(game, rig, { restartAlreadyOpenHost: true });
    await hostPlayWave(rig, true);
    await withClient(rig.guestCtx, () => driveGuestReplayTurn(rig.guestScene, turn));
    // From this point onward, deliver each retained continuation under its addressed client's
    // process-global context. The ordinary loopback resumes both sides in whichever context happened
    // to send last, which is impossible in production (one client per process) and can project the
    // owner's asynchronous reward continuation into the guest UI.
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    expect(counterBefore % 2, "wave 1: host owns the shop (even counter)").toBe(0);

    // ===== #837 fix #1: a continuation COPY inherits the pinned interaction counter. =====
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("SelectModifierPhase", false);
    });
    const hostShop = rig.hostScene.phaseManager.getCurrentPhase() as unknown as CounterPhaseSeam;
    // Capture the exact public UI arguments emitted by the production phase. GameWrapper's lightweight
    // tween mock calls `addCounter.onComplete` but never `onUpdate`, so the intro cannot naturally arm
    // ModifierSelectUiHandler in this headless scene; re-showing an already-active handler below is the
    // framework-faithful way to bypass only that mock limitation while retaining UI -> phase -> relay.
    let ownerModifierArgs: unknown[] | null = null;
    let insideOwnerReset = false;
    const originalOwnerReset = hostShop.resetModifierSelect.bind(hostShop);
    vi.spyOn(hostShop, "resetModifierSelect").mockImplementation(callback => {
      insideOwnerReset = true;
      try {
        originalOwnerReset(callback);
      } finally {
        insideOwnerReset = false;
      }
    });
    const originalSetMode = rig.hostScene.ui.setMode.bind(rig.hostScene.ui);
    vi.spyOn(rig.hostScene.ui, "setMode").mockImplementation((mode, ...args) => {
      // The two-engine harness later opens the watcher's read-only projection against this shared UI
      // with a deliberate no-op callback. Bind capture to THIS host phase's production reset call so
      // callback identity is determined by its owning object, never async scheduling order.
      if (insideOwnerReset && mode === UiMode.MODIFIER_SELECT && args.length >= 3 && typeof args[2] === "function") {
        ownerModifierArgs = args;
      }
      return originalSetMode(mode, ...args);
    });
    withClientSync(rig.hostCtx, () => {
      hostShop.start(); // pins coopInteractionStart to counterBefore + opens the owner screen
    });
    expect(hostShop.coopInteractionStart, "the host shop pinned to the live counter").toBe(counterBefore);
    const copyPin = withClientSync(rig.hostCtx, () => hostShop.copy().coopInteractionStart);
    expect(copyPin, "#837 fix #1: the continuation copy INHERITS the pinned counter (was -1 pre-fix)").toBe(
      counterBefore,
    );

    // ===== #837 fix #2: an UNPINNED (start=-1) coopAdvanceInteraction is REFUSED - no asymmetric bump. =====
    const hostCounterPre = rig.hostRuntime.controller.interactionCounter();
    const guestCounterPre = rig.guestRuntime.controller.interactionCounter();
    withClientSync(rig.hostCtx, () => {
      const orphan = new SelectModifierPhase() as unknown as CounterPhaseSeam;
      expect(orphan.coopInteractionStart, "a fresh (un-started) phase is unpinned").toBe(-1);
      orphan.coopAdvanceInteraction(); // pre-fix: bumps host + broadcasts (guest defers -> lags)
    });
    // Let any (erroneously-sent) broadcast reach the guest before we assert.
    await withClient(rig.guestCtx, async () => {
      await Promise.resolve();
    });
    expect(
      rig.hostRuntime.controller.interactionCounter(),
      "#837 fix #2: the unpinned advance did NOT bump the host counter",
    ).toBe(hostCounterPre);
    expect(
      rig.guestRuntime.controller.interactionCounter(),
      "#837 fix #2: the guest counter is unchanged (no asymmetric divergence)",
    ).toBe(guestCounterPre);

    // Start the reciprocal real watcher BEFORE the owner can commit. This resolves the production shop
    // arrival barrier and removes the old harness fiction where the owner selected before a watcher existed.
    const guestShop = await withClient(rig.guestCtx, () => reachQueuedRewardShop(rig.guestScene));
    // Keep the guest's complete process-global client context installed while the asynchronous watcher
    // adopts its options and commits MODIFIER_SELECT. That public UI commit is what publishes P33
    // continuationReady and releases the retained wave transaction ahead of this reward result.
    await withClient(rig.guestCtx, () => beginRewardShopWatch(guestShop));
    // Deliver the guest's arrival while the HOST context is installed. Production has one scene per
    // process; the two-engine harness shares a process-global scene binding, so draining outside a client
    // context would resume the host's async barrier continuation against the guest UI object.
    await withClient(rig.hostCtx, () => drainLoopback());

    // ===== Finish the shop through the SAME public UI boundary as a human. =====
    await withClient(rig.hostCtx, async () => {
      // coopOpenOwnerShopAfterBarrier opens asynchronously after its bounded arrival wait. Poll the real
      // screen instead of calling the phase's private selection seam (which was the old false coverage).
      for (let i = 0; i < 500 && rig.hostScene.ui.getMode() !== UiMode.MODIFIER_SELECT; i++) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      expect(rig.hostScene.ui.getMode(), "the owner reached the real reward UI").toBe(UiMode.MODIFIER_SELECT);
      expect(ownerModifierArgs, "the production phase supplied the modifier UI callback").not.toBeNull();
      // Normalize the cursor state omitted by the headless tween mock, then cross the same public
      // UI input boundary as a player and require proof that the authoritative carrier was reached.
      const ownerArgs = ownerModifierArgs ?? [];
      const reachedRelay = await takeFirstRewardThroughPublicUi(
        rig,
        ownerArgs,
        ownerArgs[2] as ModifierSelectCallback,
        counterBefore * 64,
      );
      expect(reachedRelay, "the public reward-shop UI input reached the production interaction relay").toBe(true);
    });
    await withClient(rig.guestCtx, async () => {
      for (let i = 0; i < 100 && rig.guestRuntime.controller.interactionCounter() === counterBefore; i++) {
        await drainLoopback();
      }
    });
    // The watcher publishes its completed counter back to the owner. In scheduled mode that addressed
    // snapshot remains in the host inbox until the host context is installed; consume it before the
    // host's real NewBattlePhase reaches CoopPartnerSyncPhase.
    await withClient(rig.hostCtx, () => drainLoopback());

    // The interaction counter advanced EXACTLY ONCE and is IDENTICAL on both clients (the #837 invariant).
    expect(rig.hostRuntime.controller.interactionCounter(), "host advanced the counter exactly once").toBe(
      counterBefore + 1,
    );
    expect(rig.guestRuntime.controller.interactionCounter(), "guest counter IDENTICAL to host (no N-behind lag)").toBe(
      counterBefore + 1,
    );

    // ===== The NEXT battle resolves turns 1-2 with NO stall (the wedge the counter drift caused). =====
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("CommandPhase", false);
    });
    const guestCommand = await withClient(rig.guestCtx, () => driveClientPhaseQueueTo(rig.guestScene, "CommandPhase"));
    expect(rig.hostScene.currentBattle.waveIndex, "host crossed into wave 2").toBe(2);
    expect(guestCommand.phaseName, "guest crossed the real queue into wave 2").toBe("CommandPhase");
    expect(rig.guestScene.currentBattle.waveIndex, "guest adopted wave 2").toBe(2);

    for (let t = 0; t < 2; t++) {
      await driveDuoGuestTackleThroughPublicUi(game, rig);
      const w2turn = rig.hostScene.currentBattle.turn;
      await hostPlayWave(rig, true);
      await withClient(rig.guestCtx, () => driveGuestReplayTurn(rig.guestScene, w2turn));
      // Guest kept converging turn-by-turn (a wedge would THROW inside driveGuestReplayTurn).
      if (rig.guestScene.currentBattle.enemyParty.every(e => e.isFainted())) {
        break;
      }
    }
    expect(
      rig.guestScene.currentBattle.enemyParty.every(e => e.isFainted()),
      "wave 2 resolved on the guest (turns 1-2, no stall)",
    ).toBe(true);

    logs.flush();
  }, 300_000);
});
