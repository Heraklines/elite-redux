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
import { ModifierTier } from "#enums/modifier-tier";
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
  | "MINT"
  | "PP" // Ethers, Elixirs, PP Up / PP Max - move sustain, light commodity
  | "VITAMIN" // permanent stat training (BASE_STAT_BOOSTER), light commodity
  | "ARCANE" // build-changers: Ability Randomizer, Move Slot Expander, Omni Gem
  | "KEYSTONE"; // Mega Bracelet - the mega-evolution key item

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
  [BiomeId.TOWN]: { cheap: ["BALLS", "BERRY"], dear: ["TM", "HELD"], signature: ["BERRY", "LURE"], priceMod: 1 },
  [BiomeId.PLAINS]: { cheap: ["BALLS", "BERRY"], dear: ["HELD"], signature: ["BERRY", "LURE"], priceMod: 1 },
  [BiomeId.GRASS]: { cheap: ["BERRY"], dear: ["EVO"], signature: ["BERRY", "LEEK", "ER_GRASS_GEM", "ER_GRASSY_SEED"], priceMod: 1 },
  [BiomeId.TALL_GRASS]: { cheap: ["BERRY", "BALLS"], dear: ["TM"], signature: ["MAX_LURE", "BERRY", "ER_GRASSY_SEED"], priceMod: 1 },
  [BiomeId.METROPOLIS]: {
    // The department store: money items + the Mega Bracelet on the shelf.
    cheap: ["TM", "EVO", "VITAMIN"],
    dear: ["BERRY"],
    signature: ["AMULET_COIN", "RELIC_GOLD", "MEGA_BRACELET"],
    priceMod: 1,
    buysDear: "HELD",
  },
  [BiomeId.FOREST]: { cheap: ["BERRY", "EVO"], dear: ["BATTLE"], signature: ["LEEK", "SOOTHE_BELL", "ER_GRASSY_SEED", "ER_BUG_GEM"], priceMod: 1 },
  [BiomeId.SEA]: { cheap: ["BALLS"], dear: ["EVO"], signature: ["SHELL_BELL", "SOUL_DEW", "ER_WATER_GEM", "ER_ABSORB_BULB"], priceMod: 1 },
  [BiomeId.SWAMP]: { cheap: ["BERRY"], dear: ["TM"], signature: ["TOXIC_ORB", "QUICK_CLAW", "ER_POISON_GEM"], priceMod: 1.1 },
  [BiomeId.BEACH]: { cheap: ["BERRY", "BALLS"], dear: ["TM"], signature: ["SOOTHE_BELL", "SHELL_BELL"], priceMod: 0.9 },
  [BiomeId.LAKE]: { cheap: ["BALLS", "BERRY"], dear: ["HELD"], signature: ["SHELL_BELL", "SOUL_DEW"], priceMod: 0.9 },
  [BiomeId.SEABED]: { cheap: [], dear: ["EVO"], signature: ["SOUL_DEW", "EVIOLITE", "ER_WATER_GEM"], priceMod: 1.2 },
  [BiomeId.MOUNTAIN]: { cheap: ["BATTLE"], dear: ["BERRY"], signature: ["KINGS_ROCK", "QUICK_CLAW", "ER_ROCK_GEM"], priceMod: 1.1 },
  [BiomeId.BADLANDS]: { cheap: ["BATTLE"], dear: ["BERRY"], signature: ["QUICK_CLAW", "KINGS_ROCK", "ER_GROUND_GEM"], priceMod: 1.1 },
  [BiomeId.CAVE]: { cheap: ["BALLS"], dear: ["BALLS"], signature: ["EVOLUTION_ITEM", "EVIOLITE", "ER_ROCK_GEM", "ER_GROUND_GEM"], priceMod: 1 },
  [BiomeId.DESERT]: {
    // The caravan: everything pricey, but it stocks exotics (extra ULTRA
    // wildcard rolls; see stock builder).
    cheap: [],
    dear: [],
    signature: ["GRIP_CLAW", "BATON", "ER_SAFETY_GOGGLES"],
    priceMod: 1.3,
  },
  [BiomeId.ICE_CAVE]: { cheap: ["EVO"], dear: ["BERRY"], signature: ["FROSTBITE_ORB", "EVIOLITE", "ER_ICE_GEM", "ER_SNOWBALL"], priceMod: 1.2 },
  [BiomeId.MEADOW]: { cheap: ["MINT", "BERRY", "VITAMIN"], dear: ["BATTLE"], signature: ["SOOTHE_BELL", "BERRY", "ER_GRASSY_SEED", "ER_MENTAL_HERB"], priceMod: 0.9 },
  [BiomeId.POWER_PLANT]: { cheap: ["TM", "BATTLE"], dear: ["BERRY"], signature: ["MULTI_LENS", "WIDE_LENS", "ER_ELECTRIC_GEM", "ER_CELL_BATTERY", "ER_ELECTRIC_SEED"], priceMod: 1 },
  [BiomeId.VOLCANO]: { cheap: ["EVO"], dear: ["BALLS"], signature: ["FLAME_ORB", "ER_CHILI_SAMPLE", "ER_FIRE_GEM"], priceMod: 1.1 },
  // Covert Cloak is SHOP-ONLY for players (maintainer 2026-07-16): it never
  // enters the random reward pools, only these signature slots.
  [BiomeId.GRAVEYARD]: { cheap: ["EVO"], dear: ["BALLS"], signature: ["REVIVER_SEED", "ER_RUSTY_CLAW", "ER_GHOST_GEM", "ER_COVERT_CLOAK"], priceMod: 1 },
  // The training hall: vitamins are the headline, and martial mastery puts the
  // Mega Bracelet (KEYSTONE) on offer here too.
  [BiomeId.DOJO]: { cheap: ["BATTLE", "VITAMIN", "KEYSTONE"], dear: ["TM"], signature: ["FOCUS_BAND", "KINGS_ROCK", "ER_FIGHTING_GEM", "ER_WEAKNESS_POLICY", "ER_EXPERT_BELT", "ER_MUSCLE_BAND"], priceMod: 1 },
  [BiomeId.FACTORY]: { cheap: ["HELD"], dear: ["BERRY"], signature: ["WHITE_HERB", "ER_LOADED_DICE", "ER_STEEL_GEM", "ER_CELL_BATTERY"], priceMod: 1 },
  // Ancient arcane power: Omni Gem / Move Slot Expander / Ability Randomizer.
  [BiomeId.RUINS]: { cheap: ["ARCANE"], dear: ["BALLS"], signature: ["RELIC_GOLD", "REVIVER_SEED", "ER_PSYCHIC_GEM", "ER_PSYCHIC_SEED", "ER_WISE_GLASSES"], priceMod: 1.1 },
  [BiomeId.WASTELAND]: { cheap: ["BATTLE"], dear: ["BALLS"], signature: ["DNA_SPLICERS", "REVIVER_SEED"], priceMod: 1.2 },
  [BiomeId.ABYSS]: { cheap: [], dear: [], signature: [], priceMod: 1, noShop: true },
  // Cosmic mutation: the observatory tinkers with abilities/moves (ARCANE).
  [BiomeId.SPACE]: { cheap: ["HELD", "ARCANE"], dear: ["BERRY", "TM"], signature: ["MINI_BLACK_HOLE", "MULTI_LENS", "ER_PSYCHIC_SEED"], priceMod: 1.2 },
  [BiomeId.CONSTRUCTION_SITE]: {
    // The work site: heavy discount (everything 50% off) + one extra reward slot
    // (see ErBiomeRule.extraRewardSlots) - a place to stock up cheaply.
    cheap: ["BATTLE", "VITAMIN"],
    dear: ["MINT"],
    signature: ["GOLDEN_PUNCH", "FOCUS_BAND", "ER_STEEL_GEM", "ER_HEAVY_DUTY_BOOTS"],
    priceMod: 0.5,
  },
  [BiomeId.JUNGLE]: { cheap: ["BERRY", "CANDY"], dear: ["BALLS"], signature: ["LUCKY_EGG", "BERRY", "ER_GRASS_GEM", "ER_GRASSY_SEED"], priceMod: 1.1 },
  [BiomeId.FAIRY_CAVE]: { cheap: ["MINT"], dear: ["BATTLE"], signature: ["ER_LUCKY_HEART", "SOOTHE_BELL", "ER_FAIRY_GEM", "ER_MISTY_SEED"], priceMod: 1 },
  [BiomeId.TEMPLE]: { cheap: [], dear: [], signature: ["LEFTOVERS", "RELIC_GOLD"], priceMod: 1 },
  [BiomeId.SLUM]: {
    // The den: everything is 25% off, no markups. (The "used goods" twist
    // ships with the curse system, not in P1.)
    cheap: [],
    dear: [],
    signature: ["WIDE_LENS", "ER_LOADED_DICE", "ER_COVERT_CLOAK", "ER_SMOKE_BALL"],
    priceMod: 0.75,
    buysDear: "EVO",
  },
  [BiomeId.SNOWY_FOREST]: { cheap: ["BERRY", "EVO"], dear: ["BALLS"], signature: ["REVIVER_SEED", "FROSTBITE_ORB", "ER_ICE_GEM", "ER_GRASSY_SEED"], priceMod: 1.1 },
  [BiomeId.ISLAND]: { cheap: [], dear: [], signature: ["ER_DEX_NAV", "SHELL_BELL", "ER_WATER_GEM"], priceMod: 1.15 },
  // The experiment lab: candies + the build-changers (Ability Randomizer,
  // Move Slot Expander, Omni Gem) alongside its Capsule/Shroom signatures.
  [BiomeId.LABORATORY]: {
    cheap: ["CANDY", "ARCANE"],
    dear: ["BALLS"],
    signature: ["ER_ABILITY_CAPSULE", "ER_LEARNERS_SHROOM"],
    priceMod: 1,
  },
};

