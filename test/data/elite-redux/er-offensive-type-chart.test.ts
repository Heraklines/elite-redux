/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — offensive type-chart abilities (previously mis-wired with the
// DEFENSIVE TypeChartOverride, which changes how the holder is hit, not how its
// attacks land):
//
//   - GROUND_SHOCK — holder's Electric hits Ground targets for 0.5x (not 0x)
//   - MOLTEN_DOWN  — holder's Fire is super effective (2x) vs Rock
//   - PHANTOM_PAIN — holder's Ghost hits Normal targets for 1x (immunity pierced)
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("ER offensive type-chart abilities", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(100)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH]);
  });

  test("Ground Shock — Electric hits Ground for 0.5x instead of 0x", async () => {
    game.override.ability(ErAbilityId.GROUND_SHOCK as unknown as AbilityId).enemySpecies(SpeciesId.SANDSHREW); // pure Ground
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    expect(enemy.getAttackTypeEffectiveness(PokemonType.ELECTRIC, { source: player })).toBe(0.5);
  });

  test("Molten Down — Fire is super effective (2x) vs Rock", async () => {
    game.override.ability(ErAbilityId.MOLTEN_DOWN as unknown as AbilityId).enemySpecies(SpeciesId.ROGGENROLA); // pure Rock
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    expect(enemy.getAttackTypeEffectiveness(PokemonType.FIRE, { source: player })).toBe(2);
  });

  test("Phantom Pain — Ghost hits Normal for 1x (immunity pierced)", async () => {
    game.override.ability(ErAbilityId.PHANTOM_PAIN as unknown as AbilityId).enemySpecies(SpeciesId.RATTATA); // pure Normal
    await game.classicMode.startBattle(SpeciesId.GASTLY);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    expect(enemy.getAttackTypeEffectiveness(PokemonType.GHOST, { source: player })).toBe(1);
  });
});
