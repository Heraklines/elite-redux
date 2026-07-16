/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op TRAINER-WAVE mirror (#846). The dedicated proof that the harness
// mirror (mirrorHostBattleToGuest) rebuilds a TRAINER battle onto the guest FAITHFULLY -
// the fidelity the continuous soak (coop-soak.test.ts) now depends on to survey random
// trainer waves. Every other duo test drives a WILD battle; this one FORCES a trainer wave
// across both real engines and asserts:
//   1. WAVE-START checksum parity: host captureCoopChecksum() === guest's, byte-for-byte,
//      right after the mirror (the on-field enemies + arena + party the checksum hashes).
//   2. TRAINER-AWARE mirror fidelity: the guest battle carries the host's battleType
//      (TRAINER) + trainer object, the FULL enemy party (off-field BENCH included, not just
//      the on-field leads), and each enemy's AUTHORITATIVE trainerSlot (a variant-double
//      trainer alternates TrainerSlot.TRAINER / TRAINER_PARTNER, the slot-gating pool the
//      #419 fix keys reserve send-outs by) - was hardcoded TrainerSlot.NONE before #846.
//   3. ENEMY-SWITCH replay: the player KOs an on-field enemy; the host trainer sends its next
//      benched mon; the guest replays that turn through the per-turn checkpoint and CONVERGES
//      to the host's post-switch on-field enemy (checksum parity holds after the switch).
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-trainer-mirror.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { captureCoopChecksum } from "#data/elite-redux/coop/coop-battle-engine";
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
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { Move } from "#moves/move";
import { GameManager } from "#test/framework/game-manager";
import {
  arriveGuestCommandBoundary,
  buildDuo,
  type DuoRig,
  driveGuestReplayTurn,
  installDuoLogCapture,
  withClient,
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Flip a freshly-built scene into the co-op game mode (shared by host + guest). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

/** Fire, no-immunity move the level-100 player OHKOs the low-level trainer mons with (no type is Fire-immune). */
const KO_MOVE = MoveId.FLAMETHROWER;
/** A NO-DAMAGE, SINGLE-TARGET status move: play it so a post-switch turn leaves the field STABLE (nobody
 * faints), giving the guest a clean turn to replay the trainer's send-out through the checkpoint without
 * another switch churning it. Single-target (not spread) so game.move.select accepts an explicit target. */
const HOLD_MOVE = MoveId.THUNDER_WAVE;

describe.skipIf(!RUN)("co-op DUO trainer-wave mirror: two real engines, faithful TRAINER rebuild (#846)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;
  let accuracySpy: MockInstance | undefined;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    // Force every move to HIT (a determinism knob, not narrowing): the framework clamps the accuracy roll
    // to its worst case, so a sub-100 move would "miss" against a real trainer mon and stall the KO. Mirrors
    // the soak's own force-hit. Restored in afterEach.
    accuracySpy = vi.spyOn(Move.prototype, "calculateBattleAccuracy").mockReturnValue(-1);
    setCoopWaveBarrierMs(50);
    setCoopFaintSwitchWaitMs(4000);
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`trainer-mirror-${Date.now()}`);
    game.override
      .battleStyle("double")
      // A NON-fixed wave so the BATTLE_TYPE override + randomTrainer take effect (a fixed rival/evil wave
      // would ignore them). 11 is a plain wave (not %10 boss, not %10+1, not a rival/gym slot).
      .startingWave(11)
      .battleType(BattleType.TRAINER)
      // A variant DOUBLE trainer: TWO trainers -> a party whose bench alternates TrainerSlot.TRAINER /
      // TRAINER_PARTNER, so the mirror's trainerSlot carry is exercised on BOTH slot values (the #419
      // slot-gating pool). ACE_TRAINER has a full multi-mon template, so a bench exists past the 2 leads.
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER, trainerVariant: TrainerVariant.DOUBLE })
      // Level edge so the player OHKOs the trainer mons (as the soak does) - triggers the enemy send-out.
      .startingLevel(100)
      .moveset([KO_MOVE, HOLD_MOVE, MoveId.THUNDERBOLT, MoveId.BODY_SLAM]);
    // NB: KO_MOVE (Fire) and HOLD_MOVE (single-target status) are both in the set so the per-turn responder
    // can pick either; the two remaining slots are filler damaging moves.
  });

  afterEach(() => {
    setCoopWaveBarrierMs(60_000);
    setCoopFaintSwitchWaitMs(60_000);
    accuracySpy?.mockRestore();
    accuracySpy = undefined;
    logs.dispose();
    clearCoopRuntime();
    // #710 harness-citizenship: restore the host GameManager scene (buildDuo builds a 2nd BattleScene).
    initGlobalScene(game.scene);
  });

  afterAll(() => {
    // best-effort
  });

  // The guest OWN-slot command is answered from this mutable per-turn move (the production relay path reads
  // it each request). The host auto-cross-targets each player at the OPPOSITE enemy (bi0->ENEMY, bi1->
  // ENEMY_2), so we KO only ONE enemy by giving the HOST slot the KO move (ENEMY) and the GUEST slot the
  // no-damage HOLD move (ENEMY_2 survives) - a clean SINGLE enemy switch, no full-field-wipe / dup-species churn.
  let currentGuestMove: MoveId = KO_MOVE;

  /** Wire the guest's OWN-slot command answer from the current per-turn move (the relayed production path). */
  function wireGuestCommand(rig: DuoRig): void {
    rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => {
      const moveset = rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX]?.getMoveset() ?? [];
      const slot = moveset.findIndex(m => m?.moveId === currentGuestMove);
      return {
        command: Command.FIGHT,
        cursor: slot >= 0 && moveSlots.includes(slot) ? slot : (moveSlots[0] ?? 0),
        moveId: currentGuestMove,
        targets: [BattlerIndex.ENEMY_2],
      };
    });
  }

  /** Play ONE host turn: the HOST-owned slot uses `hostMove` (auto-targets ENEMY), the GUEST slot rides the
   * relay with `guestMove` (auto-targets ENEMY_2); guest replays the turn. Selecting ONLY the host slot is
   * the co-op faithful pattern (the soak driver's rule): double-selecting the partner slot leaks handlers. */
  async function playTurn(rig: DuoRig, hostMove: MoveId, guestMove: MoveId): Promise<void> {
    currentGuestMove = guestMove;
    const turn = rig.hostScene.currentBattle.turn;
    await arriveGuestCommandBoundary(rig, rig.hostScene.currentBattle.waveIndex, turn);
    await withClient(rig.hostCtx, async () => {
      game.move.select(hostMove, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });
    await withClient(rig.guestCtx, () => driveGuestReplayTurn(rig.guestScene, turn));
  }

  it("mirrors a TRAINER wave: wave-start parity, trainer/bench/trainerSlot fidelity, and an enemy switch", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR, SpeciesId.DRAGONITE, SpeciesId.TYRANITAR);
    // Confirm the host actually rolled a TRAINER wave (the override held) before we assert anything.
    expect(game.scene.currentBattle.battleType, "host is on a TRAINER wave").toBe(BattleType.TRAINER);
    expect(game.scene.currentBattle.trainer, "host has a trainer object").not.toBeNull();

    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    wireGuestCommand(rig);

    // ===== (1) WAVE-START checksum parity: the mirror rebuilt the guest byte-identical to the host. =====
    const hostChk0 = await withClient(rig.hostCtx, () => captureCoopChecksum());
    const guestChk0 = await withClient(rig.guestCtx, () => captureCoopChecksum());
    expect(guestChk0, "wave-start: guest checksum matches host (trainer wave mirrored faithfully)").toBe(hostChk0);

    // ===== (2) TRAINER-AWARE mirror fidelity: identity + FULL bench + per-slot trainerSlot. =====
    const guestBattle = rig.guestScene.currentBattle;
    expect(guestBattle.battleType, "guest battle is TRAINER").toBe(BattleType.TRAINER);
    expect(guestBattle.trainer, "guest carries the host trainer object").not.toBeNull();

    const hostParty = rig.hostScene.getEnemyParty();
    const guestParty = rig.guestScene.getEnemyParty();
    expect(guestParty.length, "guest rebuilt the FULL enemy party (off-field bench included)").toBe(hostParty.length);
    expect(hostParty.length, "the ACE_TRAINER double fielded a bench past the 2 leads").toBeGreaterThan(2);
    for (let i = 0; i < hostParty.length; i++) {
      expect(guestParty[i].species.speciesId, `enemy[${i}] species matches host`).toBe(hostParty[i].species.speciesId);
      expect(guestParty[i].trainerSlot, `enemy[${i}] trainerSlot carried from host (was NONE pre-#846)`).toBe(
        hostParty[i].trainerSlot,
      );
      // A trainer mon must be keyed to a real trainer slot (never NONE) so the AI's slot-gated send-out pool
      // is correct - the mirror must reproduce that, not collapse it to NONE.
      expect(guestParty[i].trainerSlot, `enemy[${i}] is a real trainer slot`).not.toBe(TrainerSlot.NONE);
    }
    // A variant DOUBLE fields BOTH slot values in its reserve pool (the #419 slot-gating the mirror must keep).
    const slots = new Set(hostParty.map(e => e.trainerSlot));
    expect(slots.has(TrainerSlot.TRAINER), "variant-double bench has a TRAINER-slot mon").toBe(true);
    expect(slots.has(TrainerSlot.TRAINER_PARTNER), "variant-double bench has a TRAINER_PARTNER-slot mon").toBe(true);

    // ===== (3) ENEMY SWITCH: KO the ENEMY-slot lead (leaving ENEMY_2 alive so the wave does not end), so the
    // host trainer sends its next benched mon. The send-out happens at the turn BOUNDARY (the host's
    // to("CommandPhase") crossing) and rides the NEXT turn's checkpoint onto the guest, where
    // reconcileCoopEnemyField summons the matching-species bench mon. So: a KO turn, then a HOLD (no-damage)
    // turn that leaves the field STABLE - the guest replays that turn's checkpoint and CONVERGES to the
    // host's post-switch on-field enemies + full checksum (no further churn re-switching the slot). =====
    const enemyLeadIdBefore = rig.hostScene.getEnemyField()[0]?.id;

    // KO turn: host FLAMETHROWERs the ENEMY-slot lead; guest GROWLs ENEMY_2 (no damage, ENEMY_2 survives).
    // Only the ENEMY slot faints -> a clean SINGLE trainer send-out. Cross so the trainer summons its next.
    await playTurn(rig, KO_MOVE, HOLD_MOVE);
    // The completed TurnEndPhase has already advanced the battle's turn. Use the materialized current
    // boundary instead of manufacturing a second increment that can only describe a phantom turn.
    await arriveGuestCommandBoundary(rig, rig.hostScene.currentBattle.waveIndex, rig.hostScene.currentBattle.turn);
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("CommandPhase");
    });
    const enemyLeadIdAfter = rig.hostScene.getEnemyField()[0]?.id;
    const switched = enemyLeadIdAfter != null && enemyLeadIdAfter !== enemyLeadIdBefore;
    expect(switched, "the host trainer sent its next benched mon after the ENEMY-slot KO (an enemy switch)").toBe(true);

    // HOLD turn: both slots GROWL (no damage) so nobody faints - the field is stable [switched-in mon,
    // ENEMY_2]. The guest replays THIS turn's checkpoint, whose enemy field carries the trainer's send-out.
    await playTurn(rig, HOLD_MOVE, HOLD_MOVE);

    // The guest must render the SAME post-switch on-field enemies as the host (species-identical field).
    const hostFieldSpecies = rig.hostScene.getEnemyField().map(e => e.species.speciesId);
    const guestFieldSpecies = rig.guestScene.getEnemyField().map(e => e.species.speciesId);
    expect(guestFieldSpecies, "guest on-field enemies match host after the switch").toEqual(hostFieldSpecies);

    // Post-switch checksum parity: the enemy-switch machinery replayed correctly through the checkpoint.
    const hostChk1 = await withClient(rig.hostCtx, () => captureCoopChecksum());
    const guestChk1 = await withClient(rig.guestCtx, () => captureCoopChecksum());
    expect(guestChk1, "post-enemy-switch: guest checksum matches host").toBe(hostChk1);

    logs.flush();
  }, 300_000);
});
