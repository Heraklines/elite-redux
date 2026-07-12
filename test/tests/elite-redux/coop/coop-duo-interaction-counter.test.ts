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
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { getCoopUiRelayEdges, resetCoopUiRelayTrace } from "#data/elite-redux/coop/coop-ui-relay-trace";
import { BattlerIndex } from "#enums/battler-index";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { GameManager } from "#test/framework/game-manager";
import {
  arriveGuestCommandBoundary,
  buildDuo,
  type DuoRig,
  drainLoopback,
  driveGuestReplayTurn,
  forceItemRewards,
  installDuoLogCapture,
  remirrorWave,
  type ShopPhaseSeam,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

/** The copy() + advance seam of a real SelectModifierPhase (extends the shop seam). */
interface CounterPhaseSeam extends ShopPhaseSeam {
  copy(): { coopInteractionStart: number };
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

  function wireGuestCommand(rig: DuoRig): void {
    rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
      command: Command.FIGHT,
      cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
      moveId: MoveId.TACKLE,
      targets: [BattlerIndex.ENEMY_2],
    }));
  }

  async function hostPlayWave(rig: DuoRig): Promise<void> {
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
      game.move.select(MoveId.TACKLE, COOP_GUEST_FIELD_INDEX, BattlerIndex.ENEMY_2);
      await game.phaseInterceptor.to("TurnEndPhase");
    });
  }

  it("copy() carries the pin, an unpinned advance is refused, counters stay lockstep, wave 2 resolves", async () => {
    forceItemRewards(game.override, [{ name: "LURE" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    wireGuestCommand(rig);
    // This scenario verifies reward relay/counter symmetry for returning players. The first-time item
    // tutorial is a separate MESSAGE interaction that deliberately blocks reward ACTION input until its
    // text is acknowledged; keep it out of this call-chain proof on both simulated clients.
    rig.hostScene.enableTutorials = false;
    rig.guestScene.enableTutorials = false;

    // ===== Wave 1: host plays to a win + guest replays (reach the reward shop, counter 0 = host owns). =====
    const turn = rig.hostScene.currentBattle.turn;
    await hostPlayWave(rig);
    await withClient(rig.guestCtx, () => driveGuestReplayTurn(rig.guestScene, turn));

    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    expect(counterBefore % 2, "wave 1: host owns the shop (even counter)").toBe(0);

    // ===== #837 fix #1: a continuation COPY inherits the pinned interaction counter. =====
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("SelectModifierPhase", false);
    });
    const hostShop = rig.hostScene.phaseManager.getCurrentPhase() as unknown as CounterPhaseSeam;
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
    const guestShop = withClientSync(rig.guestCtx, () => new SelectModifierPhase()) as unknown as ShopPhaseSeam;
    withClientSync(rig.guestCtx, () => guestShop.start());
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
      resetCoopUiRelayTrace();
      let accepted = false;
      for (let i = 0; i < 500 && !accepted; i++) {
        accepted = rig.hostScene.ui.processInput(Button.ACTION);
        if (!accepted) {
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      }
      expect(accepted, "the owner takes the deterministic LURE via UI after its intro animation").toBe(true);
      expect(
        getCoopUiRelayEdges().some(
          edge => edge.mode === UiMode.MODIFIER_SELECT && edge.carrier === "interactionChoice",
        ),
        "the public reward-shop UI input reached the production interaction relay",
      ).toBe(true);
      await drainLoopback();
    });
    for (let i = 0; i < 100 && rig.guestRuntime.controller.interactionCounter() === counterBefore; i++) {
      await drainLoopback();
    }

    // The interaction counter advanced EXACTLY ONCE and is IDENTICAL on both clients (the #837 invariant).
    expect(rig.hostRuntime.controller.interactionCounter(), "host advanced the counter exactly once").toBe(
      counterBefore + 1,
    );
    expect(rig.guestRuntime.controller.interactionCounter(), "guest counter IDENTICAL to host (no N-behind lag)").toBe(
      counterBefore + 1,
    );

    // ===== The NEXT battle resolves turns 1-2 with NO stall (the wedge the counter drift caused). =====
    await arriveGuestCommandBoundary(rig, 2);
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("CommandPhase");
    });
    expect(rig.hostScene.currentBattle.waveIndex, "host crossed into wave 2").toBe(2);

    await remirrorWave(rig);
    for (let t = 0; t < 2; t++) {
      const w2turn = rig.hostScene.currentBattle.turn;
      await hostPlayWave(rig);
      await withClient(rig.guestCtx, () => driveGuestReplayTurn(rig.guestScene, w2turn));
      // Guest kept converging turn-by-turn (a wedge would THROW inside driveGuestReplayTurn).
      if (rig.guestScene.currentBattle.enemyParty.every(e => e.isFainted())) {
        break;
      }
      await withClient(rig.hostCtx, async () => {
        if (rig.hostScene.phaseManager.getCurrentPhase()?.phaseName === "CommandPhase") {
          return;
        }
        await game.phaseInterceptor.to("CommandPhase", false).catch(() => {});
      });
    }
    expect(
      rig.guestScene.currentBattle.enemyParty.every(e => e.isFainted()),
      "wave 2 resolved on the guest (turns 1-2, no stall)",
    ).toBe(true);

    logs.flush();
  }, 300_000);
});
