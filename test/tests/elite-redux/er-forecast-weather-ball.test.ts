/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Forecast (59): ER adds "When USING a weather-setting move, follows up with
// Weather Ball (100 BP special, matching the set weather)" and is
// unsuppressable. The form-change half was already wired; the Weather-Ball
// follow-up was deferred.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allAbilities } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("Forecast — Weather Ball follow-up after a weather-setting move", () => {
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
      .ability(AbilityId.FORECAST)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(100)
      .startingLevel(100);
  });

  it("is unsuppressable", () => {
    expect(allAbilities[AbilityId.FORECAST].suppressable).toBe(false);
  });

  it("follows up with Weather Ball after using a weather-setting move (Rain Dance)", async () => {
    game.override.moveset([MoveId.RAIN_DANCE]);
    await game.classicMode.startBattle(SpeciesId.CASTFORM);
    const enemy = game.field.getEnemyPokemon();
    const hp0 = enemy.hp;

    game.move.use(MoveId.RAIN_DANCE);
    await game.toEndOfTurn();

    // The weather was set ...
    expect(game.scene.arena.weather?.weatherType).toBe(WeatherType.RAIN);
    // ... and the follow-up Weather Ball hit the foe (Rain Dance is a status
    // move that deals no damage, so any HP loss is the 100 BP Weather Ball).
    expect(enemy.hp).toBeLessThan(hp0);
  });
});
