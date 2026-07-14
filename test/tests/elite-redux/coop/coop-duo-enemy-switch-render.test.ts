/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op ENEMY faint-replacement RENDER (#845). A live co-op P0: a TRAINER sends its
// next mon after one of its on-field foes faints; on the HOST a real SwitchSummonPhase summons the
// replacement (2v2), but on the GUEST the new enemy arrives ONLY as authoritative DATA and is never
// RENDERED - the guest shows an empty slot (1v2) while the battle keeps functioning (the data is
// correct). Root: the full-state authoritative apply (CoopAuthoritativeBattleStateV1) seats a NEW
// Pokemon.id into a field slot via the reconstruct path, which builds the mon WITHOUT the field-summon
// presentation (sprite + battle info + field membership).
//
// The sibling coop-duo-trainer-mirror test asserts only DATA convergence (species-on-field + checksum),
// which the bug SLIPS THROUGH - the data is right, only the render is missing. This test asserts the
// RENDER-adjacent axis the harness CAN see headlessly: the switched-in enemy is `isOnField()` on the
// guest, the guest enemy field COUNT matches the host (2v2, not 1v2), and the turn converged with ZERO
// forced resyncs (a resync would HEAL the field and mask the render gap).
//
// To force the exact live code path (a NEW id, not one the guest already has), the guest's enemy BENCH
// is cleared right before the KO turn (the enemy bench is NOT in the per-turn checksum, so this triggers
// no resync). Then the checkpoint's species-match summon (reconcileCoopEnemyField) has no bench candidate
// to summon, leaving the authoritative full-state apply as the SOLE seater of the replacement - exactly
// the seam the P0 lives in.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-enemy-switch-render.test.ts
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
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Flip a freshly-built scene into the co-op game mode (shared by host + guest). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

/** Fire, no-immunity move the level-100 player OHKOs the low-level trainer mons with. */
const KO_MOVE = MoveId.FLAMETHROWER;
/** A NO-DAMAGE, single-target status move: nobody faints, so a post-switch turn leaves the field STABLE. */
const HOLD_MOVE = MoveId.THUNDER_WAVE;

describe.skipIf(!RUN)("co-op DUO enemy faint-replacement RENDER: guest summons the trainer's next mon (#845)", () => {
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
    logs = installDuoLogCapture(`enemy-switch-render-${Date.now()}`);
    game.override
      .battleStyle("double")
      .startingWave(11)
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER, trainerVariant: TrainerVariant.DOUBLE })
      .startingLevel(100)
      .moveset([KO_MOVE, HOLD_MOVE, MoveId.THUNDERBOLT, MoveId.BODY_SLAM]);
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

  /** Play ONE host turn: HOST slot uses `hostMove` (auto ENEMY), GUEST slot rides the relay (auto ENEMY_2). */
  async function playTurn(rig: DuoRig, hostMove: MoveId, guestMove: MoveId): Promise<void> {
    currentGuestMove = guestMove;
    const turn = rig.hostScene.currentBattle.turn;
    await arriveGuestCommandBoundary(rig, rig.hostScene.currentBattle.waveIndex, turn);
    await withClient(rig.hostCtx, async () => {
      game.move.select(hostMove, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
      await game.phaseInterceptor.to("TurnEndPhase");
    });
    await withClient(rig.guestCtx, () => driveGuestReplayTurn(rig.guestScene, turn));
  }

  it("renders the trainer's next mon on the guest after an enemy faint (2v2), not an empty slot", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR, SpeciesId.DRAGONITE, SpeciesId.TYRANITAR);
    expect(game.scene.currentBattle.battleType, "host is on a TRAINER wave").toBe(BattleType.TRAINER);
    expect(game.scene.currentBattle.trainer, "host has a trainer object").not.toBeNull();

    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    wireGuestCommand(rig);
    resyncProbe = installCoopResyncProbe(rig.guestRuntime);

    // Sanity: the ACE_TRAINER double has a bench past the 2 leads (the reserve the trainer sends in).
    const hostParty = rig.hostScene.getEnemyParty();
    expect(hostParty.length, "the ACE_TRAINER double fielded a bench past the 2 leads").toBeGreaterThan(2);

    // Wave-start parity (the mirror rebuilt the guest byte-identical to the host).
    const hostChk0 = await withClient(rig.hostCtx, () => captureCoopChecksum());
    const guestChk0 = await withClient(rig.guestCtx, () => captureCoopChecksum());
    expect(guestChk0, "wave-start: guest checksum matches host").toBe(hostChk0);

    const enemyLeadIdBefore = rig.hostScene.getEnemyField()[0]?.id;

    // KO turn: host FLAMETHROWERs the ENEMY-slot lead; guest THUNDER_WAVEs ENEMY_2 (no damage, survives).
    // The enemy trainer sends its next reserve at the turn BOUNDARY (the to("CommandPhase") crossing).
    await playTurn(rig, KO_MOVE, HOLD_MOVE);
    // playTurn already ran TurnEndPhase, which increments currentBattle.turn. Materialize that live next
    // boundary; adding another one asked the harness for a phantom turn that neither engine had reached.
    await arriveGuestCommandBoundary(rig, rig.hostScene.currentBattle.waveIndex, rig.hostScene.currentBattle.turn);
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("CommandPhase");
    });

    // The host summoned a new enemy into the vacated slot (a real switch).
    const enemyLeadIdAfter = rig.hostScene.getEnemyField()[0]?.id;
    const switched = enemyLeadIdAfter != null && enemyLeadIdAfter !== enemyLeadIdBefore;
    expect(switched, "the host trainer sent its next reserve after the ENEMY-slot KO").toBe(true);

    // FORCE THE LIVE PATH + expose the platform base. Two guest-side setups, both faithful to the live seam:
    //  (1) Remove the reserve (by host id) from the guest's enemy party so it is a NEW id the guest does not
    //      have -> the RECONSTRUCT path. The enemy bench is NOT in the per-turn checksum, so this trips no
    //      resync; it only removes the checkpoint's species-match summon candidate, leaving the AUTHORITATIVE
    //      full-state apply as the SOLE seater of the replacement.
    //  (2) SHIFT the surviving ally's base off the EnemyPokemon ctor's STATIC (236,84) default. In the live
    //      renderer the real enemy-platform base is NOT that static constant - `updateFieldScale` (>2 mons,
    //      bosses), fusions, and biome layout move it - so a freshly reconstructed reserve seated with the
    //      bare RELATIVE setFieldPosition (which only nudges by the slot-offset delta from the ctor default)
    //      lands OFF the live platform: the empty-slot P0. A correct summon derives the base from the LIVE
    //      ally (as summonCoopEnemyField does). Shifting the ally makes "inherit the live base" observable:
    //      the reserve's base must equal the ally's, NOT the stale ctor default.
    const allyShift = { dx: 120, dy: 90 };
    const allyId = await withClient(rig.guestCtx, () => {
      const guestEnemyParty = rig.guestScene.getEnemyParty();
      for (let i = guestEnemyParty.length - 1; i >= 0; i--) {
        if (guestEnemyParty[i]?.id === enemyLeadIdAfter) {
          guestEnemyParty.splice(i, 1);
        }
      }
      const survivor = rig.guestScene.getEnemyField().find(e => e.isOnField());
      if (survivor != null) {
        survivor.setPosition(survivor.x + allyShift.dx, survivor.y + allyShift.dy);
      }
      return survivor?.id;
    });
    expect(allyId, "a surviving guest enemy ally exists to anchor the platform base").toBeDefined();

    // HOLD turn: both slots THUNDER_WAVE (no damage) so nobody faints. The guest replays THIS turn, whose
    // authoritative state carries the trainer's send-out ON-FIELD - the guest must RENDER the replacement.
    await playTurn(rig, HOLD_MOVE, HOLD_MOVE);

    // isOnField() reads the process-global `globalScene`, so each side's render state MUST be read inside
    // that engine's client ctx (the last pump left globalScene = the guest). Capture the render-adjacent
    // facts per side under the correct scope.

    // The host is settled with two on-field enemies (2v2).
    const hostFacts = await withClient(rig.hostCtx, () => {
      const field = rig.hostScene.getEnemyField();
      return {
        onFieldCount: field.filter(e => e.isOnField()).length,
        species: field
          .filter(e => e.isOnField())
          .map(e => e.species.speciesId)
          .sort(),
      };
    });
    expect(hostFacts.onFieldCount, "host shows 2 on-field enemies (2v2)").toBe(2);

    // ===== THE ASSERTION UNDER TEST: the guest RENDERED the replacement, not just stored its data. =====
    const guestFacts = await withClient(rig.guestCtx, () => {
      const field = rig.guestScene.getEnemyField();
      const replacement = field.find(e => e.id === enemyLeadIdAfter);
      const ally = field.find(e => e.id === allyId);
      const base = (m: typeof replacement): [number, number] | null =>
        m == null ? null : [m.x - m.getFieldPositionOffset()[0], m.y - m.getFieldPositionOffset()[1]];
      return {
        hasReplacement: replacement != null,
        replacementOnField: replacement?.isOnField() ?? false,
        onFieldCount: field.filter(e => e.isOnField()).length,
        species: field
          .filter(e => e.isOnField())
          .map(e => e.species.speciesId)
          .sort(),
        replacementBase: base(replacement),
        allyBase: base(ally),
      };
    });
    expect(guestFacts.hasReplacement, "guest has the replacement mon (by host id) in its enemy field").toBe(true);
    expect(
      guestFacts.replacementOnField,
      "guest RENDERS the replacement on the field (isOnField) - not an empty slot (1v2 P0)",
    ).toBe(true);
    expect(guestFacts.onFieldCount, "guest shows 2 on-field enemies (2v2), matching the host - not 1v2").toBe(
      hostFacts.onFieldCount,
    );
    expect(guestFacts.species, "guest on-field enemy species match host after the switch").toEqual(hostFacts.species);

    // ===== RENDER-PRESENTATION: the reserve was SUMMONED onto the LIVE platform, not seated at the stale
    // ctor-default base. The reconstructed reserve must inherit the surviving ally's platform base (the same
    // base summonCoopEnemyField derives). At HEAD the bare RELATIVE setFieldPosition leaves it at the ctor
    // default (236,84), which the shifted ally no longer occupies -> the reserve renders off the platform
    // (the empty-slot P0). A faithful summon lands it on the ally's base.
    expect(guestFacts.replacementBase, "reserve has a resolvable field base").not.toBeNull();
    expect(guestFacts.allyBase, "ally has a resolvable field base").not.toBeNull();
    expect(
      guestFacts.replacementBase?.[0],
      "reserve X base is seated on the LIVE platform (the ally's base), not the stale ctor default (#845)",
    ).toBeCloseTo(guestFacts.allyBase?.[0] ?? Number.NaN, 1);
    expect(
      guestFacts.replacementBase?.[1],
      "reserve Y base is seated on the LIVE platform (the ally's base), not the stale ctor default (#845)",
    ).toBeCloseTo(guestFacts.allyBase?.[1] ?? Number.NaN, 1);

    // Zero forced resyncs: the render happened through the normal apply, not a heal that would mask it.
    expect(resyncProbe?.count(), "the enemy-switch turn converged with ZERO forced resyncs").toBe(0);

    logs.flush();
  }, 300_000);
});
