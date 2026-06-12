/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - bans for GENERIC species pools (#414).
//
// Vanilla draws "any species in a BST window" from `allSpecies` in two places:
// the Weird Dream mystery encounter (party transformations) and the Global
// Trade System encounter (trade offers). On ER, `allSpecies` also contains
// every standalone CUSTOM species record - including the 294 mega/primal/
// origin form records ("Urshifu Mega" BST 660, "Garchomp Mega Y", ...) whose
// stats live on their own species entries. Vanilla's exclusion lists ban
// vanilla legendaries BY SpeciesId, so the ER customs (id >= 10000,
// legendary=false) sailed straight through: a wave-13 Weird Dream could
// transform a party mon into a permanent "Mega Urshifu" (the live #414
// report; #311's "Garchomp-Y at wave 13" was the same hole).
//
// Rules:
//   1. Battle-only/mega custom species NEVER appear in these pools - they are
//      not real obtainable mons (no base form, can't hatch, can't revert).
//   2. On the PURE-VANILLA difficulties (Youngster / Ace, #345) NO custom
//      species appears - those modes must play like stock PokeRogue.
// =============================================================================

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_MEGA_FORMS } from "#data/elite-redux/er-mega-forms";
import { isErVanillaDifficulty } from "#data/elite-redux/er-run-difficulty";

/** First pokerogue id reserved for ER custom species. */
const ER_CUSTOM_ID_CUTOFF = 10000;

/**
 * Display-name tokens that mark a custom species record as a BATTLE-ONLY form
 * (same token list the egg-tier gate uses - see `isErFormChangeTarget` in
 * init-elite-redux-egg-tiers.ts, verified unambiguous across ER_SPECIES).
 */
const ER_BATTLE_FORM_NAME_TOKENS =
  /\b(Mega|Primal|Hangry|Bond|Blunder|Blade|School|Zen|Noice|Crowned|Origin|Gigantamax|Eternamax|Busted|Gulping|Gorging|Sunshine)\b/i;

/** Lazily-built set of pokerogue ids of DIRECT mega/primal/origin species records. */
let ER_MEGA_TARGET_IDS: Set<number> | null = null;
function megaTargetIds(): Set<number> {
  if (ER_MEGA_TARGET_IDS !== null) {
    return ER_MEGA_TARGET_IDS;
  }
  const ids = new Set<number>();
  for (const entry of ER_MEGA_FORMS) {
    const pk = ER_ID_MAP.species[entry.targetErId];
    if (pk !== undefined && pk >= ER_CUSTOM_ID_CUTOFF) {
      ids.add(pk);
    }
  }
  ER_MEGA_TARGET_IDS = ids;
  return ids;
}

/**
 * True if this custom species is a battle-only form record (mega / primal /
 * origin / Hangry / Blade / Gigantamax / ...) that must never be handed to the
 * player as a standalone mon. Always false for vanilla species (id < 10000).
 */
export function isErBattleFormCustomSpecies(speciesId: number, name: string): boolean {
  if (speciesId < ER_CUSTOM_ID_CUTOFF) {
    return false;
  }
  return megaTargetIds().has(speciesId) || ER_BATTLE_FORM_NAME_TOKENS.test(name) || /^Darmanitan Aura$/i.test(name);
}

/**
 * True if `speciesId` must be excluded from a generic "any species in a BST
 * window" pool (Weird Dream transformations, GTS trade offers):
 * battle-only/mega customs always, ALL customs on Youngster/Ace (#345).
 */
export function isErGenericPoolBanned(speciesId: number, name: string): boolean {
  if (speciesId < ER_CUSTOM_ID_CUTOFF) {
    return false;
  }
  if (isErBattleFormCustomSpecies(speciesId, name)) {
    return true;
  }
  return isErVanillaDifficulty();
}
