/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op ENEMY faint-replacement CHAIN adoption (#867). A live P0 + the god-leg soak's
// deterministic finding (waves 44-47, #796 "event actor NOT on field ... SKIP apply" -> a
// saveDataDigest checksum MISMATCH every affected turn -> a stateSync heal). In a DOUBLE TRAINER
// battle the player KOs an enemy EVERY turn; the trainer sends its next reserve at the NEXT turn's
// start (a SwitchSummonPhase that SWAPS the enemy party array). Over a rapid faint chain the GUEST
// falls PERPETUALLY ONE SWITCH BEHIND: its enemy field slot holds the previous reserve while the
// host has already moved on, and its enemy PARTY (which rides the saveDataDigest) diverges from the
// host's - a checksum mismatch that forces an expensive full-state resync every turn.
//
// This test drives a multi-turn KO chain across two real engines and asserts, after each turn, the
// convergence axes the harness can see headlessly:
//   1. the guest's on-field enemy species match the host's (no empty slot / stale mon), and
//   2. ZERO forced resyncs across the whole chain (a resync would HEAL + mask the gap).
// A general enemy-switch/faint render-convergence guard (complements the #867 battleType-adopt fix).
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-enemy-faint-chain.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { captureCoopChecksum, captureCoopChecksumState } from "#data/elite-redux/coop/coop-battle-engine";
import { setCoopFaintSwitchWaitMs, setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { Move } from "#moves/move";
import { GameManager } from "#test/framework/game-manager";
import {
  arriveGuestCommandBoundary,
  buildDuo,
  type CoopResyncProbe,
  type DuoRig,
  driveGuestReplayTurn,
  installCoopResyncProbe,
  installDuoLogCapture,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

/** OHKO the level-100 player's target with (no type is Fire-immune among low trainer mons). */
const KO_MOVE = MoveId.FLAMETHROWER;
/** A NO-DAMAGE single-target status move: the guest slot never KOs, so ONLY the host slot's target faints. */
const HOLD_MOVE = MoveId.THUNDER_WAVE;

describe.skipIf(!RUN)(
  "co-op DUO enemy faint-replacement CHAIN: the guest never lags the trainer's send-outs (#867)",
  () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;
    let logs: ReturnType<typeof installDuoLogCapture>;
    let accuracySpy: MockInstance | undefined;
    let resyncProbe: CoopResyncProbe | undefined;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      accuracySpy = vi.spyOn(Move.prototype, "calculateBattleAccuracy").mockReturnValue(-1);
      setCoopWaveBarrierMs(50);
      setCoopFaintSwitchWaitMs(4000);
      game = new GameManager(phaserGame);
      logs = installDuoLogCapture(`enemy-faint-chain-${Date.now()}`);
      game.override
        .battleStyle("double")
        .startingWave(11)
        .battleType(BattleType.TRAINER)
        .randomTrainer({ trainerType: TrainerType.ACE_TRAINER, trainerVariant: TrainerVariant.DOUBLE })
        .startingLevel(100)
        .moveset([KO_MOVE, HOLD_MOVE, MoveId.THUNDERBOLT, MoveId.BODY_SLAM])
        .enemyMoveset(MoveId.SPLASH);
    });

    afterEach(() => {
      setCoopWaveBarrierMs(60_000);
      setCoopFaintSwitchWaitMs(60_000);
      accuracySpy?.mockRestore();
      accuracySpy = undefined;
      resyncProbe?.restore();
      resyncProbe = undefined;
      logs.dispose();
      clearCoopRuntime();
      initGlobalScene(game.scene);
    });

    afterAll(() => {
      // best-effort
    });

    /** Wire the guest's OWN-slot command answer: the harmless HOLD move against ENEMY_2 (never KOs). */
    function wireGuestCommand(rig: DuoRig): void {
      rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => {
        const moveset = rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX]?.getMoveset() ?? [];
        const slot = moveset.findIndex(m => m?.moveId === HOLD_MOVE);
        return {
          command: Command.FIGHT,
          cursor: slot >= 0 && moveSlots.includes(slot) ? slot : (moveSlots[0] ?? 0),
          moveId: HOLD_MOVE,
          targets: [BattlerIndex.ENEMY_2],
        };
      });
    }

    /** Play ONE host turn: the HOST slot KOs the ENEMY-slot lead; the GUEST slot rides the relay (HOLD, ENEMY_2). */
    async function playTurn(rig: DuoRig): Promise<void> {
      const turn = rig.hostScene.currentBattle.turn;
      await arriveGuestCommandBoundary(rig, rig.hostScene.currentBattle.waveIndex, turn);
      await withClient(rig.hostCtx, async () => {
        game.move.select(KO_MOVE, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
        await game.phaseInterceptor.to("CoopTurnCommitPhase");
      });
      await withClient(rig.guestCtx, () => driveGuestReplayTurn(rig.guestScene, turn));
    }

    it("guest enemy PARTY + on-field converge to the host across a faint-replacement chain", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR, SpeciesId.DRAGONITE, SpeciesId.TYRANITAR);
      expect(game.scene.currentBattle.battleType, "host is on a TRAINER wave").toBe(BattleType.TRAINER);

      const pair = createLoopbackPair();
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
      wireGuestCommand(rig);
      resyncProbe = installCoopResyncProbe(rig.guestRuntime);

      const hostParty = rig.hostScene.getEnemyParty();
      expect(hostParty.length, "the ACE_TRAINER double fielded a bench past the 2 leads").toBeGreaterThan(2);

      const hostChk0 = await withClient(rig.hostCtx, () => captureCoopChecksum());
      const guestChk0 = await withClient(rig.guestCtx, () => captureCoopChecksum());
      const hostState0 = await withClient(rig.hostCtx, () => captureCoopChecksumState());
      const guestState0 = await withClient(rig.guestCtx, () => captureCoopChecksumState());
      expect(guestState0, "wave-start: every canonical checksum component matches host").toEqual(hostState0);
      expect(guestChk0, "wave-start: guest checksum matches host").toBe(hostChk0);

      // Rapid faint chain: KO the ENEMY-slot lead every turn; the trainer sends its next reserve at the
      // next turn's start, so the guest must adopt each send-out through the per-turn apply, never lagging.
      const CHAIN_TURNS = 3;
      for (let t = 0; t < CHAIN_TURNS; t++) {
        // Stop if the host ran out of reserves (the wave would end).
        const aliveBench = withClientSync(
          rig.hostCtx,
          () => rig.hostScene.getEnemyParty().filter((e, i) => i >= 2 && e != null && !e.isFainted()).length,
        );
        if (aliveBench === 0) {
          break;
        }
        await playTurn(rig);

        // On-field enemy species must match host vs guest after each faint-replacement (no empty slot /
        // stale mon). Read each side's field under its OWN client ctx (isOnField reads the live globalScene).
        const hostField = withClientSync(rig.hostCtx, () =>
          rig.hostScene
            .getEnemyField()
            .filter(e => e?.isOnField())
            .map(e => e?.species?.speciesId)
            .sort((a, b) => (a ?? 0) - (b ?? 0)),
        );
        const guestField = withClientSync(rig.guestCtx, () =>
          rig.guestScene
            .getEnemyField()
            .filter(e => e?.isOnField())
            .map(e => e?.species?.speciesId)
            .sort((a, b) => (a ?? 0) - (b ?? 0)),
        );
        expect(guestField, `turn ${t + 1}: guest on-field enemy species match host`).toEqual(hostField);
      }

      expect(resyncProbe?.count(), "the faint-replacement chain converged with ZERO forced resyncs").toBe(0);

      logs.flush();
    }, 300_000);
  },
);
