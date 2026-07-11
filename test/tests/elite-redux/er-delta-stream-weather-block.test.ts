/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Delta Stream (er 191) weather-based-move block.
//
// DEX (2.65): on top of the STRONG_WINDS super-effective neutralization, Delta
// Stream makes "weather-based moves not usable" (Weather Ball, the weather
// setters, the Solar charge moves), mirroring how Desolate Land / Primordial Sea
// make Fire / Water moves fizzle. Routed through the existing
// arena.isMoveWeatherCancelled seam (consumed by move-phase / AI move filter).
// =============================================================================

import { allMoves } from "#data/data-lists";
import { isErWeatherBasedMove } from "#data/weather";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("ER Delta Stream — weather-based moves blocked", () => {
  it("classifies Weather Ball and the weather setters as weather-based", () => {
    expect(isErWeatherBasedMove(allMoves[MoveId.WEATHER_BALL])).toBe(true);
    expect(isErWeatherBasedMove(allMoves[MoveId.RAIN_DANCE])).toBe(true);
    expect(isErWeatherBasedMove(allMoves[MoveId.SOLAR_BEAM])).toBe(true);
    // A normal attack is NOT weather-based.
    expect(isErWeatherBasedMove(allMoves[MoveId.TACKLE])).toBe(false);
  });

  describe("behavior", () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      game = new GameManager(phaserGame);
      game.override
        .criticalHits(false)
        .battleStyle("single")
        .ability(AbilityId.BALL_FETCH)
        .enemyAbility(AbilityId.DELTA_STREAM) // sets STRONG_WINDS on entry
        .enemySpecies(SpeciesId.SNORLAX)
        .enemyMoveset(MoveId.SPLASH)
        .moveset(MoveId.WEATHER_BALL)
        .startingLevel(80)
        .enemyLevel(80);
    });

    it("Weather Ball fizzles against Delta Stream's opponent (STRONG_WINDS)", async () => {
      await game.classicMode.startBattle(SpeciesId.PIKACHU);
      expect(game.scene.arena.weather?.weatherType, "Delta Stream set strong winds").toBe(WeatherType.STRONG_WINDS);
      const enemy = game.field.getEnemyPokemon();
      const before = enemy.hp;

      game.move.select(MoveId.WEATHER_BALL);
      await game.phaseInterceptor.to("TurnEndPhase");

      // The weather-based move was cancelled — the foe took no damage.
      expect(enemy.hp).toBe(before);
    });
  });
});
