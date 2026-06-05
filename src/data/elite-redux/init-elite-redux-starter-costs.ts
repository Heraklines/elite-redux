/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — starter-cost re-tiering for ER CUSTOM species (id >= 10000).
//
// Two jobs, both touching ONLY ER customs (never vanilla PokeRogue mons):
//   1. Re-cost the grid customs by a BST band + a hand-tuned override table
//      (legendaries / AG mons), per the project owner's triage.
//   2. Pull ability/item-emergent battle FORMS out of both the starter grid
//      (`speciesStarterCosts`) and the egg pool (`speciesEggTiers`) — these
//      should only appear mid-battle via their ability/item, not be hatchable
//      or directly selectable (Palafin Hero, Wishiwashi School, Minior cores,
//      Vivillon patterns, …).
//
// Runs AFTER initEliteReduxEggTiers() so its `speciesEggTiers` entries exist to
// delete. Idempotent.
// =============================================================================

import { speciesEggTiers } from "#balance/species-egg-tiers";
import { speciesStarterCosts } from "#balance/starters";
import { allSpecies } from "#data/data-lists";
import { EggTier } from "#enums/egg-type";

/** First ER-custom species id. Vanilla mons (< this) are never touched. */
const ER_CUSTOM_ID_FLOOR = 10000;

/**
 * Forms that emerge mid-battle through an ability/item — they must NOT be
 * hatchable or directly starter-selectable. Matched against the species name.
 */
const REMOVE_FROM_GRID_AND_EGGS: readonly RegExp[] = [
  /^Palafin Hero$/, // Zero to Hero
  /^Meloetta Pirouette$/, // Relic Song
  /^Wishiwashi School$/, // Schooling
  /^Morpeko Hangry$/, // Hunger Switch
  /^Hoopa Unbound$/, // Prison Bottle
  /^Wispywaspy Hivemind$/, // custom hive ability
  /^Slate$/, // owner: should only emerge, not be obtainable
  /^Darmanitan Zen/, // Zen Mode (covers "Zen" + "Zen Mode Galarian")
  /^Minior /, // all Minior core/meteor color variants (Shields Down)
  /^Vivillon /, // all cosmetic Vivillon patterns
];

/**
 * Hand-tuned cost overrides by exact species name (legendaries + AG mons).
 * Everything not listed here falls through to {@linkcode bandCostByBst}.
 */
const COST_OVERRIDES: Readonly<Record<string, number>> = {
  Kecleong: 12,
  "Burmy Eterna": 11,
  "Kartana Fallen": 11,
  "Darkrai Nightmare": 10,
  "Zygarde Complete": 9,
  "Kyurem White": 9,
  "Kyurem Black": 9,
  "Dragonite Delivery": 9,
  "Solrock System": 9,
  "Xerneas Active": 9,
  "Calyrex Ice Rider": 9,
  "Calyrex Shadow Rider": 9,
  "Calyrex Cloud Rider": 9,
  "Zapdos Ex": 9,
  "Articuno Ex": 9,
  "Moltres Ex": 9,
  "Zarude Dada": 7,
  // ~600-BST band, pinned explicitly so they don't drift with the BST bands:
  "Ash-Greninja": 8,
  "Clemont-Chesnaught": 8,
  "Serena-Delphox": 8,
  "Unown Revelation": 8,
  "Deoxys Attack": 8,
  "Deoxys Defense": 8,
  "Deoxys Speed": 8,
  "Shaymin Sky": 8,
  "Landorus Therian": 8,
  "Keldeo Resolute": 8,
  "Genesect Douse Drive": 8,
  "Genesect Shock Drive": 8,
  "Genesect Burn Drive": 8,
  "Genesect Chill Drive": 8,
  "Zygarde 50 Power Construct": 8,
  "Magearna Original": 8,
  "Bewear Angry": 8,
  // Legendary Redux forms that are stronger than the generic 3-cost Redux band.
  "Azelf Redux": 6,
  "Mesprit Redux": 6,
  "Uxie Redux": 6,
};

/** Default cost banding by base-form BST (the owner-approved "rest is fine" scale). */
function bandCostByBst(name: string, bst: number): number {
  // Normal Redux forms: 3-4 (4 for the beefy ones).
  if (/redux/i.test(name)) {
    return bst >= 600 ? 4 : 3;
  }
  if (bst >= 670) {
    return 10;
  }
  if (bst >= 600) {
    return 8;
  }
  if (bst >= 540) {
    return 6;
  }
  if (bst >= 480) {
    return 5;
  }
  if (bst >= 400) {
    return 4;
  }
  if (bst >= 320) {
    return 3;
  }
  return 2;
}

function resolveCost(name: string, bst: number): number {
  if (Object.hasOwn(COST_OVERRIDES, name)) {
    return COST_OVERRIDES[name];
  }
  if (/^Arceus/.test(name)) {
    return 9; // every Arceus type plate → 9
  }
  return bandCostByBst(name, bst);
}

/** Custom mons at or above this cost are sold as Legendary-rarity eggs. */
const LEGENDARY_EGG_COST_FLOOR = 8;

export interface InitEliteReduxStarterCostsResult {
  recosted: number;
  removed: number;
  legendaryTiered: number;
}

/**
 * Apply the ER-custom starter-cost re-tier + form removals. Only species with
 * id >= {@linkcode ER_CUSTOM_ID_FLOOR} that already sit in the starter grid
 * (i.e. have a `speciesStarterCosts` entry) are considered.
 */
export function initEliteReduxStarterCosts(): InitEliteReduxStarterCostsResult {
  const result: InitEliteReduxStarterCostsResult = { recosted: 0, removed: 0, legendaryTiered: 0 };
  const starterCosts = speciesStarterCosts as Record<number, number>;
  const eggTiers = speciesEggTiers as Record<number, EggTier>;

  for (const species of allSpecies) {
    const id = species.speciesId;
    if (id < ER_CUSTOM_ID_FLOOR || !Object.hasOwn(starterCosts, id)) {
      continue;
    }
    if (REMOVE_FROM_GRID_AND_EGGS.some(re => re.test(species.name))) {
      delete starterCosts[id]; // out of the starter grid
      delete eggTiers[id]; // out of the egg pool
      result.removed++;
      continue;
    }
    const cost = resolveCost(species.name, species.baseTotal);
    starterCosts[id] = cost;
    result.recosted++;
    // High-cost customs (8-12: legendaries + AG mons) hatch from Legendary eggs.
    if (cost >= LEGENDARY_EGG_COST_FLOOR && Object.hasOwn(eggTiers, id)) {
      eggTiers[id] = EggTier.LEGENDARY;
      result.legendaryTiered++;
    }
  }

  return result;
}