/** Category -> the modifierTypes generators that can fill its slots. */
export const ER_SHOP_CATEGORY_POOL: Record<ErShopCategory, (keyof typeof modifierTypes)[]> = {
  // ER: Full Heal / Full Restore dropped from biome shops - they land at the end
  // of a biome where full healing is redundant. Potions + revives stay.
  HEAL: ["POTION", "SUPER_POTION", "HYPER_POTION", "MAX_POTION", "REVIVE", "MAX_REVIVE"],
  BALLS: ["POKEBALL", "GREAT_BALL", "ULTRA_BALL", "ROGUE_BALL"],
  BATTLE: ["TEMP_STAT_STAGE_BOOSTER", "DIRE_HIT"],
  BERRY: ["BERRY"],
  // ER TM Case: the universal single-use TM replaces the per-move
  // TM_COMMON/GREAT/ULTRA in the biome market too (it carries TMs).
  TM: ["TM_CASE"],
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
  // ER: PP-restore items (Ether/Elixir family) dropped from biome shops as
  // redundant end-of-biome filler. Only the permanent PP upgrades remain.
  PP: ["PP_UP", "PP_MAX"],
  VITAMIN: ["BASE_STAT_BOOSTER"],
  ARCANE: ["ABILITY_RANDOMIZER", "MOVE_SLOT_EXPANDER", "ER_OMNI_GEM"],
  KEYSTONE: ["MEGA_BRACELET"],
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
  PP: "great",
  VITAMIN: "ultra",
  ARCANE: "rogue",
  KEYSTONE: "rogue",
};

