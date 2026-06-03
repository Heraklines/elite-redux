/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER per-move accuracy-set abilities (Hypnotist 327 / Lunar Eclipse 365 →
// Hypnosis 90%; Lullaby 786 → Sing 90%). These SET the move's base accuracy
// (Hypnosis base 60 → 90) while leaving accuracy/evasion stage modifiers to
// apply on top — NOT a never-miss. Verified via Move.calculateBattleAccuracy.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER per-move accuracy set (Hypnotist / Lunar Eclipse)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("Hypnotist raises Hypnosis' base accuracy from 60 to 90 (not a never-miss)", async () => {
    game.override
      .ability(ER_ID_MAP.abilities[327] as AbilityId) // Hypnotist
      .moveset([MoveId.HYPNOSIS])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.ABRA]);

    const user = game.scene.getPlayerPokemon()!;
    const target = game.scene.getEnemyPokemon()!;
    const acc = allMoves[MoveId.HYPNOSIS].calculateBattleAccuracy(user, target);
    // Base accuracy is set to 90 (not -1 / never-miss).
    expect(acc).toBe(90);
  });

  it("a user WITHOUT the ability keeps Hypnosis' base 60 accuracy", async () => {
    game.override
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.HYPNOSIS])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.ABRA]);

    const user = game.scene.getPlayerPokemon()!;
    const target = game.scene.getEnemyPokemon()!;
    expect(allMoves[MoveId.HYPNOSIS].calculateBattleAccuracy(user, target)).toBe(60);
  });

  it("Lunar Eclipse also raises Hypnosis to 90 (clause previously dropped)", async () => {
    game.override
      .ability(ER_ID_MAP.abilities[365] as AbilityId) // Lunar Eclipse
      .moveset([MoveId.HYPNOSIS])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.ABRA]);

    const user = game.scene.getPlayerPokemon()!;
    const target = game.scene.getEnemyPokemon()!;
    expect(allMoves[MoveId.HYPNOSIS].calculateBattleAccuracy(user, target)).toBe(90);
  });
});
