/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — editor-managed per-species tuning (egg tier + starter cost).
//
// The DATA lives in `er-species-tuning.json` (speciesConst → partial tuning)
// so the team balancing editor can read/write it without touching TypeScript:
//
//   { "SPECIES_PIKACHU": { "eggTier": 2, "cost": 5 } }
//
// Overrides are ADDITIVE: an absent species (or an absent field) means the
// vanilla / init-computed value stays untouched. `eggTier` is the serialized
// EggTier value (0 COMMON / 1 RARE / 2 EPIC / 3 LEGENDARY) — values map BY KEY
// onto the existing enum, never by repositioning.
//
// This pass runs LAST in the egg-tier/cost init chain (after
// initEliteReduxEggTiers + initEliteReduxStarterCosts), so a committed editor
// edit is the final word. It only overrides species that are STILL PRESENT in
// the respective table — species removed earlier (battle-only forms, egg-pool
// bans) are never re-added by a stale tuning entry.
//
// speciesConst → pokerogue id resolution mirrors init-elite-redux-egg-moves.ts:
//   - vanilla species → the `SpeciesId` enum (SPECIES_PIKACHU → SpeciesId.PIKACHU)
//   - ER customs      → the ER id-map (draft id → pokerogue id)
// =============================================================================

import { speciesEggTiers } from "#balance/species-egg-tiers";
import { speciesStarterCosts } from "#balance/starters";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import type { EggTier } from "#enums/egg-type";
import { SpeciesId } from "#enums/species-id";
import speciesTuningJson from "./er-species-tuning.json";

export interface ErSpeciesTuningEntry {
  /** Serialized EggTier value: 0 COMMON / 1 RARE / 2 EPIC / 3 LEGENDARY. */
  eggTier?: number;
  /** Starter-select point cost. */
  cost?: number;
}

export type ErSpeciesTuning = Record<string, ErSpeciesTuningEntry>;

export interface InitEliteReduxSpeciesTuningResult {
  /** Egg-tier overrides applied. */
  eggTiersApplied: number;
  /** Starter-cost overrides applied. */
  costsApplied: number;
  /** Entries skipped because the species is not (or no longer) in the target table. */
  skippedAbsent: number;
  /** speciesConsts that didn't resolve to a pokerogue id (id-map drift). */
  skippedUnmapped: number;
}

/** Resolve a speciesConst to its live pokerogue species id (vanilla or ER custom). */
function resolveSpeciesId(speciesConst: string, draftIdByConst: ReadonlyMap<string, number>): number | undefined {
  const draftId = draftIdByConst.get(speciesConst);
  if (draftId === undefined) {
    const id = (SpeciesId as unknown as Record<string, number | undefined>)[speciesConst.replace(/^SPECIES_/, "")];
    return typeof id === "number" ? id : undefined;
  }
  return ER_ID_MAP.species[draftId];
}

/**
 * Apply the editor-managed species tuning over the live egg-tier + starter-cost
 * tables. `tuning` is injectable for tests; production callers use the JSON.
 */
export function applyErSpeciesTuning(
  tuning: ErSpeciesTuning = speciesTuningJson as ErSpeciesTuning,
): InitEliteReduxSpeciesTuningResult {
  const result: InitEliteReduxSpeciesTuningResult = {
    eggTiersApplied: 0,
    costsApplied: 0,
    skippedAbsent: 0,
    skippedUnmapped: 0,
  };

  const draftIdByConst = new Map<string, number>();
  for (const draft of ER_SPECIES) {
    draftIdByConst.set(draft.speciesConst, draft.id);
  }

  const tiers = speciesEggTiers as Record<number, EggTier>;
  const costs = speciesStarterCosts as Record<number, number>;

  for (const [speciesConst, entry] of Object.entries(tuning)) {
    const pkrgId = resolveSpeciesId(speciesConst, draftIdByConst);
    if (pkrgId === undefined) {
      result.skippedUnmapped++;
      continue;
    }
    if (typeof entry.eggTier === "number" && entry.eggTier >= 0 && entry.eggTier <= 3) {
      if (Object.hasOwn(tiers, pkrgId)) {
        tiers[pkrgId] = entry.eggTier as EggTier;
        result.eggTiersApplied++;
      } else {
        result.skippedAbsent++;
      }
    }
    if (typeof entry.cost === "number" && entry.cost > 0) {
      if (Object.hasOwn(costs, pkrgId)) {
        costs[pkrgId] = entry.cost;
        result.costsApplied++;
      } else {
        result.skippedAbsent++;
      }
    }
  }

  return result;
}

/** Init-chain entry point (uses the committed JSON). */
export function initEliteReduxSpeciesTuning(): InitEliteReduxSpeciesTuningResult {
  return applyErSpeciesTuning();
}