export interface ErBiomeShopStockEntry {
  key: keyof typeof modifierTypes;
  /** Category-based fallback price (the real price is recomputed by item tier
   * in getPlayerShopModifierTypeOptionsForWave once the type is resolved). */
  cost: number;
  /** The shop category this slot was drawn from (drives the biome discount). */
  category: ErShopCategory;
}

/**
 * Price multiplier per item RARITY tier, in wave-income units. Pricing is by
 * the item's actual tier (a Rogue-tier Focus Band costs far more than a
 * Great-tier Quick Claw) rather than a flat per-category rate. The biome
 * discount/markup (erBiomeCategoryPriceMod) multiplies on top.
 */
export const ER_SHOP_ITEM_TIER_FACTOR: Record<ModifierTier, number> = {
  [ModifierTier.COMMON]: 0.35,
  [ModifierTier.GREAT]: 1.0,
  [ModifierTier.ULTRA]: 2.6,
  [ModifierTier.ROGUE]: 6,
  [ModifierTier.MASTER]: 12,
  [ModifierTier.LUXURY]: 9,
};

/** How many of an item the market stocks, by rarity (rarer = scarcer). */
export const ER_SHOP_STOCK_BY_TIER: Record<ModifierTier, number> = {
  [ModifierTier.COMMON]: 5,
  [ModifierTier.GREAT]: 3,
  [ModifierTier.ULTRA]: 2,
  [ModifierTier.ROGUE]: 1,
  [ModifierTier.MASTER]: 1,
  [ModifierTier.LUXURY]: 1,
};

