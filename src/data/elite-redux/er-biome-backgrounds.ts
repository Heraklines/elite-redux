/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BiomeId } from "#enums/biome-id";
import { TimeOfDay } from "#enums/time-of-day";

export interface ErBiomeBackgroundSet {
  readonly day: string;
  readonly dusk?: string;
  readonly night?: string;
  /** Indoor/underground art and hand-painted lighting should bypass the time tint shader. */
  readonly ignoreTimeTint?: boolean;
}

export interface ResolvedErBiomeBackground {
  readonly textureKey: string;
  readonly ignoreTimeTint: boolean;
}

const single = (textureKey: string, ignoreTimeTint = false): ErBiomeBackgroundSet => ({
  day: textureKey,
  ignoreTimeTint,
});

const timed = (day: string, dusk: string, night: string): ErBiomeBackgroundSet => ({
  day,
  dusk,
  night,
  ignoreTimeTint: true,
});

/**
 * Coherent background scene sets. A scene is selected once per biome visit; its
 * day/dusk/night frame then follows the arena clock without changing location.
 */
export const ER_BIOME_BACKGROUND_SETS = {
  [BiomeId.TOWN]: [
    single("town_bg"),
    timed("town_bg_courtyard_day", "town_bg_courtyard_dusk", "town_bg_courtyard_night"),
  ],
  [BiomeId.GRASS]: [
    single("grass_bg"),
    timed("grass_bg_rocky_day", "grass_bg_rocky_dusk", "grass_bg_rocky_night"),
  ],
  [BiomeId.TALL_GRASS]: [
    single("tall_grass_bg"),
    timed("tall_grass_bg_field_day", "tall_grass_bg_field_night", "tall_grass_bg_field_night"),
  ],
  [BiomeId.METROPOLIS]: [
    timed("metropolis_bg", "metropolis_bg_dusk", "metropolis_bg_night"),
    timed("metropolis_bg_east_day", "metropolis_bg_east_dusk", "metropolis_bg_east_night"),
    timed("metropolis_bg_west_day", "metropolis_bg_west_dusk", "metropolis_bg_west_night"),
    timed("metropolis_bg_park_day", "metropolis_bg_park_dusk", "metropolis_bg_park_night"),
    single("metropolis_bg_mart", true),
  ],
  [BiomeId.FOREST]: [
    single("forest_bg"),
    timed("forest_bg_path_day", "forest_bg_path_night", "forest_bg_path_night"),
    single("forest_bg_shadowmoon", true),
  ],
  [BiomeId.SEA]: [
    single("sea_bg"),
    timed("sea_bg_open_day", "sea_bg_open_night", "sea_bg_open_night"),
  ],
  [BiomeId.SWAMP]: [
    single("swamp_bg"),
    single("swamp_bg_wetlands"),
    single("swamp_bg_path"),
    single("swamp_bg_shadowmoon", true),
  ],
  [BiomeId.BEACH]: [
    single("beach_bg"),
    timed("beach_bg_shore_day", "beach_bg_shore_dusk", "beach_bg_shore_night"),
  ],
  [BiomeId.LAKE]: [
    single("lake_bg"),
    timed("lake_bg_forest_day", "lake_bg_forest_night", "lake_bg_forest_night"),
    timed("lake_bg_orion_day", "lake_bg_orion_dusk", "lake_bg_orion_night"),
  ],
  [BiomeId.SEABED]: [
    single("seabed_bg", true),
    single("seabed_bg_dirty", true),
    single("seabed_bg_coral", true),
  ],
  [BiomeId.MOUNTAIN]: [
    single("mountain_bg"),
    timed("mountain_bg_canyon_day", "mountain_bg_canyon_dusk", "mountain_bg_canyon_night"),
  ],
  [BiomeId.BADLANDS]: [single("badlands_bg"), single("badlands_bg_scrub_path")],
  [BiomeId.CAVE]: [
    single("cave_bg", true),
    timed("cave_bg_crystal_day", "cave_bg_crystal_night", "cave_bg_crystal_night"),
    timed("cave_bg_rock_day", "cave_bg_rock_night", "cave_bg_rock_night"),
    single("cave_bg_stream", true),
  ],
  [BiomeId.DESERT]: [single("desert_bg"), single("desert_bg_dunes")],
  [BiomeId.ICE_CAVE]: [single("ice_cave_bg", true), single("ice_cave_bg_glacier", true)],
  [BiomeId.POWER_PLANT]: [timed("power_plant_bg_day", "power_plant_bg_dusk", "power_plant_bg_night")],
  [BiomeId.VOLCANO]: [timed("volcano_bg_day", "volcano_bg_dusk", "volcano_bg_night")],
  [BiomeId.GRAVEYARD]: [timed("graveyard_bg_day", "graveyard_bg_dusk", "graveyard_bg_night")],
  [BiomeId.DOJO]: [
    single("dojo_bg"),
    single("dojo_bg_interior", true),
    timed("dojo_bg_stadium_day", "dojo_bg_stadium_dusk", "dojo_bg_stadium_night"),
  ],
  [BiomeId.FACTORY]: [single("factory_bg", true)],
  [BiomeId.WASTELAND]: [timed("wasteland_bg_day", "wasteland_bg_dusk", "wasteland_bg_night")],
  [BiomeId.ABYSS]: [timed("abyss_bg_day", "abyss_bg_dusk", "abyss_bg_night")],
  [BiomeId.CONSTRUCTION_SITE]: [
    timed("construction_site_bg", "construction_site_bg_dusk", "construction_site_bg_night"),
  ],
  [BiomeId.FAIRY_CAVE]: [
    single("fairy_cave_bg", true),
    timed(
      "fairy_cave_bg_crystal_water_day",
      "fairy_cave_bg_crystal_water_night",
      "fairy_cave_bg_crystal_water_night",
    ),
  ],
  [BiomeId.SLUM]: [single("slum_bg", true)],
  [BiomeId.SNOWY_FOREST]: [
    single("snowy_forest_bg"),
    timed("snowy_forest_bg_plain_day", "snowy_forest_bg_plain_night", "snowy_forest_bg_plain_night"),
  ],
  [BiomeId.LABORATORY]: [
    single("laboratory_bg", true),
    single("laboratory_bg_destroyed", true),
    single("laboratory_bg_science_night", true),
  ],
} satisfies Partial<Record<BiomeId, readonly ErBiomeBackgroundSet[]>>;

