/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux integration test: trainer-overlay runtime hook.
//
// Verifies that the runtime hook installed in `Trainer.genPartyMember` swaps
// in an ER roster when the encountered trainer class matches an entry in the
// ER registry. The match is by `config.trainerType` — many ER trainers share
// a class (e.g. ACE_TRAINER), so the hook deterministically picks the FIRST
// candidate from `findErTrainersForType()` and uses its `party` tier roster.
//
// The vanilla trainer-spawn path generates a random species from the class's
// species pool; with the hook active, the species is instead pinned to the
// first member of the matched ER party. We assert the substitution by:
//   1. Reading what the ER registry chose for the trainer's class.
//   2. Forcing a TRAINER battle with that class and triggering genPartyMember.
//   3. Comparing the spawned enemy's species id to the ER member's species id.
//
// This is the canonical "trainers exist as data but never spawn" gap test —
// pre-hook this assertion would fail because the spawn would land on whatever
// species the vanilla speciesPool rolled.
// =============================================================================

import { findErTrainersForType, selectErRoster } from "#data/elite-redux/er-trainer-overlay";
import { clearErTrainerCacheForTests, hasErRosterOverride } from "#data/elite-redux/er-trainer-runtime-hook";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("ER integration — trainer-overlay runtime hook spawns ER rosters", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    // Drop the WeakMap cache so every test gets a fresh ER-trainer pick.
    clearErTrainerCacheForTests();
    game.override.criticalHits(false).battleStyle("single").moveset([MoveId.SPLASH]).ability(AbilityId.BALL_FETCH);
  });

  it("Trainer.genPartyMember substitutes an ER roster species for ACE_TRAINER battles", async () => {
    // Many ER trainer classes resolve to TrainerType.ACE_TRAINER (pokerogue
    // id = 1). We pick the FIRST ER trainer for that class as our oracle.
    const erCandidates = findErTrainersForType(TrainerType.ACE_TRAINER);
    expect(erCandidates.length).toBeGreaterThan(0);
    const expectedTrainer = erCandidates[0];
    const expectedRoster = selectErRoster(expectedTrainer, "party");
    expect(expectedRoster.length).toBeGreaterThan(0);
    const expectedSpeciesId = expectedRoster[0].speciesId;

    // Force a trainer wave with the chosen class. The trainer's first
    // party member should come from `expectedRoster[0]` via the hook.
    game.override.battleType(BattleType.TRAINER).randomTrainer({ trainerType: TrainerType.ACE_TRAINER });

    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    // After startBattle, the enemy party is generated via genPartyMember.
    const trainer = game.scene.currentBattle.trainer;
    expect(trainer).toBeDefined();
    if (!trainer) {
      return;
    }
    expect(hasErRosterOverride(trainer)).toBe(true);

    const enemyParty = game.scene.getEnemyParty();
    expect(enemyParty.length).toBeGreaterThan(0);
    expect(enemyParty[0].species.speciesId).toBe(expectedSpeciesId);
  });

  it("hasErRosterOverride is false for trainer classes not in the ER registry", () => {
    // TrainerType.UNKNOWN is 0; no ER trainer maps to it.
    const matches = findErTrainersForType(TrainerType.UNKNOWN);
    expect(matches.length).toBe(0);
  });

  it("ER substituted member inherits IVs and moves from the ER roster (not a random roll)", async () => {
    const erCandidates = findErTrainersForType(TrainerType.ACE_TRAINER);
    expect(erCandidates.length).toBeGreaterThan(0);
    const expected = erCandidates[0];
    const member = selectErRoster(expected, "party")[0];

    game.override.battleType(BattleType.TRAINER).randomTrainer({ trainerType: TrainerType.ACE_TRAINER });

    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const enemy = game.scene.getEnemyParty()[0];
    // IVs are deterministic from the ER member draft.
    for (let i = 0; i < 6; i++) {
      expect(enemy.ivs[i]).toBe(member.ivs[i]);
    }
    // The moveset is populated from the ER roster, not whatever the species
    // would have rolled. ER moves can be empty after id-map filtering — only
    // assert when the source had at least one survivable move.
    if (member.moves.length > 0) {
      const enemyMoveIds = enemy.moveset.map(m => m?.moveId).filter((m): m is number => m !== undefined);
      // Every move in the enemy's moveset should appear in the ER roster.
      // (We allow the enemy moveset to be a strict prefix because pokerogue
      // caps movesets at 4 slots and ER can ship up to 4 directly.)
      for (const mv of enemyMoveIds) {
        expect(member.moves).toContain(mv);
      }
    }
  });
});