/** Final price for a resolved item, by its rarity tier x the biome discount. */
export function erBiomeTierPrice(tier: ModifierTier, biome: BiomeId, category: ErShopCategory): number {
  const waveUnit = globalScene.getWaveMoneyAmount(1);
  const tierFactor = ER_SHOP_ITEM_TIER_FACTOR[tier] ?? ER_SHOP_ITEM_TIER_FACTOR[ModifierTier.GREAT];
  return Math.max(10, Math.floor((waveUnit * tierFactor * erBiomeCategoryPriceMod(biome, category)) / 10) * 10);
}

/** Stock count for a resolved item, by its rarity tier. */
export function erBiomeStockCount(tier: ModifierTier): number {
  return ER_SHOP_STOCK_BY_TIER[tier] ?? ER_SHOP_STOCK_BY_TIER[ModifierTier.GREAT];
}

/**
 * Explicit rarity tier for staples that are NOT in the random reward pool (the
 * balls and the X-item staples), so getOrInferTier's reverse pool lookup can't
 * find them and would otherwise collapse them all to one tier/price. Keyed by
 * the modifierTypes key. Pooled items (held items, TMs, candies) infer their
 * tier from the pool and don't need an entry here.
 */
export const ER_SHOP_EXPLICIT_ITEM_TIER: Partial<Record<keyof typeof modifierTypes, ModifierTier>> = {
  POKEBALL: ModifierTier.COMMON,
  GREAT_BALL: ModifierTier.GREAT,
  ULTRA_BALL: ModifierTier.ULTRA,
  ROGUE_BALL: ModifierTier.ROGUE,
  MASTER_BALL: ModifierTier.MASTER,
  DIRE_HIT: ModifierTier.COMMON,
  TEMP_STAT_STAGE_BOOSTER: ModifierTier.COMMON,
  // New high-value pools (#440 follow-up): pin price + stock so they read as
  // the premium/rare items they are, instead of inheriting a noisy pool tier.
  MEGA_BRACELET: ModifierTier.ROGUE, // the mega key item: 1 in stock, big spend
  ABILITY_RANDOMIZER: ModifierTier.ROGUE,
  MOVE_SLOT_EXPANDER: ModifierTier.ROGUE,
  ER_OMNI_GEM: ModifierTier.ULTRA,
  BASE_STAT_BOOSTER: ModifierTier.ULTRA, // vitamins: permanent, 2 in stock
  PP_MAX: ModifierTier.ROGUE,
  PP_UP: ModifierTier.ULTRA,
  MAX_ELIXIR: ModifierTier.ULTRA,
  ELIXIR: ModifierTier.GREAT,
  MAX_ETHER: ModifierTier.GREAT,
  ETHER: ModifierTier.GREAT,
};

/** Last-resort tier per category when an item is neither explicitly mapped nor
 * resolvable from a reward pool. */
export const ER_SHOP_CATEGORY_DEFAULT_TIER: Record<ErShopCategory, ModifierTier> = {
  HEAL: ModifierTier.COMMON,
  BALLS: ModifierTier.COMMON,
  BATTLE: ModifierTier.COMMON,
  BERRY: ModifierTier.COMMON,
  TM: ModifierTier.GREAT,
  HELD: ModifierTier.ULTRA,
  EVO: ModifierTier.GREAT,
  CANDY: ModifierTier.GREAT,
  MINT: ModifierTier.GREAT,
  PP: ModifierTier.GREAT,
  VITAMIN: ModifierTier.ULTRA,
  ARCANE: ModifierTier.ROGUE,
  KEYSTONE: ModifierTier.ROGUE,
};

/**
 * Resolve the rarity tier that drives BOTH price and stock for a shop slot:
 *   explicit staple map  ->  the item's reward-pool tier  ->  category default.
 * `inferred` is the caller's `mt.getOrInferTier()` (passed in to avoid a value
 * import of the modifier table here, which would be a require cycle).
 */