export function getErBiomeBackgroundSets(biomeId: BiomeId): readonly ErBiomeBackgroundSet[] {
  return ER_BIOME_BACKGROUND_SETS[biomeId as keyof typeof ER_BIOME_BACKGROUND_SETS] ?? [];
}

export function getErBiomeBackgroundTextureKeys(biomeId: BiomeId): readonly string[] {
  const keys = new Set<string>();
  for (const set of getErBiomeBackgroundSets(biomeId)) {
    keys.add(set.day);
    if (set.dusk) {
      keys.add(set.dusk);
    }
    if (set.night) {
      keys.add(set.night);
    }
  }
  return [...keys];
}

export function selectErBiomeBackgroundSetIndex(
  biomeId: BiomeId,
  runSeed: string,
  biomeStartWave: number,
): number {
  const sets = getErBiomeBackgroundSets(biomeId);
  if (sets.length < 2) {
    return 0;
  }

  let hash = 2166136261;
  const selectionKey = `${runSeed}:${biomeId}:${biomeStartWave}`;
  for (let index = 0; index < selectionKey.length; index++) {
    hash ^= selectionKey.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % sets.length;
}

export function resolveErBiomeBackground(
  biomeId: BiomeId,
  setIndex: number,
  timeOfDay: TimeOfDay,
): ResolvedErBiomeBackground | null {
  const sets = getErBiomeBackgroundSets(biomeId);
  const set = sets[setIndex] ?? sets[0];
  if (!set) {
    return null;
  }

  let textureKey = set.day;
  if (timeOfDay === TimeOfDay.NIGHT) {
    textureKey = set.night ?? set.dusk ?? set.day;
  } else if (timeOfDay === TimeOfDay.DUSK) {
    textureKey = set.dusk ?? set.day;
  }

  return {
    textureKey,
    ignoreTimeTint: set.ignoreTimeTint ?? false,
  };
}
