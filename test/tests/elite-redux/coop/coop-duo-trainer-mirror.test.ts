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
import { captureCoopChecksum, captureCoopChecksumState } from "#data/elite-redux/coop/coop-battle-engine";
import { setCoopFaintSwitchWaitMs, setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { resetCoopRendezvousWaitMs, setCoopRendezvousWaitMs } from "#data/elite-redux/coop/coop-rendezvous";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import {
  getLastGenericTrainerType,
  resetGenericTrainerTracking,
  restoreGenericTrainerTracking,
} from "#data/elite-redux/er-generic-trainer-run-state";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { Move } from "#moves/move";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  type DuoRig,
  driveDuoGuestTackleThroughPublicUi,
  driveGuestReplayTurn,
  installDuoLogCapture,
  withClient,
} from "#test/tools/coop-duo-harness";
import { getPokemonSpecies } from "#utils/pokemon-utils";
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
    // The public two-client driver now keeps both real command surfaces alive concurrently. Use the
    // production rendezvous budget so a slower headless renderer cannot terminalize an otherwise-valid
    // second-turn CONTROL_COMMIT after the old 50 ms Vitest default.
    setCoopRendezvousWaitMs(60_000);
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
    resetCoopRendezvousWaitMs();
    accuracySpy?.mockRestore();
    accuracySpy = undefined;
    resetGenericTrainerTracking();
    logs.dispose();
    clearCoopRuntime();
    // #710 harness-citizenship: restore the host GameManager scene (buildDuo builds a 2nd BattleScene).
    initGlobalScene(game.scene);
  });

  afterAll(() => {
    // best-effort
  });

  /** Play one turn through both clients' public COMMAND/FIGHT/TARGET handlers. */
  async function playTurn(rig: DuoRig, hostMove: MoveId, guestMove: MoveId): Promise<void> {
    const turn = rig.hostScene.currentBattle.turn;
    await driveDuoGuestTackleThroughPublicUi(game, rig, {
      restartAlreadyOpenHost: false,
      submitHostTackle: true,
      hostMoveId: hostMove,
      guestMoveId: guestMove,
      hostTarget: BattlerIndex.ENEMY,
      guestTarget: BattlerIndex.ENEMY_2,
    });
    await withClient(rig.hostCtx, async () => {
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

    // ===== (1) WAVE-START checksum parity: the mirror rebuilt the guest byte-identical to the host. =====
    const hostChk0 = await withClient(rig.hostCtx, () => captureCoopChecksum());
    const guestChk0 = await withClient(rig.guestCtx, () => captureCoopChecksum());
    const hostState0 = await withClient(rig.hostCtx, () => captureCoopChecksumState());
    const guestState0 = await withClient(rig.guestCtx, () => captureCoopChecksumState());
    expect(guestState0, "wave-start: every canonical trainer checksum component matches host").toEqual(hostState0);
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
    // Only the ENEMY slot faints -> a clean SINGLE trainer send-out.
    await playTurn(rig, KO_MOVE, HOLD_MOVE);

    // HOLD turn: both slots GROWL (no damage) so nobody faints - the field is stable [switched-in mon,
    // ENEMY_2]. Entering its real command boundary summons the reserve; its checkpoint carries that send-out.
    await playTurn(rig, HOLD_MOVE, HOLD_MOVE);
    const enemyLeadIdAfter = rig.hostScene.getEnemyField()[0]?.id;
    const switched = enemyLeadIdAfter != null && enemyLeadIdAfter !== enemyLeadIdBefore;
    expect(switched, "the host trainer sent its next benched mon after the ENEMY-slot KO (an enemy switch)").toBe(true);

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

  it("retires a double-KO turn before rendering both enemy switch-ins when the renderer rolled a different trainer cursor", async () => {
    // Live wave-14 failure: Heat Wave KO'd both enemy leads. The host emitted two switch events, but the
    // renderer's transient trainer construction had advanced erLastGenericTrainerType through a different
    // rarity pool. That one module value split saveDataDigest, so TURN_COMMIT stayed pending and both already-
    // received switch-ins remained trapped behind it until the authority deadline terminated the session.
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR, SpeciesId.DRAGONITE, SpeciesId.TYRANITAR);
    // Random double trainers can legally roll only three total party members. The live failure had one reserve
    // for each lead, and partnered trainer switches are slot-gated, so cardinality alone cannot manufacture
    // that precondition. Add only the missing reserve for each real lead slot before buildDuo mirrors the
    // battle; command, faint, switch scheduling, transport, replay, and presentation all remain production.
    const hostBattle = game.scene.currentBattle;
    const enemyLeads = game.scene.getEnemyField();
    const enemyLeadIds = new Set(enemyLeads.map(mon => mon.id));
    for (const trainerSlot of new Set(enemyLeads.map(mon => mon.trainerSlot))) {
      const leadCount = enemyLeads.filter(mon => mon.trainerSlot === trainerSlot).length;
      const lead = enemyLeads.find(mon => mon.trainerSlot === trainerSlot)!;
      while (
        hostBattle.enemyParty.filter(mon => mon.trainerSlot === trainerSlot && !enemyLeadIds.has(mon.id)).length
        < leadCount
      ) {
        hostBattle.enemyParty.push(
          game.scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.SHUCKLE), lead.level, trainerSlot),
        );
      }
    }
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    expect(rig.hostScene.getEnemyParty().length, "the double trainer has two reserve switch-ins").toBeGreaterThan(3);

    const leadsBefore = rig.hostScene.getEnemyField().map(mon => mon.id);
    const turn = rig.hostScene.currentBattle.turn;
    await driveDuoGuestTackleThroughPublicUi(game, rig, {
      restartAlreadyOpenHost: false,
      submitHostTackle: true,
      hostMoveId: KO_MOVE,
      guestMoveId: KO_MOVE,
      hostTarget: BattlerIndex.ENEMY,
      guestTarget: BattlerIndex.ENEMY_2,
    });
    const authorityTrainerCursor = TrainerType.MUSICIAN;
    await withClient(rig.hostCtx, async () => {
      restoreGenericTrainerTracking(authorityTrainerCursor);
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });

    // Model the renderer's observed RARE-vs-COMMON shell roll immediately before the immutable host turn is
    // applied. Pre-fix this exact value survived every retry because no authority carrier owned it.
    await withClient(rig.guestCtx, async () => {
      restoreGenericTrainerTracking(TrainerType.HIKER);
      await driveGuestReplayTurn(rig.guestScene, turn);
    });
    expect(getLastGenericTrainerType(), "turn material restored the host's trainer no-repeat cursor").toBe(
      authorityTrainerCursor,
    );

    // Run one harmless turn so both switch presentations have crossed the retained boundary and the field is
    // stable. If the old turn cannot retire, this public-command round never opens and the test times out/fails.
    await playTurn(rig, HOLD_MOVE, HOLD_MOVE);
    const leadsAfter = rig.hostScene.getEnemyField().map(mon => mon.id);
    expect(leadsAfter, "both trainer slots replaced their KO'd leads").toHaveLength(2);
    expect(leadsAfter[0], "slot 0 received a different reserve").not.toBe(leadsBefore[0]);
    expect(leadsAfter[1], "slot 1 received a different reserve").not.toBe(leadsBefore[1]);

    const hostFieldSpecies = rig.hostScene.getEnemyField().map(mon => mon.species.speciesId);
    const guestFieldSpecies = rig.guestScene.getEnemyField().map(mon => mon.species.speciesId);
    expect(guestFieldSpecies, "the renderer presented both authoritative switch-ins").toEqual(hostFieldSpecies);
    const hostChecksum = await withClient(rig.hostCtx, () => captureCoopChecksum());
    const guestChecksum = await withClient(rig.guestCtx, () => captureCoopChecksum());
    expect(guestChecksum, "the double-KO replacement turn converged end-to-end").toBe(hostChecksum);
    logs.flush();
  }, 300_000);
});
