/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — editor-managed item tuning (reward-pool tier + weight + params).
//
// The DATA lives in `er-item-tuning.json` (item key → partial tuning) so the
// team balancing editor can read/write it without touching TypeScript:
//
//   { "ER_LOADED_DICE": { "tier": "ROGUE", "weight": 2, "maxStack": 2 } }
//
// Item keys are the `modifierTypes` keys (LEFTOVERS, ER_OMNI_GEM, …) — each
// player-reward pool entry's `modifierType.id` is exactly that key. Overrides
// are ADDITIVE: an absent item (or absent field) keeps its current value.
//
//   - `tier`     moves the entry between the player reward pool's tier buckets
//                (COMMON / GREAT / ULTRA / ROGUE / MASTER). Mapping is BY NAME,
//                never by repositioning serialized values.
//   - `weight`   replaces the entry's weight with a constant. Items whose
//                weight is a dynamic function (party-dependent potions etc.)
//                lose that dynamism when overridden — the editor flags those.
//   - `maxWeight` optional cap; defaults to the new constant weight.
//   - `maxStack` (ER community items only) updates the held-item stack cap in
//                ER_COMMUNITY_ITEM_CONFIG, which the modifier reads live.
//
// Applies to the PLAYER reward pool (`modifierPool`) only — wild/trainer/enemy
// pools keep their own curves. Runs right after initModifierPools().
// =============================================================================

import { ER_COMMUNITY_ITEM_CONFIG, type ErCommunityItemKind } from "#data/elite-redux/er-community-items";
import { ModifierTier } from "#enums/modifier-tier";
import { modifierPool } from "#modifiers/modifier-pools";
import type { WeightedModifierType } from "#modifiers/modifier-type";
import itemTuningJson from "./er-item-tuning.json";

export interface ErItemTuningEntry {
  /** Target reward-pool tier NAME: COMMON / GREAT / ULTRA / ROGUE / MASTER. */
  tier?: string;
  /** Constant roll weight inside the tier bucket. */
  weight?: number;
  /** Optional weight cap (defaults to `weight` when that is overridden). */
  maxWeight?: number;
  /** ER community held items only: stack cap. */
  maxStack?: number;
}

export type ErItemTuning = Record<string, ErItemTuningEntry>;

export interface InitEliteReduxItemTuningResult {
  /** Entries whose tier was moved. */
  tiersMoved: number;
  /** Entries whose weight was replaced. */
  weightsApplied: number;
  /** maxStack overrides applied (ER community items). */
  maxStacksApplied: number;
  /** Item keys not found in the player reward pool (or bad field values). */
  skipped: number;
}

/** The player-reward tiers the editor may place items into. */
const EDITABLE_TIERS: ReadonlyArray<readonly [string, ModifierTier]> = [
  ["COMMON", ModifierTier.COMMON],
  ["GREAT", ModifierTier.GREAT],
  ["ULTRA", ModifierTier.ULTRA],
  ["ROGUE", ModifierTier.ROGUE],
  ["MASTER", ModifierTier.MASTER],
];

/** "ER_LOADED_DICE" → "loadedDice" (the ER_COMMUNITY_ITEM_CONFIG key). */
function erCommunityKindForItemKey(itemKey: string): ErCommunityItemKind | undefined {
  if (!itemKey.startsWith("ER_")) {
    return;
  }
  const kind = itemKey
    .slice(3)
    .toLowerCase()
    .replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  return Object.hasOwn(ER_COMMUNITY_ITEM_CONFIG, kind) ? (kind as ErCommunityItemKind) : undefined;
}

function findPoolEntry(itemKey: string): { entry: WeightedModifierType; tier: ModifierTier } | undefined {
  for (const [, tier] of EDITABLE_TIERS) {
    for (const entry of modifierPool[tier] ?? []) {
      if (entry.modifierType.id === itemKey) {
        return { entry, tier };
      }
    }
  }
  return;
}

/**
 * Apply the editor-managed item tuning over the live player reward pool.
 * `tuning` is injectable for tests; production callers use the JSON.
 */
export function applyErItemTuning(
  tuning: ErItemTuning = itemTuningJson as ErItemTuning,
): InitEliteReduxItemTuningResult {
  const result: InitEliteReduxItemTuningResult = { tiersMoved: 0, weightsApplied: 0, maxStacksApplied: 0, skipped: 0 };

  for (const [itemKey, entry] of Object.entries(tuning)) {
    // maxStack is config-table based and works even for items not in the pool.
    if (typeof entry.maxStack === "number" && entry.maxStack >= 1) {
      const kind = erCommunityKindForItemKey(itemKey);
      if (kind === undefined) {
        result.skipped++;
      } else {
        (ER_COMMUNITY_ITEM_CONFIG as Record<ErCommunityItemKind, { maxStack: number }>)[kind].maxStack = Math.floor(
          entry.maxStack,
        );
        result.maxStacksApplied++;
      }
    }

    const needsPool = entry.tier !== undefined || entry.weight !== undefined || entry.maxWeight !== undefined;
    if (!needsPool) {
      continue;
    }
    const found = findPoolEntry(itemKey);
    if (found === undefined) {
      result.skipped++;
      continue;
    }
    const { entry: poolEntry, tier: currentTier } = found;

    if (typeof entry.weight === "number" && entry.weight >= 0) {
      poolEntry.weight = entry.weight;
      poolEntry.maxWeight =
        typeof entry.maxWeight === "number" && entry.maxWeight >= 0 ? entry.maxWeight : entry.weight;
      result.weightsApplied++;
    } else if (typeof entry.maxWeight === "number" && entry.maxWeight >= 0) {
      poolEntry.maxWeight = entry.maxWeight;
      result.weightsApplied++;
    }

    if (entry.tier !== undefined) {
      const target = EDITABLE_TIERS.find(([name]) => name === entry.tier)?.[1];
      if (target === undefined) {
        result.skipped++;
      } else if (target !== currentTier) {
        const from = modifierPool[currentTier] ?? [];
        const idx = from.indexOf(poolEntry);
        if (idx >= 0) {
          from.splice(idx, 1);
        }
        if (modifierPool[target] === undefined) {
          modifierPool[target] = [];
        }
        modifierPool[target].push(poolEntry);
        poolEntry.setTier(target);
        result.tiersMoved++;
      }
    }
  }

  return result;
}

/** Init-chain entry point (uses the committed JSON). */
export function initEliteReduxItemTuning(): InitEliteReduxItemTuningResult {
  return applyErItemTuning();
}
