/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Chloroplast — "Weather Ball, Solar Beam/Blade, Growth, and recovery moves act
// as if used in sun." Verifies the move-layer hooks (userActsInSun) fire for a
// Chloroplast holder even with NO weather active.

import { allMoves } from "#data/data-lists";
import type { GrowthStatStageChangeAttr, PlantHealAttr } from "#data/moves/move";
import { WeatherInstantChargeAttr } from "#data/moves/move";
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import { BooleanHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("ER Ability - Chloroplast", () => {
  let pg: Phaser.Game;
  let game: GameManager;
  beforeAll(() => {
    pg = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(pg);
    game.override.battleStyle("single").enemySpecies(SpeciesId.MAGIKARP).enemyAbility(AbilityId.BALL_FETCH);
  });

  // Resolve moves by attr (robust to ER move-id remaps).
  const growthAttr = () => {
    const m = allMoves.find(mv => mv?.hasAttr("GrowthStatStageChangeAttr"))!;
    return m.getAttrs("GrowthStatStageChangeAttr")[0] as GrowthStatStageChangeAttr;
  };
  const weatherBall = () => allMoves.find(mv => mv?.hasAttr("WeatherBallTypeAttr"))!;
  const plantHeal = () => {
    const m = allMoves.find(mv => mv?.hasAttr("PlantHealAttr"))!;
    return { move: m, attr: m.getAttrs("PlantHealAttr")[0] as PlantHealAttr };
  };

  test("with Chloroplast and NO weather: sun behaviors fire", async () => {
    game.override.ability(ErAbilityId.CHLOROPLAST as unknown as AbilityId);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.field.getPlayerPokemon();

    // Growth → +2 (instead of +1)
    expect(growthAttr().getLevels(player)).toBe(2);
    // Weather Ball → Fire-type
    expect(player.getMoveType(weatherBall())).toBe(PokemonType.FIRE);
    // Solar move → instant charge (Solar's chargeAttr is a WeatherInstantChargeAttr
    // gated on sun; construct one with the same weather set and confirm it fires).
    const instant = new BooleanHolder(false);
    const solarCharge = new WeatherInstantChargeAttr([WeatherType.SUNNY, WeatherType.HARSH_SUN]);
    solarCharge.apply(player, null, weatherBall(), [instant]);
    expect(instant.value).toBe(true);
    // Moonlight/Synthesis/Morning Sun → 2/3 heal
    const ph = plantHeal();
    expect(ph.attr.getWeatherHealRatio(0 as any, player)).toBeCloseTo(2 / 3, 5);
    // Weather Ball → doubled power (base 50 → 100) as if in sun.
    const enemy = game.field.getEnemyPokemon();
    expect(weatherBall().calculateBattlePower(player, enemy)).toBe(weatherBall().power * 2);
  });

  test("with Solar Flare (366) and NO weather: sun behaviors fire too", async () => {
    game.override.ability(ErAbilityId.SOLAR_FLARE as unknown as AbilityId);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    expect(growthAttr().getLevels(player)).toBe(2);
    expect(player.getMoveType(weatherBall())).toBe(PokemonType.FIRE);
    // Sun-double (×2) fires; Solar Flare's Immolate part (Normal→Fire +20%)
    // stacks multiplicatively on top, so power is at least the doubled value.
    expect(weatherBall().calculateBattlePower(player, enemy)).toBeGreaterThanOrEqual(weatherBall().power * 2);
    const instant = new BooleanHolder(false);
    const solarCharge = new WeatherInstantChargeAttr([WeatherType.SUNNY, WeatherType.HARSH_SUN]);
    solarCharge.apply(player, null, weatherBall(), [instant]);
    expect(instant.value).toBe(true);
    expect(plantHeal().attr.getWeatherHealRatio(0 as any, player)).toBeCloseTo(2 / 3, 5);
  });

  test("without Chloroplast and NO weather: normal (non-sun) behavior", async () => {
    game.override.ability(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.field.getPlayerPokemon();
    expect(growthAttr().getLevels(player)).toBe(1); // +1 only
    expect(player.getMoveType(weatherBall())).not.toBe(PokemonType.FIRE); // stays its base type
  });
});
