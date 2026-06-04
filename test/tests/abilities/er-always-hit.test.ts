/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — conditional "never miss" abilities (the never-miss piece was
// previously deferred):
//
//   - SHINY_LIGHTNING — Thunder never misses (+ 1.2x accuracy)
//   - ECHOLOCATION    — all moves never miss while in fog (+ 1.2x damage)
//
// Tests the exact predicate the move-effect phase reads
// (ConditionalAlwaysHitAbAttr.matches).
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ConditionalAlwaysHitAbAttr } from "#data/elite-redux/archetypes/conditional-always-hit";
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("ER conditional always-hit abilities", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingLevel(100)
      .enemyLevel(100)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SHUCKLE)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH]);
  });

  const alwaysHitAttr = (game: GameManager) => {
    const player = game.field.getPlayerPokemon();
    return player.getAbility().attrs.find(a => a instanceof ConditionalAlwaysHitAbAttr) as
      | ConditionalAlwaysHitAbAttr
      | undefined;
  };

  test("Shiny Lightning — Thunder always hits, other moves do not", async () => {
    game.override.ability(ErAbilityId.SHINY_LIGHTNING as unknown as AbilityId);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const attr = alwaysHitAttr(game);
    expect(attr).toBeDefined();
    expect(attr!.matches(allMoves[MoveId.THUNDER], player, enemy)).toBe(true);
    expect(attr!.matches(allMoves[MoveId.THUNDERBOLT], player, enemy)).toBe(false);
  });

  test("Echolocation — all moves always hit while in fog, never otherwise", async () => {
    game.override.ability(ErAbilityId.ECHOLOCATION as unknown as AbilityId);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    expect(player.getAbility().id).toBe(ErAbilityId.ECHOLOCATION);
    const attr = alwaysHitAttr(game);
    expect(attr).toBeDefined();

    game.scene.arena.trySetWeather(WeatherType.FOG);
    expect(attr!.matches(allMoves[MoveId.TACKLE], player, enemy)).toBe(true);

    game.scene.arena.trySetWeather(WeatherType.NONE);
    expect(attr!.matches(allMoves[MoveId.TACKLE], player, enemy)).toBe(false);
  });
});
