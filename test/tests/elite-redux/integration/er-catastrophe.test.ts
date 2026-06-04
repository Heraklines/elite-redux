/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Catastrophe 589 — "In Sun, Water moves gain the damage boost they receive
// from rain. In Rain, Fire moves gain the damage boost they receive from sun."
// I.e. a ×1.5 move-power boost gated by MOVE TYPE × weather. Verified via
// Move.calculateBattlePower (WATER_GUN / EMBER, base power 40 each).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import type { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Catastrophe (589)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("in Sun: Water moves get ×1.5 power, Fire moves do not", async () => {
    game.override
      .ability(ER_ID_MAP.abilities[589] as AbilityId) // Catastrophe
      .weather(WeatherType.SUNNY)
      .moveset([MoveId.WATER_GUN, MoveId.EMBER])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.POLITOED]);

    const user = game.scene.getPlayerPokemon()!;
    const target = game.scene.getEnemyPokemon()!;
    // base power 40; Water boosted to 60 in sun, Fire untouched at 40.
    expect(allMoves[MoveId.WATER_GUN].calculateBattlePower(user, target)).toBe(60);
    expect(allMoves[MoveId.EMBER].calculateBattlePower(user, target)).toBe(40);
  });

  it("in Rain: Fire moves get ×1.5 power, Water moves do not", async () => {
    game.override
      .ability(ER_ID_MAP.abilities[589] as AbilityId)
      .weather(WeatherType.RAIN)
      .moveset([MoveId.WATER_GUN, MoveId.EMBER])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.POLITOED]);

    const user = game.scene.getPlayerPokemon()!;
    const target = game.scene.getEnemyPokemon()!;
    expect(allMoves[MoveId.EMBER].calculateBattlePower(user, target)).toBe(60);
    expect(allMoves[MoveId.WATER_GUN].calculateBattlePower(user, target)).toBe(40);
  });
});
