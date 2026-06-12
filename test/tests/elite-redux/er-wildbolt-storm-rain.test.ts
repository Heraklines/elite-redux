/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// User report (#426): "Wildbolt Storm always misses in rain". In ER, Wildbolt
// Storm is 100 BP / 90% acc, SETS rain (ErWeatherRiderNoFailAttr extends
// WeatherChangeAttr) and - via the vanilla StormAccuracyAttr it keeps - NEVER
// misses while rain is up (battle accuracy resolves to -1, which hitCheck
// treats as a guaranteed hit). These tests pin that whole chain so a future
// patch pass can't silently drop one of the three attrs.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("ER #426 - Wildbolt Storm in rain", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .weather(WeatherType.RAIN)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .ability(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(100)
      .startingLevel(100)
      .moveset([MoveId.WILDBOLT_STORM]);
  });

  it("keeps all three attrs: rain no-miss, rain-setting rider, category pick", () => {
    const names = allMoves[MoveId.WILDBOLT_STORM].attrs.map(a => a?.constructor?.name);
    expect(names).toContain("StormAccuracyAttr");
    expect(names).toContain("ErWeatherRiderNoFailAttr");
    expect(names).toContain("PhotonGeyserCategoryAttr");
  });

  it("battle accuracy resolves to -1 (cannot miss) while rain is up", async () => {
    await game.classicMode.startBattle(SpeciesId.ZEKROM);
    const player = game.scene.getPlayerPokemon();
    const enemy = game.scene.getEnemyPokemon();
    expect(allMoves[MoveId.WILDBOLT_STORM].calculateBattleAccuracy(player!, enemy!)).toBe(-1);
  });

  it("actually lands and damages in rain", async () => {
    await game.classicMode.startBattle(SpeciesId.ZEKROM);
    const enemy = game.scene.getEnemyPokemon();
    game.move.select(MoveId.WILDBOLT_STORM);
    await game.toNextTurn();
    expect(enemy!.hp).toBeLessThan(enemy!.getMaxHp());
  });
});
