/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op LEVEL-UP MOVE LEARN (#848). Reproduces the LIVE P0: at wave 6 a party mon
// leveled up + learned a move on a FULL moveset; the mon's OWNER chose the replacement, the PARTNER
// correctly saw the "unlearning", but the OWNER's move-learn screen NEVER CLOSED (hard stuck). The
// pre-#848 co-op path routed each level-up learn through the per-move LearnMovePhase forward, whose
// guest-owned forwarded picker could strand. #848 makes the ER batch Move Learn panel the SHARED co-op
// level-up path instead: the mon's OWNER drives the real panel, the WATCHER opens the SAME panel, and
// BOTH close together on the relayed terminal, which the HOST applies authoritatively.
//
// This drives a level-up learn (forced via the real LearnMoveBatchPhase on a full-moveset mon) over BOTH
// real engines for a GUEST-owned mon AND a HOST-owned mon, and asserts the OWNER's panel actually CLOSES
// on both engines and the moveset converges identically. It FAILS on the pre-#848 code (the batch panel
// is bypassed to the per-move flow, so UiMode.LEARN_MOVE_BATCH never opens in co-op) and PASSES after.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-learn-move.test.ts
//   (PowerShell: $env:ER_SCENARIO="1"; npx vitest run <path>)
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import {
  clearCoopRuntime,
  isCoopLearnMoveForwardInFlightEmpty,
  isCoopV2InteractionHumanInputFrozen,
  setCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { PokemonMove } from "#data/moves/pokemon-move";
import { Button } from "#enums/buttons";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  type DuoRig,
  drainLoopback,
  installDuoLogCapture,
  pumpDuoDestinations,
  retireDuoInitialCommandForBoundaryTest,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Flip a freshly-built scene into the co-op game mode (shared by host + guest). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

/** The new move offered by the (forced) level-up - deliberately NOT in the full moveset below. */
const NEW_MOVE = MoveId.WATER_GUN;

describe.skipIf(!RUN)(
  "co-op DUO level-up Move Learn: batch panel is the shared path, owner's panel CLOSES (#848)",
  () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;
    let logs: ReturnType<typeof installDuoLogCapture>;
    const startedBatchPhases = new WeakSet<object>();

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      setCoopWaveBarrierMs(50);
      game = new GameManager(phaserGame);
      logs = installDuoLogCapture(`learn-move-${Date.now()}`);
      game.override
        .battleStyle("double")
        .startingWave(1)
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyLevel(1)
        .enemyMoveset(MoveId.SPLASH)
        .startingLevel(50)
        // No .moveset() override on purpose: MOVESET_OVERRIDE would make getMoveset() ALWAYS return the
        // override (masking the setMove() the learn applies). The full moveset is set on the raw moveset below.
        .disableTrainerWaves();
    });

    afterEach(() => {
      setCoopWaveBarrierMs(60_000);
      logs.dispose();
      clearCoopRuntime();
      initGlobalScene(game.scene);
    });

    afterAll(() => {
      // best-effort
    });

    /** A FULL 4-move moveset (none is NEW_MOVE) so a new-move learn ALWAYS fires the pick/replace prompt. */
    const FULL_MOVESET = [MoveId.TACKLE, MoveId.SPLASH, MoveId.GROWL, MoveId.EMBER];

    /** Set the raw moveset on the SAME party slot for both engines' mons (not via override - see beforeEach). */
    function giveFullMoveset(rig: DuoRig, slot: number): void {
      for (const scene of [rig.hostScene, rig.guestScene]) {
        const mon = scene.getPlayerParty()[slot];
        mon.moveset = FULL_MOVESET.map(id => new PokemonMove(id));
        if (mon.summonData?.moveset) {
          mon.summonData.moveset = FULL_MOVESET.map(id => new PokemonMove(id));
        }
      }
    }

    /**
     * Drive the OWNER's real batch panel to learn NEW_MOVE over the mon's FIRST current slot (a full moveset
     * always lands in `pickSlot`): ACTION selects the learnable move -> ACTION assigns slot 0 -> the panel
     * thins to empty -> finish -> done relays the terminal + closes. Runs under the owner's client ctx.
     */
    async function driveOwnerPickFirstSlot(rig: DuoRig, owner: "host" | "guest"): Promise<void> {
      const ctx = owner === "host" ? rig.hostCtx : rig.guestCtx;
      const scene = owner === "host" ? rig.hostScene : rig.guestScene;
      expect(
        withClientSync(ctx, () => scene.ui.getMode()),
        "the owner's batch Move Learn panel is open",
      ).toBe(UiMode.LEARN_MOVE_BATCH);
      expect(
        withClientSync(ctx, () => scene.ui.processInput(Button.ACTION)),
        "the owner selects the offered move through public input",
      ).toBe(true);
      await pumpDuoDestinations(rig, 1);
      expect(
        withClientSync(ctx, () => scene.ui.processInput(Button.ACTION)),
        "the owner replaces slot zero through public input",
      ).toBe(true);
    }

    /** Invert only the phase callback's runtime; public UI dispatch must still begin on its real owner. */
    function invertRuntimeWhenPanelCommits(scene: BattleScene, runtime: Parameters<typeof setCoopRuntime>[0]): void {
      const handler = scene.ui.getHandler() as unknown as { deps: { done: () => void } | null };
      const deps = handler.deps;
      expect(deps, "the live batch panel exposed its commit callback").not.toBeNull();
      const done = deps!.done;
      deps!.done = () => {
        setCoopRuntime(runtime);
        done();
      };
    }

    /**
     * Wait for the exact V2 presentation generation on both engines and for the owner input lease.
     *
     * A committed prompt is intentionally not an actionable panel: the replica still has to install the
     * queue-owned phase, finish the real setMode transition, and publish its exact phase/handler proof. The
     * retired fixture asserted after one transport drain, which can only observe the entry at materialApplied.
     * Alternating both destination runtimes models two independent browsers and refuses to synthesize input
     * until the owner could physically press a key in production.
     */
    async function awaitBatchPanels(rig: DuoRig, owner: "host" | "guest"): Promise<void> {
      let hostReady = false;
      let guestReady = false;
      let ownerLeaseInstalled = false;
      let hostPhaseName = "none";
      let guestPhaseName = "none";
      for (let attempt = 0; attempt < 100; attempt++) {
        await pumpDuoDestinations(rig, 1);
        hostReady = withClientSync(rig.hostCtx, () => {
          const phase = rig.hostScene.phaseManager.getCurrentPhase();
          hostPhaseName = phase?.phaseName ?? "none";
          if (phase?.phaseName === "LearnMoveBatchPhase" && !startedBatchPhases.has(phase)) {
            // The test PhaseInterceptor suppresses PhaseManager.startCurrentPhase(). Production starts this
            // exact current phase synchronously after override; reproduce only that missing scheduler edge.
            startedBatchPhases.add(phase);
            phase.start();
          }
          const handler = rig.hostScene.ui.getHandler() as unknown as {
            active?: boolean;
            isCoopV2InputActionable?: () => boolean;
          };
          return (
            phase?.phaseName === "LearnMoveBatchPhase"
            && rig.hostScene.ui.getMode() === UiMode.LEARN_MOVE_BATCH
            && handler.active === true
            && handler.isCoopV2InputActionable?.() === true
          );
        });
        guestReady = withClientSync(rig.guestCtx, () => {
          const phase = rig.guestScene.phaseManager.getCurrentPhase();
          guestPhaseName = phase?.phaseName ?? "none";
          if (phase?.phaseName === "CoopReplayLearnMoveBatchPhase" && !startedBatchPhases.has(phase)) {
            // The synthetic guest uses the same inert startCurrentPhase scheduler as the host interceptor.
            // Start only the V2-projected current phase; never construct or invoke a detached picker.
            startedBatchPhases.add(phase);
            phase.start();
          }
          const handler = rig.guestScene.ui.getHandler() as unknown as {
            active?: boolean;
            isCoopV2InputActionable?: () => boolean;
          };
          return (
            phase?.phaseName === "CoopReplayLearnMoveBatchPhase"
            && rig.guestScene.ui.getMode() === UiMode.LEARN_MOVE_BATCH
            && handler.active === true
            && handler.isCoopV2InputActionable?.() === true
          );
        });
        const ownerRuntime = owner === "host" ? rig.hostRuntime : rig.guestRuntime;
        const ownerCtx = owner === "host" ? rig.hostCtx : rig.guestCtx;
        ownerLeaseInstalled = withClientSync(ownerCtx, () => !isCoopV2InteractionHumanInputFrozen(ownerRuntime));
        if (hostReady && guestReady && ownerLeaseInstalled) {
          return;
        }
        await withClient(ownerCtx, () => new Promise<void>(resolve => setTimeout(resolve, 10)));
      }
      throw new Error(
        `${owner}-owned batch panels never became actionable `
          + `(host=${hostPhaseName}/${hostReady} guest=${guestPhaseName}/${guestReady} `
          + `ownerLeaseInstalled=${ownerLeaseInstalled})`,
      );
    }

    it("GUEST-owned mon: guest DRIVES the panel, host applies, BOTH panels close (the P0 fix)", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
      const pair = createLoopbackPair();
      const rig: DuoRig = await buildDuo(game, pair, setCoopRuntime, toCoop);

      // Slot 1 is the GUEST-owned lead (buildDuo tags field[1].coopOwner = "guest"). Confirm the setup.
      const guestOwnedSlot = 1;
      giveFullMoveset(rig, guestOwnedSlot);
      const hostMon = rig.hostScene.getPlayerParty()[guestOwnedSlot];
      const guestMon = rig.guestScene.getPlayerParty()[guestOwnedSlot];
      expect(hostMon.coopOwner, "slot 1 is guest-owned on the host").toBe("guest");
      expect(hostMon.getMoveset(true).length, "the mon has a FULL moveset (pick/replace fires)").toBe(4);
      const forgottenMove = hostMon.moveset[0]!.moveId;
      await retireDuoInitialCommandForBoundaryTest(rig);

      // HOST (sole engine): the level-up learn, forced via the real batch phase. withClientSync = SEND-ONLY:
      // it streams the present (queued, NOT yet delivered) + opens the host's read-only WATCHER panel; the
      // await is parked. Keeping the present un-delivered here is what lets the GUEST listener open the panel
      // UNDER the guest ctx (a delivery under the host ctx would see isCoopAuthoritativeGuest()=false + skip).
      withClientSync(rig.hostCtx, () => {
        const phase = rig.hostScene.phaseManager.create("LearnMoveBatchPhase", guestOwnedSlot, [NEW_MOVE]);
        expect(
          rig.hostScene.phaseManager.overridePhase(phase),
          "the host batch watcher is the real current production phase",
        ).toBe(true);
        // PhaseInterceptor intentionally suppresses automatic current-phase starts. Production starts the
        // override synchronously; invoke that exact installed phase once and track it against re-entry.
        startedBatchPhases.add(phase);
        phase.start();
      });
      // The V2 prompt projects the guest overlay asynchronously. Wait for both exact phase/handler
      // generations and the guest's physical-input lease instead of equating one drain with UI readiness.
      await awaitBatchPanels(rig, "guest");

      // The guest human picks the replacement. withClientSync = SEND-ONLY: it clears the in-flight mark + relays
      // the terminal (queued) + closes the guest panel, all synchronously under the guest ctx; the host's await
      // then resolves under the HOST ctx in the next drain (not cross-ctx).
      withClientSync(rig.guestCtx, () => {
        // Adversarial shared-process schedule: public input starts on the real guest owner, but the phase's
        // production done callback resumes with the host runtime ambient. Its captured guest binding + relay
        // must still arm/cancel only the guest's exact retry state.
        invertRuntimeWhenPanelCommits(rig.guestScene, rig.hostRuntime);
      });
      await driveOwnerPickFirstSlot(rig, "guest");
      // THE P0: the OWNER (guest) signalled back + tore its picker down - it did NOT strand.
      expect(isCoopLearnMoveForwardInFlightEmpty(), "the guest released the picker (no strand - the P0 fix)").toBe(
        true,
      );
      expect(rig.guestScene.ui.getMode(), "the GUEST owner's panel CLOSED (the P0 fix)").not.toBe(
        UiMode.LEARN_MOVE_BATCH,
      );

      // HOST: the relayed terminal resolves the parked await under the HOST ctx; the host applies + closes.
      await withClient(rig.hostCtx, () => drainLoopback());
      expect(rig.hostScene.ui.getMode(), "the HOST watcher panel CLOSED").not.toBe(UiMode.LEARN_MOVE_BATCH);

      // The moveset converged: the HOST applied the guest's pick authoritatively (NEW_MOVE over slot 0).
      const hostMoves = hostMon.moveset.map(m => m.moveId);
      expect(hostMoves, "host applied the guest's pick: NEW_MOVE learned over the forgotten slot").toContain(NEW_MOVE);
      expect(hostMoves, "host: the chosen move was forgotten").not.toContain(forgottenMove);
      // The guest's local (cosmetic) copy converged to the same set.
      const guestMoves = guestMon.moveset.map(m => m.moveId);
      expect(guestMoves, "guest moveset converged to the host-authoritative set").toContain(NEW_MOVE);

      logs.flush();
    }, 120_000);

    it("HOST-owned mon: host DRIVES the panel, guest WATCHES, BOTH panels close", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
      const pair = createLoopbackPair();
      const rig: DuoRig = await buildDuo(game, pair, setCoopRuntime, toCoop);

      const hostOwnedSlot = 0; // buildDuo tags field[0].coopOwner = "host"
      giveFullMoveset(rig, hostOwnedSlot);
      const hostMon = rig.hostScene.getPlayerParty()[hostOwnedSlot];
      expect(hostMon.coopOwner, "slot 0 is host-owned").toBe("host");
      expect(hostMon.getMoveset(true).length, "the mon has a FULL moveset").toBe(4);
      const forgottenMove = hostMon.moveset[0]!.moveId;
      await retireDuoInitialCommandForBoundaryTest(rig);

      // HOST owns + DRIVES: withClientSync = SEND-ONLY. The batch phase opens the real OWNER panel on the host
      // (synchronous) + streams the present (queued, not yet delivered).
      withClientSync(rig.hostCtx, () => {
        const phase = rig.hostScene.phaseManager.create("LearnMoveBatchPhase", hostOwnedSlot, [NEW_MOVE]);
        expect(
          rig.hostScene.phaseManager.overridePhase(phase),
          "the host batch owner is the real current production phase",
        ).toBe(true);
        startedBatchPhases.add(phase);
        phase.start();
      });
      // The replica watcher and authority owner both have to prove the real panel before host input is legal.
      await awaitBatchPanels(rig, "host");

      // The HOST human picks (drives its own panel). withClientSync = SEND-ONLY: done() relays the terminal
      // (queued) + closes the host panel synchronously.
      withClientSync(rig.hostCtx, () => {
        // Reciprocal callback schedule: public input starts on the real host owner, then the production done
        // callback resumes with the guest runtime ambient. Retention must stay on the captured host ledger.
        invertRuntimeWhenPanelCommits(rig.hostScene, rig.guestRuntime);
      });
      await driveOwnerPickFirstSlot(rig, "host");
      expect(rig.hostScene.ui.getMode(), "the HOST owner's panel CLOSED").not.toBe(UiMode.LEARN_MOVE_BATCH);

      // GUEST: the relayed terminal (delivered under the guest ctx) force-closes the watcher panel.
      await withClient(rig.guestCtx, () => drainLoopback());
      expect(rig.guestScene.ui.getMode(), "the GUEST watcher panel CLOSED").not.toBe(UiMode.LEARN_MOVE_BATCH);
      expect(isCoopLearnMoveForwardInFlightEmpty(), "no learn-move picker left in-flight (no strand)").toBe(true);

      const hostMoves = hostMon.moveset.map(m => m.moveId);
      expect(hostMoves, "host learned NEW_MOVE over the forgotten slot").toContain(NEW_MOVE);
      expect(hostMoves, "host: the chosen move was forgotten").not.toContain(forgottenMove);

      logs.flush();
    }, 120_000);
  },
);
