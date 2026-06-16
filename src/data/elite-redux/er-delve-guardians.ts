/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #494 - shared guardian picker for the press-your-luck DELVE events (Abyssal
// Vent, Glittering Vein, Overgrown Temple). Each deeper "stir" should pull a
// guardian whose BASE STAT TOTAL climbs with depth (not just more HP bars), and
// whose TYPE matches the event's biome (Cave = Rock/Ground, Sea/Seabed = Water,
// Jungle/Temple = Grass/Bug, ...).
//
// Pacing is deliberately moderate: the target BST starts mid-low and steps up a
// fixed amount per stir, so it climbs the ladder smoothly instead of jumping from
// an NFE straight to a near-legendary. Legendaries / mythicals are excluded.
// =============================================================================

import { allSpecies } from "#data/data-lists";
import type { PokemonSpecies } from "#data/pokemon-species";
import type { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { randSeedItem } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/** BST the very first (interrupts = 0) guardian aims for. */
const START_BST = 380;
/** BST added to the target per prior stir (the moderate climb rate). */
const BST_STEP = 50;
/** The target BST never exceeds this - a tough guardian, but not a legend. */
const BST_CAP = 640;
/** Half-width of the BST band a guardian is drawn from (adds variety per rung). */
const BST_WINDOW = 25;
/** Hard floor so weak NFEs never appear as guardians. */
const BST_FLOOR = 300;

/** Is this species a usable guardian of one of the allowed types? */
function eligible(sp: PokemonSpecies, types: PokemonType[]): boolean {
  if (sp.legendary || sp.subLegendary || sp.mythical) {
    return false;
  }
  const bst = sp.getBaseStatTotal();
  if (bst < BST_FLOOR || bst > BST_CAP + 40) {
    return false;
  }
  return types.includes(sp.type1) || (sp.type2 != null && types.includes(sp.type2));
}

/**
 * Pick a guardian whose BST sits on the rung for this depth. `interrupts` is how
 * many stirs have been survived (0 = first dive); `isBoss` pulls from the top of
 * the band. The species' type always matches one of `types`.
 */
export function guardianForDepth(types: PokemonType[], interrupts: number, isBoss: boolean): PokemonSpecies {
  const target = isBoss ? BST_CAP : Math.min(START_BST + interrupts * BST_STEP, BST_CAP);
  const pool = allSpecies.filter(sp => eligible(sp, types));
  if (pool.length === 0) {
    // Should never happen for the curated event types; failsafe to a Water mon.
    return getPokemonSpecies(SpeciesId.MAGIKARP);
  }
  // Draw from the species clustered around the target BST (variety on the rung);
  // if none sit in the band, take the first at/above target, else the strongest.
  const band = pool.filter(sp => Math.abs(sp.getBaseStatTotal() - target) <= BST_WINDOW);
  if (band.length > 0) {
    return randSeedItem(band);
  }
  const sorted = pool.sort((a, b) => a.getBaseStatTotal() - b.getBaseStatTotal());
  return sorted.find(sp => sp.getBaseStatTotal() >= target) ?? sorted[sorted.length - 1];
}
