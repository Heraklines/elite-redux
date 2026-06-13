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
import { erBalanceMap, erBalanceNum } from "#data/elite-redux/er-balance-tuning";
// Type-only: this module feeds modifier-type.ts (the shop hook), so a value
// import of the built modifierTypes table here would be a require cycle.
import type { modifierTypes } from "#data/data-lists";
import { BiomeId } from "#enums/biome-id";
import type { ModifierTypeFunc } from "#types/modifier-types";
import { randSeedInt } from "#utils/common";

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

/** The biome market is a 4x4 grid: 16 stock slots (spec #440 §1). */
export const ER_BIOME_SHOP_SLOTS = 16;

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

/** Slot tier for pricing, per category (staples cheap, held items dear). */
const CATEGORY_TIER: Record<ErShopCategory, keyof typeof ER_SHOP_TIER_FACTOR> = {
  HEAL: "staple",
  BALLS: "staple",
  BATTLE: "staple",
  BERRY: "staple",
  TM: "great",
  HELD: "ultra",
  EVO: "great",
  CANDY: "great",
  MINT: "great",
};

export interface ErBiomeShopStockEntry {
  key: keyof typeof modifierTypes;
  cost: number;
}

/**
 * Roll the biome market stock for an x0 wave: 3 staples (wave-bracketed heal,
 * status heal, ball), the biome's signature items, picks from its discounted
 * categories, and wildcards (the Desert caravan rolls extra HELD exotics).
 * Deterministic per wave: runs under the wave seed so the reward phase and the
 * UI handler see the SAME stock.
 */
export function rollErBiomeShopStock(biome: BiomeId, waveIndex: number): ErBiomeShopStockEntry[] {
  const eco = ER_BIOME_ECONOMY[biome];
  if (!eco || eco.noShop) {
    return [];
  }
  const stock: ErBiomeShopStockEntry[] = [];
  const seen = new Set<string>();
  const priceOf = (key: keyof typeof modifierTypes, category: ErShopCategory): number =>
    erBiomeShopPrice(CATEGORY_TIER[category], erBiomeCategoryPriceMod(biome, category));
  // Spec (#440 §1): the market is a 4x4 GRID of 16 slots, not a single row.
  // 4 ball staples + biome signatures + biome-skewed (discounted) picks +
  // rarity wildcards, padded to 16. NEVER healing (maintainer rule: the biome
  // market is a distinct shop, healing stays the normal-wave shop's job).
  const TARGET_SLOTS = ER_BIOME_SHOP_SLOTS;
  const add = (key: keyof typeof modifierTypes, category: ErShopCategory) => {
    if (!seen.has(key) && stock.length < TARGET_SLOTS) {
      seen.add(key);
      stock.push({ key, cost: priceOf(key, category) });
    }
  };

  globalScene.executeWithSeedOffset(
    () => {
      // 1. STAPLES: the four ball tiers, always in stock, always affordable.
      // (The spec's "heals/balls" staples drop the heals per maintainer rule.)
      for (const key of ER_SHOP_CATEGORY_POOL.BALLS) {
        add(key, "BALLS");
      }
      // 2. SIGNATURES: the biome's identity items, always stocked, ultra-priced.
      for (const key of eco.signature) {
        if (!seen.has(key) && stock.length < TARGET_SLOTS) {
          seen.add(key);
          stock.push({
            key,
            cost: erBiomeShopPrice("ultra", erBalanceMap("er.shop.biomePriceMod")[BiomeId[biome]] ?? eco.priceMod),
          });
        }
      }
      // 3. BIOME-SKEWED: up to two distinct picks from each discounted category
      // (the reason this biome's market is worth a look). HEAL is excluded.
      for (const category of eco.cheap) {
        if (category === "HEAL") {
          continue;
        }
        const pool = ER_SHOP_CATEGORY_POOL[category].filter(k => !seen.has(k));
        for (let i = 0; i < 2 && pool.length > 0 && stock.length < TARGET_SLOTS; i++) {
          const idx = randSeedInt(pool.length);
          add(pool[idx], category);
          pool.splice(idx, 1);
        }
      }
      // 4. WILDCARDS / FILL: top up to 16 from the broad non-heal pool, drawn
      // randomly so each shop varies. HELD (community exotics) is weighted
      // heaviest; the Desert caravan leans even harder into HELD exotics.
      const wildcardCats: ErShopCategory[] = ["HELD", "EVO", "TM", "BATTLE", "BERRY", "CANDY", "MINT"];
      const bag: { key: keyof typeof modifierTypes; cat: ErShopCategory }[] = [];
      for (const cat of wildcardCats) {
        const weight = cat === "HELD" && biome === BiomeId.DESERT ? 2 : 1;
        for (let w = 0; w < weight; w++) {
          for (const key of ER_SHOP_CATEGORY_POOL[cat]) {
            bag.push({ key, cat });
          }
        }
      }
      let guard = 0;
      while (stock.length < TARGET_SLOTS && bag.length > 0 && guard++ < 500) {
        const idx = randSeedInt(bag.length);
        const { key, cat } = bag[idx];
        bag.splice(idx, 1);
        add(key, cat);
      }
    },
    waveIndex,
    "er-biome-shop",
  );
  return stock;
}

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
  // Editor-managed per-biome modifier (keyed by the BiomeId NAME) first, then
  // the shipped table; discount/markup multipliers are editor-tunable too.
  let mod = erBalanceMap("er.shop.biomePriceMod")[BiomeId[biome]] ?? eco.priceMod;
  if (eco.cheap.includes(category)) {
    mod *= erBalanceNum("er.shop.cheapMult");
  } else if (eco.dear.includes(category)) {
    mod *= erBalanceNum("er.shop.dearMult");
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
  const tierFactor = erBalanceMap("er.shop.tierFactor")[tier] ?? ER_SHOP_TIER_FACTOR[tier];
  // Round to a clean 10 like all money values.
  return Math.max(10, Math.floor((waveUnit * tierFactor * categoryMod) / 10) * 10);
}
