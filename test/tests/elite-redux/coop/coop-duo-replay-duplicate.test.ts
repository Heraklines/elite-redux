/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op DUPLICATE-REPLAY double-render (#822 / Track R cycle 13, campaign run 29662278577
// mystery lane address :2:2). A mystery-encounter BATTLE boot and the normal TurnStart both drive a
// CoopReplayTurnPhase for the SAME turn=1, so a DUPLICATE replay phase exists. The real instance drains
// the live-event stream via `consumeLiveEventsFrom`, which DELETES the events on drain. The duplicate
// then resolves with its OWN instance watermark `rendered=0` BEFORE the real instance's finalize marks
// the turn finalized (so the #790 finalizedMarks guard misses it): its turn-end `consumeLiveEvents`
// returns EMPTY, and `mergeLiveAndBatch` batch-FILLS the whole turn again, re-rendering every already-live
// -applied event -> double-applied damage/stat stages -> stable enemyParty divergence.
//
// THE FIX (coop-battle-stream.ts + coop-replay-turn-phase.ts): a SHARED per-turn `renderedThrough`
// watermark on the streamer. `consumeLiveEventsFrom` advances it as it drains, and the turn-end merge
// starts from MAX(this instance's rendered, the shared watermark) - so a duplicate phase (its own
// rendered=0) whose live events were already drained re-renders NOTHING already covered. The watermark is
// scoped to the live-event stream (cleared on session/authority reset + wave advance), so a legitimate
// post-resync re-render of a fresh turn address always starts at zero.
//
// This repro models the EXACT precondition deterministically: after a real host turn streams its live
// events, it drains them through the production `consumeLiveEventsFrom` (what the real replay instance
// does incrementally), then drives a DUPLICATE CoopReplayTurnPhase for the same turn and asserts it does
// NOT re-render the already-drained events (RED on tip: it batch-refills the whole turn; GREEN with the
// watermark: it renders nothing), while the guest still converges to the host-authoritative state.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-replay-duplicate.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
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
  buildDuo,
  type DuoRig,
  driveGuestReplayTurn,
  installDuoLogCapture,
  setCoopHarnessLiveEvents,
  withClient,
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The Coop presentation phases the replay pump unshifts per rendered event (the double-render tell). */
const REPLAY_PRESENTATION_PHASES = new Set([
  "CoopMoveAnimReplayPhase",
  "CoopHpDrainReplayPhase",
  "CoopStatStageReplayPhase",
  "CoopStatusReplayPhase",
  "CoopFaintReplayPhase",
]);

/** Flip a freshly-built scene into the co-op game mode (shared by host + guest). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)(
  "co-op DUO duplicate replay: a second turn-1 replay phase never re-renders the turn (#822)",
  () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;
    let logs: ReturnType<typeof installDuoLogCapture>;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      game = new GameManager(phaserGame);
      logs = installDuoLogCapture(`replay-duplicate-${Date.now()}`);
      // The live per-event stream is what a duplicate re-renders on top of - turn it ON for this file's swaps.
      setCoopHarnessLiveEvents(true);
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
      setCoopHarnessLiveEvents(false);
      logs.dispose();
      clearCoopRuntime();
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

    it("the duplicate turn-1 replay phase batch-refills NOTHING already drained; guest converges", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
      const pair = createLoopbackPair();
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
      wireGuestCommand(rig);

      // ===== HOST plays turn 1: it records + LIVE-streams moveUsed/hp/faint events (buffered by (turn, seq)
      // on the guest streamer) and, at the turn boundary, the authoritative `turnResolution` BATCH. =====
      const turn = rig.hostScene.currentBattle.turn;
      await withClient(rig.hostCtx, async () => {
        game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
        game.move.select(MoveId.TACKLE, COOP_GUEST_FIELD_INDEX, BattlerIndex.ENEMY_2);
        await game.phaseInterceptor.to("CoopTurnCommitPhase");
      });

      const streamer = rig.guestRuntime.battleStream;

      // ===== Model the REAL replay instance draining the live-event stream. `consumeLiveEventsFrom` is the
      // exact production call the pump makes per increment; it DELETES the events it drains (the root of the
      // #822 double-render) and advances the shared render watermark. Drain the whole turn's contiguous run
      // exactly as the pump would. =====
      let drainedLive = 0;
      await withClient(rig.guestCtx, () => {
        for (let seq = 0; ; ) {
          const run = streamer.consumeLiveEventsFrom(turn, seq);
          if (run.length === 0) {
            break;
          }
          drainedLive += run.length;
          seq += run.length;
        }
      });
      expect(drainedLive, "the real replay instance drained + DELETED the turn's live events").toBeGreaterThan(0);
      // The live buffer is now empty: a duplicate's turn-end consumeLiveEvents returns nothing.
      expect(
        streamer.consumeLiveEvents(turn).length,
        "the turn's live-event buffer is drained (a duplicate sees an empty live channel)",
      ).toBe(0);

      // ===== Now drive the DUPLICATE turn-1 CoopReplayTurnPhase (the phase the ME-battle boot spawns in
      // ADDITION to the normal TurnStart one). It has its OWN instance watermark rendered=0 and the turn is
      // NOT yet finalized, so the #790 guard does not stop it. Count the presentation phases it unshifts:
      //   - PRE-FIX: consumeLiveEvents is empty, so mergeLiveAndBatch batch-refills the WHOLE turn from index
      //     0 and re-renders every already-live-applied event (>0 presentation phases) -> the double-render.
      //   - POST-FIX: the shared watermark makes the merge start past the already-rendered positions, so the
      //     duplicate renders NOTHING (0 presentation phases). =====
      const unshiftSpy = vi.spyOn(rig.guestScene.phaseManager, "unshiftNew");
      await withClient(rig.guestCtx, async () => {
        await driveGuestReplayTurn(rig.guestScene, turn);
      });
      const duplicatePresentationPhases = unshiftSpy.mock.calls.filter(call =>
        REPLAY_PRESENTATION_PHASES.has(String(call[0])),
      ).length;
      unshiftSpy.mockRestore();

      // THE REGRESSION ASSERT: the duplicate re-rendered NONE of the already-drained turn events.
      expect(
        duplicatePresentationPhases,
        "the duplicate turn-1 replay phase re-rendered NO already-drained events (no #822 double-render)",
      ).toBe(0);

      // CONVERGENCE: the deferred checkpoint still snapped the guest to the host-authoritative post-turn state
      // (the duplicate rendering nothing never leaves the guest un-converged).
      expect(
        rig.guestScene.currentBattle.enemyParty.every(e => e.isFainted()),
        "the guest converged to the host-KOd state (checkpoint applied, no double-render)",
      ).toBe(true);
      for (const [i, hostEnemy] of rig.hostScene.currentBattle.enemyParty.entries()) {
        const guestEnemy = rig.guestScene.currentBattle.enemyParty[i];
        expect(guestEnemy?.hp, `guest enemy ${i} hp converged to the host`).toBe(hostEnemy.hp);
        expect(
          JSON.stringify(guestEnemy?.getStatStages() ?? null),
          `guest enemy ${i} stat stages converged to the host`,
        ).toBe(JSON.stringify(hostEnemy.getStatStages()));
      }

      logs.flush();
    }, 240_000);
  },
);
