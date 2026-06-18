/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #542 - The Import Bazaar's stock. A curated ISLAND trade-hub goods list for
// the real shop screen (ImportBazaarShopPhase). Unlike the Exotic Trader (premium
// Ultra->Master only, steep), the bazaar is a busy market of IMPORTED held items
// and supplies at FAIR mid-tier prices - a place to round out a build, not a
// money-sink for top-shelf goods. No healing items (heals belong in biome shops).
//
// Pure data layer: builds ModifierTypeOption[] for the biome-shop UI. Keys are
// resolved LAZILY + null-safe (a missing key is skipped, never throws).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { generateModifierTypeOption } from "#mystery-encounters/encounter-phase-utils";
import type { ModifierTypeOption } from "#modifiers/modifier-type";
import type { ModifierTypeFunc } from "#types/modifier-types";

/**
 * The bazaar goods by modifier-type KEY, each with a PRICE WEIGHT (multiplied by
 * the wave money unit). Held items + utility + a couple of balls, at fair prices.
 * Keys (not func refs) so the modifierTypes registry is read at call time.
 */
const IMPORT_GOODS: { key: string; weight: number }[] = [
  { key: "WIDE_LENS", weight: 5 },
  { key: "SCOPE_LENS", weight: 6 },
  { key: "MULTI_LENS", weight: 11 },
  { key: "QUICK_CLAW", weight: 6 },
  { key: "GRIP_CLAW", weight: 6 },
  { key: "KINGS_ROCK", weight: 6 },
  { key: "LEFTOVERS", weight: 7 },
  { key: "SHELL_BELL", weight: 8 },
  { key: "FOCUS_BAND", weight: 8 },
  { key: "REVIVER_SEED", weight: 9 },
  { key: "SOOTHE_BELL", weight: 4 },
  { key: "BATON", weight: 4 },
  { key: "GREAT_BALL", weight: 2 },
  { key: "ULTRA_BALL", weight: 4 },
  { key: "AMULET_COIN", weight: 9 },
  { key: "EXP_CHARM", weight: 6 },
];

/** Floor so even the cheapest stall good is not free. */
const MIN_PRICE_WEIGHT = 3;

/**
 * Build the Import Bazaar's shop stock. Each entry resolves its modifier type
 * (skipped if absent in this build), then gets a fair wave-scaled price. Returns
 * the options in declaration order for the shop grid.
 */
export function buildImportShopStock(): ModifierTypeOption[] {
  const unit = globalScene.getWaveMoneyAmount(1);
  const registry = modifierTypes as Record<string, ModifierTypeFunc | undefined>;
  const out: ModifierTypeOption[] = [];
  for (const good of IMPORT_GOODS) {
    const func = registry[good.key];
    if (!func) {
      continue;
    }
    const option = generateModifierTypeOption(func);
    if (!option) {
      continue;
    }
    option.cost = Math.round(unit * Math.max(MIN_PRICE_WEIGHT, good.weight));
    out.push(option);
  }
  return out;
}
