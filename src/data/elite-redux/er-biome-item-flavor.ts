/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - per-biome enemy held-item FLAVOR (the on-mon distribution
// channel for the imported gems / seeds / reactive items).
//
// On TOP of the vanilla held-item roll, an enemy mon (wild OR trainer) in a
// biome has a chance to also carry ONE thematic item from that biome's pool:
// a Fire Gem in the Volcano, a Cell Battery / Electric Seed at the Power Plant,
// a Snowball in the Ice Cave, a Weakness Policy on Abyss/Wasteland threats, etc.
// Stochastic and additive - it never replaces the baseline roll. Applied from
// applyErTrainerHeldItems (the per-mon chokepoint).
//
// Kept in its OWN file (not on ErBiomeRule) so it stays independent of the
// battle-identity rules. Pool entries are modifierTypes registry-key STRINGS
// (resolved lazily at assignment time) so this file stays dependency-free.
// =============================================================================

import { BiomeId } from "#enums/biome-id";

export interface ErBiomeItemFlavor {
  /** modifierTypes registry keys an enemy mon here may also carry. */
  pool: string[];
  /** Per-mon % chance to receive ONE extra item from the pool (on top of the vanilla roll). */
  chance: number;
}

export const ER_BIOME_ITEM_FLAVOR: Partial<Record<BiomeId, ErBiomeItemFlavor>> = {
  // --- Type-themed gem + synergy biomes --------------------------------------
  [BiomeId.VOLCANO]: { pool: ["ER_FIRE_GEM"], chance: 25 },
  [BiomeId.POWER_PLANT]: { pool: ["ER_ELECTRIC_GEM", "ER_CELL_BATTERY", "ER_ELECTRIC_SEED", "ER_AIR_BALLOON"], chance: 25 },
  [BiomeId.SEA]: { pool: ["ER_WATER_GEM", "ER_ABSORB_BULB"], chance: 20 },
  [BiomeId.SEABED]: { pool: ["ER_WATER_GEM", "ER_LUMINOUS_MOSS"], chance: 25 },
  [BiomeId.ICE_CAVE]: { pool: ["ER_ICE_GEM", "ER_SNOWBALL"], chance: 25 },
  [BiomeId.SNOWY_FOREST]: { pool: ["ER_ICE_GEM", "ER_SNOWBALL", "ER_GRASSY_SEED"], chance: 20 },
  [BiomeId.CAVE]: { pool: ["ER_ROCK_GEM", "ER_GROUND_GEM"], chance: 20 },
  [BiomeId.MOUNTAIN]: { pool: ["ER_ROCK_GEM"], chance: 15 },
  [BiomeId.BADLANDS]: { pool: ["ER_GROUND_GEM", "ER_ROCK_GEM"], chance: 20 },
  [BiomeId.DESERT]: { pool: ["ER_GROUND_GEM"], chance: 15 },
  [BiomeId.GRASS]: { pool: ["ER_GRASS_GEM", "ER_GRASSY_SEED"], chance: 20 },
  [BiomeId.TALL_GRASS]: { pool: ["ER_GRASS_GEM", "ER_GRASSY_SEED"], chance: 20 },
  [BiomeId.FOREST]: { pool: ["ER_BUG_GEM", "ER_GRASS_GEM", "ER_GRASSY_SEED"], chance: 20 },
  [BiomeId.JUNGLE]: { pool: ["ER_GRASS_GEM", "ER_GRASSY_SEED", "ER_STICKY_BARB"], chance: 25 },
  [BiomeId.MEADOW]: { pool: ["ER_GRASS_GEM", "ER_GRASSY_SEED"], chance: 15 },
  [BiomeId.SWAMP]: { pool: ["ER_POISON_GEM"], chance: 20 },
  // Covert Cloak / Red Card ride these ENEMY pools (maintainer 2026-07-16:
  // "more useful for enemies") - the player never rolls them as rewards.
  [BiomeId.GRAVEYARD]: { pool: ["ER_GHOST_GEM", "ER_COVERT_CLOAK"], chance: 25 },
  [BiomeId.DOJO]: { pool: ["ER_FIGHTING_GEM", "ER_WEAKNESS_POLICY", "ER_RED_CARD"], chance: 25 },
  [BiomeId.RUINS]: { pool: ["ER_PSYCHIC_GEM", "ER_PSYCHIC_SEED"], chance: 20 },
  [BiomeId.SPACE]: { pool: ["ER_PSYCHIC_GEM", "ER_PSYCHIC_SEED"], chance: 20 },
  [BiomeId.FAIRY_CAVE]: { pool: ["ER_FAIRY_GEM", "ER_MISTY_SEED"], chance: 20 },
  [BiomeId.ISLAND]: { pool: ["ER_WATER_GEM"], chance: 15 },
  // --- Manufactured / hostile biomes (item-rich, higher chance) --------------
  [BiomeId.FACTORY]: { pool: ["ER_STEEL_GEM", "ER_CELL_BATTERY"], chance: 35 },
  [BiomeId.CONSTRUCTION_SITE]: { pool: ["ER_STEEL_GEM", "ER_IRON_BALL"], chance: 20 },
  [BiomeId.ABYSS]: { pool: ["ER_DARK_GEM", "ER_WEAKNESS_POLICY", "ER_COVERT_CLOAK"], chance: 25 },
  [BiomeId.WASTELAND]: { pool: ["ER_DRAGON_GEM", "ER_WEAKNESS_POLICY", "ER_RED_CARD"], chance: 30 },
};

/** The biome's enemy item-flavor pool, or undefined if the biome has none. */
export function getErBiomeItemFlavor(biomeId: BiomeId): ErBiomeItemFlavor | undefined {
  return ER_BIOME_ITEM_FLAVOR[biomeId];
}