export function erBiomeShopResolveTier(
  key: keyof typeof modifierTypes,
  inferred: ModifierTier | null,
  category: ErShopCategory,
): ModifierTier {
  return ER_SHOP_EXPLICIT_ITEM_TIER[key] ?? inferred ?? ER_SHOP_CATEGORY_DEFAULT_TIER[category];
}

/**
 * Roll the biome market stock for an x0 wave: the biome signatures, the biome's signature items, picks from its discounted
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
  // Biome signatures + biome-skewed (discounted) picks + weighted wildcards
  // (balls/berries are wildcards now, NOT guaranteed staples - they used to
  // appear in every shop), padded to 16. NEVER healing (maintainer rule: the
  // biome market is a distinct shop, healing stays the normal-wave shop's job).
  const TARGET_SLOTS = ER_BIOME_SHOP_SLOTS;
  const add = (key: keyof typeof modifierTypes, category: ErShopCategory) => {
    if (!seen.has(key) && stock.length < TARGET_SLOTS) {
      seen.add(key);
      stock.push({ key, cost: priceOf(key, category), category });
    }
  };

  globalScene.executeWithSeedOffset(
    () => {
      // 1. SIGNATURES: the biome's identity items, always stocked, ultra-priced.
      for (const key of eco.signature) {
        if (!seen.has(key) && stock.length < TARGET_SLOTS) {
          seen.add(key);
          stock.push({
            key,
            cost: erBiomeShopPrice("ultra", erBalanceMap("er.shop.biomePriceMod")[BiomeId[biome]] ?? eco.priceMod),
            // Signatures are flavor items (mostly held) - tag HELD so the biome
            // discount still applies; the real price comes from the item tier.
            category: "HELD",
          });
        }
      }
      // 3. BIOME-SKEWED: up to two distinct picks from each discounted category
      // (the reason this biome's market is worth a look). HEAL is excluded.
      for (const category of eco.cheap) {
        if (category === "HEAL" || category === "PP") {
          continue;
        }
        const pool = ER_SHOP_CATEGORY_POOL[category].filter(k => !seen.has(k));
        for (let i = 0; i < 2 && pool.length > 0 && stock.length < TARGET_SLOTS; i++) {
          const idx = randSeedInt(pool.length);
          add(pool[idx], category);
          pool.splice(idx, 1);
        }
      }
      // 4. WILDCARDS / FILL: top up to 16, BIOME-FLAVORED. The bag is weighted
      // toward THIS biome's discounted categories (its identity), so every
      // market fills differently - a Power Plant tops up with TMs, a Dojo with
      // X-items, a Laboratory with candies, while the Desert / Slum / Ruins (no
      // cheap categories) lean into HELD exotics. HELD is a universal
      // medium-weight wildcard everywhere; HEAL is never included.
      const bag: { key: keyof typeof modifierTypes; cat: ErShopCategory }[] = [];
      const pushCat = (cat: ErShopCategory, weight: number) => {
        if (cat === "HEAL" || cat === "PP") {
          return;
        }
        for (let w = 0; w < weight; w++) {
          for (const key of ER_SHOP_CATEGORY_POOL[cat]) {
            bag.push({ key, cat });
          }
        }
      };
      // Biome's own cheap categories lead the wildcard bag (heavy weight)...
      for (const cat of eco.cheap) {
        pushCat(cat, 3);
      }
      // ...then the universal exotic pool (heavier for the Desert caravan)...
      pushCat("HELD", biome === BiomeId.DESERT ? 4 : 2);
      // Balls are a LIGHT wildcard now (not a guaranteed 4-ball staple), so a
      // shop usually carries a ball or two but not always all four.
      pushCat("BALLS", 2);
      // ...then a light sprinkle of the rest for variety. BERRY is intentionally
      // NOT a universal wildcard (it showed up in every shop / always Sitrus);
      // berries now only appear where a biome features them (cheap/signature).
      // PP + VITAMIN are general commodities, so they sprinkle everywhere; the
      // build-changers (ARCANE) and the Mega Bracelet (KEYSTONE) are NOT here -
      // they only stock in their thematic biomes (Lab/Space/Ruins, Metropolis/
      // Dojo) so they stay rare and meaningful.
      for (const cat of ["EVO", "TM", "BATTLE", "CANDY", "MINT", "VITAMIN"] as ErShopCategory[]) {
        pushCat(cat, 1);
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
