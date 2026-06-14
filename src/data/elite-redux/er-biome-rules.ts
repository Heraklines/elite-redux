/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Biome battle identity (#439 §3) - the data spine.
//
// Every biome gets a signature battle rule so biomes feel distinct to fight in,
// not just different spawn tables. This file is the SINGLE editable table; the
// thin hook sites across the battle phases read from it.
//
// LOCKED (#439 §6.2): biome battle rules apply on ALL difficulties (incl.
// Ace/Youngster). "Pure vanilla" still governs SPAWNS and item pools there, but
// the world flavor (weather, terrain, hazards, field rules) is universal.
//
// Implemented in verified groups:
//   GROUP A (THIS PASS): ambient WEATHER + TERRAIN forced on biome entry.
//   GROUP B (next): type-damage + accuracy field modifiers
//                   (Mountain Flying+20%/acc-5%, Volcano Fire+20%, Cave/Space acc).
//   GROUP C: switch-in stat drops (Sea non-swimmer -1 Spd, Space grounded -1 Spd).
//   GROUP D: entry status risk (Volcano burn, Ice Cave frostbite; warm-item exempt).
//   GROUP E: turn-end chip (Swamp bog 1/16 on grounded non-Poison/Steel).
//   GROUP F: misc flags (Plains run-never-fails, Abyss Dark +1 crit,
//            Fairy Cave infatuation-immune + faster status heal, Beach berry-save).
//   (Encounter-shape rules - Forest ambush, Dojo all-trainer, Jungle +2 lv,
//    Temple totem, Island regionals, Grass double-battle - are a later batch:
//    they touch encounter generation, not the in-battle field.)
// =============================================================================

import { TerrainType } from "#data/terrain";
import { BiomeId } from "#enums/biome-id";
import { WeatherType } from "#enums/weather-type";

/** One biome's battle-identity config. Fields are consumed by their group's hook. */
export interface ErBiomeRule {
  /** GROUP A: weather FORCED on biome entry (baseline/always), overriding the
   *  vanilla random weatherPool roll. Persists across the biome's waves. */
  weather?: WeatherType;
  /** GROUP A: terrain FORCED on biome entry. Vanilla terrainPools are all empty
   *  (NONE), so this is how biome terrain exists at all. Persists across waves. */
  terrain?: TerrainType;
}

/**
 * The biome battle-identity table. Only biomes with a rule appear; everything
 * else keeps vanilla behavior. Weather notes: several biomes already BIAS toward
 * their signature weather via vanilla weatherPools (Sea rain, Volcano sun, etc.)
 * - those are left to the pool. The entries here are the ones the design doc
 * calls "baseline"/"always", i.e. GUARANTEED on entry, not just likely.
 */
const ER_BIOME_RULES: Partial<Record<BiomeId, ErBiomeRule>> = {
  // --- GROUP A: forced ambient weather ---
  // "sandstorm baseline" deserts/badlands (the pool only makes it ~likely).
  [BiomeId.BADLANDS]: { weather: WeatherType.SANDSTORM },
  [BiomeId.DESERT]: { weather: WeatherType.SANDSTORM },
  // "hail/snow baseline" - ER uses SNOW (the modern chip-less snow).
  [BiomeId.ICE_CAVE]: { weather: WeatherType.SNOW },
  [BiomeId.SNOWY_FOREST]: { weather: WeatherType.SNOW },
  // "FOG baseline" - the eerie graveyard (uses the ER fog rework).
  [BiomeId.GRAVEYARD]: { weather: WeatherType.FOG },
  // "sunny" beachfront.
  [BiomeId.BEACH]: { weather: WeatherType.SUNNY },

  // --- GROUP A: forced ambient terrain (vanilla never sets terrain) ---
  // "Electric terrain always on."
  [BiomeId.POWER_PLANT]: { terrain: TerrainType.ELECTRIC },
  // Grassy overgrowth.
  [BiomeId.GRASS]: { terrain: TerrainType.GRASSY },
  [BiomeId.TALL_GRASS]: { terrain: TerrainType.GRASSY },
  [BiomeId.JUNGLE]: { terrain: TerrainType.GRASSY },
  // "Psychic terrain pulses" - zero-g cosmos.
  [BiomeId.SPACE]: { terrain: TerrainType.PSYCHIC },
};

/** The forced ambient weather for a biome, or undefined (keep vanilla pool). */
export function erBiomeForcedWeather(biomeId: BiomeId): WeatherType | undefined {
  return ER_BIOME_RULES[biomeId]?.weather;
}

/** The forced ambient terrain for a biome, or undefined (keep vanilla pool). */
export function erBiomeForcedTerrain(biomeId: BiomeId): TerrainType | undefined {
  return ER_BIOME_RULES[biomeId]?.terrain;
}
