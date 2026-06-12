/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Biome Shop economy (#440) - per-biome stock + pricing for the every-10-
// waves biome shop.
//
// BALANCE MODEL (grounded in the real curves, do not eyeball-edit):
//   - Income: getWaveMoneyAmount(1) per wave (~275 @ w10, ~770 @ w50,
//     ~1570 @ w100, ~4570 @ w200; +<=60% money streak). Trainer-dense waves
//     pay above 1x, so a 10-wave biome banks ~11-13 "wave units".
//   - The VANILLA shop already prices in wave units (Potion = 0.2x one wave's
//     income, Sacred Ash = 10x), so the biome shop uses the same currency:
//       price = getWaveMoneyAmount(1) * TIER_FACTOR * biome price modifier
//   - TIER_FACTOR targets: staple ~0.2-0.5 (always affordable), GREAT ~1.2
//     (one wave), ULTRA ~3.2 (a third of the biome's income - pick ONE),
//     ROGUE ~8 (save across 2-3 shops - a run-defining purchase).
//   - Biome modifiers stay inside 0.6x-1.6x so a discount is a real reason
//     to spend NOW and a markup never makes staples unaffordable.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { BiomeId } from "#enums/biome-id";
import type { ModifierTypeFunc } from "#types/modifier-types";

/** Stock categories - each biome discounts some and marks up others. */
export type ErShopCategory =
  | "HEAL" // potions, status heals, revives
  | "BALLS"
  | "BATTLE" // X items, Dire Hit
  | "BERRY"
  | "TM"
  | "HELD" // held items incl. the community batch
  | "EVO" // evolution items / stones
  | "CANDY"
  | "MINT";

/** Price factor per shop slot tier, in "waves of income" units. */
export const ER_SHOP_TIER_FACTOR = {
  staple: 0.35,
  great: 1.2,
  ultra: 3.2,
  rogue: 8,
} as const;

export interface ErBiomeEconomy {
  /** Categories sold at a discount (0.7x) and stocked heavier. */
  cheap: ErShopCategory[];
  /** Categories marked up (1.4x). */
  dear: ErShopCategory[];
  /** Always-stocked signature items (resolved via modifierTypes). */
  signature: (keyof typeof modifierTypes)[];
  /** Global price modifier on top of category mods (caravan = pricey). */
  priceMod: number;
  /** The biome OVERPAYS (1.5x) when the player sells this category here. */
  buysDear?: ErShopCategory;
  /** No shop at all (the Abyss - the Deal lives there instead). */
  noShop?: boolean;
}

/**
 * Per-biome economy table. Signature picks favor items that READ as the
 * biome (the shop is flavor first); category skews do the balance work.
 * Editor-friendly: plain data, no logic.
 */
export const ER_BIOME_ECONOMY: Partial<Record<BiomeId, ErBiomeEconomy>> = {
  [BiomeId.TOWN]: { cheap: ["HEAL", "BALLS"], dear: ["TM", "HELD"], signature: ["BERRY"], priceMod: 1 },
  [BiomeId.PLAINS]: { cheap: ["HEAL", "BALLS"], dear: ["HELD"], signature: ["BERRY", "LURE"], priceMod: 1 },
  [BiomeId.GRASS]: { cheap: ["BERRY"], dear: ["EVO"], signature: ["BERRY"], priceMod: 1 },
  [BiomeId.TALL_GRASS]: { cheap: ["BERRY", "BALLS"], dear: ["TM"], signature: ["MAX_LURE"], priceMod: 1 },
  [BiomeId.METROPOLIS]: {
    cheap: ["TM", "EVO"],
    dear: ["BERRY"],
    signature: ["AMULET_COIN"],
    priceMod: 1,
    buysDear: "HELD",
  },
  [BiomeId.FOREST]: { cheap: ["BERRY"], dear: ["BATTLE"], signature: ["LEEK"], priceMod: 1 },
  [BiomeId.SEA]: { cheap: ["BALLS"], dear: ["EVO"], signature: ["SHELL_BELL"], priceMod: 1 },
  [BiomeId.SWAMP]: { cheap: ["HEAL"], dear: ["TM"], signature: ["TOXIC_ORB"], priceMod: 1.1 },
  [BiomeId.BEACH]: { cheap: ["BERRY", "HEAL"], dear: ["TM"], signature: ["SOOTHE_BELL"], priceMod: 0.9 },
  [BiomeId.LAKE]: { cheap: ["HEAL"], dear: ["HELD"], signature: ["SHELL_BELL"], priceMod: 0.9 },
  [BiomeId.SEABED]: { cheap: [], dear: ["HEAL"], signature: ["SOUL_DEW", "EVIOLITE"], priceMod: 1.2 },
  [BiomeId.MOUNTAIN]: { cheap: ["BATTLE"], dear: ["HEAL"], signature: ["KINGS_ROCK"], priceMod: 1.1 },
  [BiomeId.BADLANDS]: { cheap: ["BATTLE"], dear: ["BERRY"], signature: ["QUICK_CLAW"], priceMod: 1.1 },
  [BiomeId.CAVE]: { cheap: ["BALLS"], dear: ["HEAL"], signature: ["EVOLUTION_ITEM"], priceMod: 1 },
  [BiomeId.DESERT]: {
    // The caravan: everything pricey, but it stocks exotics (extra ULTRA
    // wildcard rolls; see stock builder).
    cheap: [],
    dear: [],
    signature: ["GRIP_CLAW", "BATON"],
    priceMod: 1.3,
  },
  [BiomeId.ICE_CAVE]: { cheap: ["EVO"], dear: ["HEAL"], signature: ["FROSTBITE_ORB"], priceMod: 1.2 },
  [BiomeId.MEADOW]: { cheap: ["MINT", "BERRY"], dear: ["BATTLE"], signature: ["SOOTHE_BELL"], priceMod: 0.9 },
  [BiomeId.POWER_PLANT]: { cheap: ["TM"], dear: ["BERRY"], signature: ["MULTI_LENS"], priceMod: 1 },
  [BiomeId.VOLCANO]: { cheap: ["EVO"], dear: ["HEAL"], signature: ["FLAME_ORB"], priceMod: 1.1 },
  [BiomeId.GRAVEYARD]: { cheap: ["EVO"], dear: ["BALLS"], signature: ["REVIVER_SEED"], priceMod: 1 },
  [BiomeId.DOJO]: { cheap: ["BATTLE"], dear: ["TM"], signature: ["FOCUS_BAND", "KINGS_ROCK"], priceMod: 1 },
  [BiomeId.FACTORY]: { cheap: ["HELD"], dear: ["BERRY"], signature: ["WHITE_HERB"], priceMod: 1 },
  [BiomeId.RUINS]: { cheap: [], dear: ["HEAL"], signature: ["RELIC_GOLD"], priceMod: 1.1 },
  [BiomeId.WASTELAND]: { cheap: ["HEAL"], dear: ["BALLS"], signature: ["DNA_SPLICERS"], priceMod: 1.2 },
  [BiomeId.ABYSS]: { cheap: [], dear: [], signature: [], priceMod: 1, noShop: true },
  [BiomeId.SPACE]: { cheap: ["HELD"], dear: ["HEAL", "BERRY"], signature: ["MINI_BLACK_HOLE"], priceMod: 1.2 },
  [BiomeId.CONSTRUCTION_SITE]: { cheap: ["BATTLE"], dear: ["MINT"], signature: ["GOLDEN_PUNCH"], priceMod: 1 },
  [BiomeId.JUNGLE]: { cheap: ["BERRY", "CANDY"], dear: ["HEAL"], signature: ["LUCKY_EGG"], priceMod: 1.1 },
  [BiomeId.FAIRY_CAVE]: { cheap: ["MINT"], dear: ["BATTLE"], signature: ["ER_LUCKY_HEART"], priceMod: 1 },
  [BiomeId.TEMPLE]: { cheap: [], dear: [], signature: ["LEFTOVERS"], priceMod: 1 },
  [BiomeId.SLUM]: {
    // The den: everything is 25% off, no markups. (The "used goods" twist
    // ships with the curse system, not in P1.)
    cheap: [],
    dear: [],
    signature: ["WIDE_LENS"],
    priceMod: 0.75,
    buysDear: "EVO",
  },
  [BiomeId.SNOWY_FOREST]: { cheap: ["BERRY"], dear: ["HEAL"], signature: ["REVIVER_SEED"], priceMod: 1.1 },
  [BiomeId.ISLAND]: { cheap: [], dear: [], signature: ["ER_DEX_NAV"], priceMod: 1.15 },
  [BiomeId.LABORATORY]: {
    cheap: ["CANDY"],
    dear: ["BALLS"],
    signature: ["ER_ABILITY_CAPSULE", "ER_LEARNERS_SHROOM"],
    priceMod: 1,
  },
};

/** Category -> the modifierTypes generators that can fill its slots. */
export const ER_SHOP_CATEGORY_POOL: Record<ErShopCategory, (keyof typeof modifierTypes)[]> = {
  HEAL: ["POTION", "SUPER_POTION", "HYPER_POTION", "MAX_POTION", "FULL_HEAL", "FULL_RESTORE", "REVIVE", "MAX_REVIVE"],
  BALLS: ["POKEBALL", "GREAT_BALL", "ULTRA_BALL", "ROGUE_BALL"],
  BATTLE: ["TEMP_STAT_STAGE_BOOSTER", "DIRE_HIT"],
  BERRY: ["BERRY"],
  TM: ["TM_COMMON", "TM_GREAT", "TM_ULTRA"],
  HELD: [
    "ER_CHILI_SAMPLE",
    "ER_COPPER_ROD",
    "ER_RUSTY_CLAW",
    "ER_SPIKED_KNUCKLES",
    "ER_LOADED_DICE",
    "ER_LUCKY_HEART",
    "ER_POWER_HERB",
    "FROSTBITE_ORB",
    "WIDE_LENS",
    "FOCUS_BAND",
  ],
  EVO: ["EVOLUTION_ITEM", "RARE_EVOLUTION_ITEM", "FORM_CHANGE_ITEM"],
  CANDY: ["RARE_CANDY", "RARER_CANDY"],
  MINT: ["MINT"],
};

export interface ErBiomeShopSlot {
  typeFunc: ModifierTypeFunc;
  /** Final price after wave scaling + biome modifiers. */
  cost: number;
  category: ErShopCategory | "SIGNATURE" | "WILDCARD";
}

/** Category price multiplier for a biome. */
export function erBiomeCategoryPriceMod(biome: BiomeId, category: ErShopCategory): number {
  const eco = ER_BIOME_ECONOMY[biome];
  if (!eco) {
    return 1;
  }
  let mod = eco.priceMod;
  if (eco.cheap.includes(category)) {
    mod *= 0.7;
  } else if (eco.dear.includes(category)) {
    mod *= 1.4;
  }
  return mod;
}

/** True when this biome runs a shop at all (the Abyss does not). */
export function erBiomeHasShop(biome: BiomeId): boolean {
  return !(ER_BIOME_ECONOMY[biome]?.noShop ?? false);
}

/**
 * Wave-scaled price for one slot. `tier` keys ER_SHOP_TIER_FACTOR; the wave
 * unit comes from the SAME getWaveMoneyAmount(1) the vanilla shop uses, so
 * affordability tracks income at every depth automatically.
 */
export function erBiomeShopPrice(tier: keyof typeof ER_SHOP_TIER_FACTOR, categoryMod: number): number {
  const waveUnit = globalScene.getWaveMoneyAmount(1);
  // Round to a clean 10 like all money values.
  return Math.max(10, Math.floor((waveUnit * ER_SHOP_TIER_FACTOR[tier] * categoryMod) / 10) * 10);
}
