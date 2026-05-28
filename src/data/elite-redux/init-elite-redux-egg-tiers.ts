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
// This init pass adds every ER-custom base/root species to
// `speciesEggTiers` with a sensible default tier, and to
// `speciesStarterCosts` with a default cost so the egg-weight calculation
// has a value to read. Both are runtime extensions of upstream tables.
//
// Tier picking heuristic:
//   - BST >= 600 → EPIC tier
//   - BST >= 540 → RARE tier
//   - Otherwise → COMMON tier
// =============================================================================

import { pokemonPrevolutions } from "#balance/pokemon-evolutions";
import { speciesEggTiers } from "#balance/species-egg-tiers";
import { speciesStarterCosts } from "#balance/starters";
import { findErFormChangeByTarget } from "#data/elite-redux/er-form-change-overlay";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_SPECIES } from "#data/elite-redux/er-species";
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
  /** Number of ER custom form-change targets skipped (megas, primals, move-megas). */
  skippedFormChanges: number;
}

function pickTier(draft: (typeof ER_SPECIES)[number]): EggTier {
  // BST-based tiering. The field is `baseStats: readonly [hp,atk,def,spatk,spdef,spd]`.
  const stats = draft.baseStats;
  if (Array.isArray(stats) && stats.length === 6) {
    const bst = stats.reduce((s, v) => s + v, 0);
    if (bst >= 600) {
      return EggTier.EPIC;
    }
    if (bst >= 540) {
      return EggTier.RARE;
    }
    if (bst >= 470) {
      // Mid-BST → uncommon. Without an UNCOMMON tier in pokerogue, this
      // bucket also lands in RARE eggs (less likely than EPIC, more likely
      // than COMMON spam).
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

function isErFormChangeTarget(draft: (typeof ER_SPECIES)[number], speciesId: number): boolean {
  return (
    findErFormChangeByTarget(speciesId) !== undefined
    || /(?:^|_)MEGA(?:_|$)|(?:^|_)PRIMAL(?:_|$)/.test(draft.speciesConst)
    || /\b(Mega|Primal)\b/i.test(draft.name ?? "")
  );
}

function removeRuntimeStarterRegistration(speciesId: number): void {
  const tiers = speciesEggTiers as Record<number, EggTier | undefined>;
  const costs = speciesStarterCosts as Record<number, number | undefined>;
  delete tiers[speciesId];
  delete costs[speciesId];
}

/**
 * Add every ER-custom species to `speciesEggTiers` + `speciesStarterCosts`
 * so they become valid egg-hatch targets. Skips species that have a
 * prevolution and species that are form-change targets (only base/root mons
 * hatch from eggs or appear as starters).
 */
export function initEliteReduxEggTiers(): InitEliteReduxEggTiersResult {
  const result: InitEliteReduxEggTiersResult = {
    eggTiersAdded: 0,
    starterCostsAdded: 0,
    alreadyPresent: 0,
    skippedPrevolutions: 0,
    skippedFormChanges: 0,
  };

  const tiers = speciesEggTiers as Record<number, EggTier>;
  const costs = speciesStarterCosts as Record<number, number>;

  for (const draft of ER_SPECIES) {
    const pkrgId = ER_ID_MAP.species[draft.id];
    if (pkrgId === undefined || pkrgId < VANILLA_ID_CUTOFF) {
      continue;
    }
    if (isErFormChangeTarget(draft, pkrgId)) {
      removeRuntimeStarterRegistration(pkrgId);
      result.skippedFormChanges++;
      continue;
    }
    // Skip if already prevolution-gated (non-base forms can't hatch).
    if (Object.hasOwn(pokemonPrevolutions, pkrgId as SpeciesId)) {
      removeRuntimeStarterRegistration(pkrgId);
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
