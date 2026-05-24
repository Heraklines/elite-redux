/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — register ER-custom species in the egg-hatch + starter-cost
// tables so they're hatchable from gacha eggs.
//
// Pokerogue gates which species can hatch from eggs by membership in
// `speciesEggTiers`. ER customs (id >= 10000) are NOT in that table by
// default — meaning a player who hatches a bunch of eggs would never see
// any of the ER customs (Phantowl, Anubisn't, the regional-variant slot
// and so on).
//
// This init pass adds every ER-custom base-form species to
// `speciesEggTiers` with a sensible default tier, and to
// `speciesStarterCosts` with a default cost so the egg-weight calculation
// has a value to read. Both are runtime extensions of upstream tables.
//
// Tier picking heuristic:
//   - "Mega" or "Primal" form name → LEGENDARY tier
//   - BST >= 600 → EPIC tier
//   - BST >= 540 → RARE tier
//   - Otherwise → COMMON tier
// =============================================================================

import { speciesStarterCosts } from "#balance/starters";
import { pokemonPrevolutions } from "#balance/pokemon-evolutions";
import { speciesEggTiers } from "#balance/species-egg-tiers";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { EggTier } from "#enums/egg-type";
import type { SpeciesId } from "#enums/species-id";

const VANILLA_ID_CUTOFF = 10000;

export interface InitEliteReduxEggTiersResult {
  /** Number of ER-custom species added to speciesEggTiers. */
  eggTiersAdded: number;
  /** Number of ER-custom species added to speciesStarterCosts. */
  starterCostsAdded: number;
  /** Number of ER customs already in the table (idempotent skip). */
  alreadyPresent: number;
  /** Number of ER customs skipped because they have a prevolution (only base forms hatch). */
  skippedPrevolutions: number;
}

function pickTier(draft: (typeof ER_SPECIES)[number]): EggTier {
  // ER drafts have a `name` field — check for Mega/Primal naming patterns.
  const name = draft.name ?? "";
  if (/Mega|Primal/i.test(name)) {
    return EggTier.LEGENDARY;
  }
  // BST-based tiering. ER stats live under `stats.base` as a 6-tuple.
  const stats = (draft as unknown as { stats?: { base?: number[] } }).stats?.base;
  if (Array.isArray(stats) && stats.length === 6) {
    const bst = stats.reduce((s, v) => s + v, 0);
    if (bst >= 600) {
      return EggTier.EPIC;
    }
    if (bst >= 540) {
      return EggTier.RARE;
    }
  }
  return EggTier.COMMON;
}

function pickStarterCost(tier: EggTier): number {
  switch (tier) {
    case EggTier.LEGENDARY:
      return 8;
    case EggTier.EPIC:
      return 6;
    case EggTier.RARE:
      return 4;
    default:
      return 2;
  }
}

/**
 * Add every ER-custom species to `speciesEggTiers` + `speciesStarterCosts`
 * so they become valid egg-hatch targets. Skips species that have a
 * prevolution (only base-form mons hatch from eggs).
 */
export function initEliteReduxEggTiers(): InitEliteReduxEggTiersResult {
  const result: InitEliteReduxEggTiersResult = {
    eggTiersAdded: 0,
    starterCostsAdded: 0,
    alreadyPresent: 0,
    skippedPrevolutions: 0,
  };

  const tiers = speciesEggTiers as Record<number, EggTier>;
  const costs = speciesStarterCosts as Record<number, number>;

  for (const draft of ER_SPECIES) {
    const pkrgId = ER_ID_MAP.species[draft.id];
    if (pkrgId === undefined || pkrgId < VANILLA_ID_CUTOFF) {
      continue;
    }
    // Skip if already prevolution-gated (non-base forms can't hatch).
    if (Object.hasOwn(pokemonPrevolutions, pkrgId as SpeciesId)) {
      result.skippedPrevolutions++;
      continue;
    }
    if (tiers[pkrgId] !== undefined) {
      result.alreadyPresent++;
      continue;
    }
    const tier = pickTier(draft);
    tiers[pkrgId] = tier;
    result.eggTiersAdded++;
    if (costs[pkrgId] === undefined) {
      costs[pkrgId] = pickStarterCost(tier);
      result.starterCostsAdded++;
    }
  }

  return result;
}
