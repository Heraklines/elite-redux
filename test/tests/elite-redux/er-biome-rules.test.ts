/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER biome battle identity (#439 §3), GROUP A: ambient weather/terrain forced on
// biome entry. Vanilla biomes only BIAS weather (random pool) and never set
// terrain at all - these rules make the signature field GUARANTEED. ER_SCENARIO=1.
// =============================================================================

import { erBiomeForcedTerrain, erBiomeForcedWeather, getErBiomeRule } from "#data/elite-redux/er-biome-rules";
import { TerrainType } from "#data/terrain";
import { BiomeId } from "#enums/biome-id";
import { PokemonType } from "#enums/pokemon-type";
import { WeatherType } from "#enums/weather-type";
import { describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER biome battle identity - ambient weather/terrain (#439 §3)", () => {
  it("forces the signature WEATHER for baseline-weather biomes", () => {
    expect(erBiomeForcedWeather(BiomeId.DESERT)).toBe(WeatherType.SANDSTORM);
    expect(erBiomeForcedWeather(BiomeId.BADLANDS)).toBe(WeatherType.SANDSTORM);
    expect(erBiomeForcedWeather(BiomeId.ICE_CAVE)).toBe(WeatherType.SNOW);
    expect(erBiomeForcedWeather(BiomeId.SNOWY_FOREST)).toBe(WeatherType.SNOW);
    expect(erBiomeForcedWeather(BiomeId.GRAVEYARD)).toBe(WeatherType.FOG);
    expect(erBiomeForcedWeather(BiomeId.BEACH)).toBe(WeatherType.SUNNY);
  });

  it("forces the signature TERRAIN for terrain biomes (vanilla sets none)", () => {
    expect(erBiomeForcedTerrain(BiomeId.POWER_PLANT)).toBe(TerrainType.ELECTRIC);
    expect(erBiomeForcedTerrain(BiomeId.GRASS)).toBe(TerrainType.GRASSY);
    expect(erBiomeForcedTerrain(BiomeId.TALL_GRASS)).toBe(TerrainType.GRASSY);
    expect(erBiomeForcedTerrain(BiomeId.JUNGLE)).toBe(TerrainType.GRASSY);
    expect(erBiomeForcedTerrain(BiomeId.SPACE)).toBe(TerrainType.PSYCHIC);
  });

  it("leaves non-signature biomes on vanilla behavior (no forced weather/terrain)", () => {
    expect(erBiomeForcedWeather(BiomeId.TOWN)).toBeUndefined();
    expect(erBiomeForcedTerrain(BiomeId.TOWN)).toBeUndefined();
    // SEA biases rain via the vanilla pool but isn't FORCED - keep vanilla.
    expect(erBiomeForcedWeather(BiomeId.SEA)).toBeUndefined();
    // A weather biome doesn't also force terrain, and vice-versa.
    expect(erBiomeForcedTerrain(BiomeId.DESERT)).toBeUndefined();
    expect(erBiomeForcedWeather(BiomeId.POWER_PLANT)).toBeUndefined();
  });

  it("Group B: type-damage + accuracy field modifiers", () => {
    expect(getErBiomeRule(BiomeId.MOUNTAIN)?.typeBoost).toEqual({ type: PokemonType.FLYING, mult: 1.2 });
    expect(getErBiomeRule(BiomeId.MOUNTAIN)?.accuracyMult).toBe(0.95);
    expect(getErBiomeRule(BiomeId.VOLCANO)?.typeBoost).toEqual({ type: PokemonType.FIRE, mult: 1.2 });
    expect(getErBiomeRule(BiomeId.CAVE)?.darkness).toBe(true);
    expect(getErBiomeRule(BiomeId.SPACE)?.groundedAccuracyMult).toBe(0.9);
  });

  it("Groups C/D/E/F: switch-in, status, chip, and flags", () => {
    expect(getErBiomeRule(BiomeId.SEA)?.swimmerSpdDrop).toBe(true);
    expect(getErBiomeRule(BiomeId.SPACE)?.groundedSpdDrop).toBe(true);
    expect(getErBiomeRule(BiomeId.VOLCANO)?.entryStatus).toEqual({ kind: "burn", chance: 10 });
    expect(getErBiomeRule(BiomeId.ICE_CAVE)?.entryStatus).toEqual({ kind: "frostbite", chance: 10 });
    expect(getErBiomeRule(BiomeId.SWAMP)?.bogChip).toBe(true);
    expect(getErBiomeRule(BiomeId.PLAINS)?.runNeverFails).toBe(true);
    expect(getErBiomeRule(BiomeId.ABYSS)?.darkCritBoost).toBe(true);
    expect(getErBiomeRule(BiomeId.FAIRY_CAVE)?.fairyBlessing).toBe(true);
    expect(getErBiomeRule(BiomeId.BEACH)?.berrySaveChance).toBe(25);
  });

  it("encounter shape: double-battle odds + wild level bonus", () => {
    expect(getErBiomeRule(BiomeId.GRASS)?.doubleBattleMult).toBe(2);
    expect(getErBiomeRule(BiomeId.TALL_GRASS)?.doubleBattleMult).toBe(2);
    expect(getErBiomeRule(BiomeId.JUNGLE)?.wildLevelBonus).toBe(2);
    // These don't bleed into unrelated biomes.
    expect(getErBiomeRule(BiomeId.PLAINS)?.doubleBattleMult).toBeUndefined();
    expect(getErBiomeRule(BiomeId.GRASS)?.wildLevelBonus).toBeUndefined();
  });
});
