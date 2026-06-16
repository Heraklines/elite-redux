/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #489 - The Black Market's stock. A BARGAIN goods list for the real shop
// screen (BlackMarketShopPhase): cheap "used" goods, MIXED tier - mostly humble
// utility with the odd better-than-you'd-expect find, all at back-alley prices
// (well under the normal market). The design's curse-lite "fine print" on the
// cheapest stock is a later refinement; this is the cheap-goods core.
//
// Pure data layer (mirrors er-exotic-shop): builds ModifierTypeOption[] for the
// biome-shop UI, each at a low wave-scaled price. Missing keys are skipped.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { generateModifierTypeOption } from "#mystery-encounters/encounter-phase-utils";
import type { ModifierTypeOption } from "#modifiers/modifier-type";
import type { ModifierTypeFunc } from "#types/modifier-types";

/**
 * The bargain goods, each with a low PRICE WEIGHT (multiplied by the wave money
 * unit). Cheap utility held items + balls + a couple of cheap consumables, mixed
 * tier. Deliberately low weights so the whole stall reads as a back-alley bargain.
 */
// Keys (not direct func refs) so modifierTypes is read LAZILY at call time -
// it is empty until initModifierTypes() runs, so module-load capture would empty
// the shop.
const STALL_GOODS: { key: string; weight: number }[] = [
  { key: "GREAT_BALL", weight: 1 },
  { key: "ULTRA_BALL", weight: 2 },
  { key: "QUICK_CLAW", weight: 2 },
  { key: "WIDE_LENS", weight: 2 },
  { key: "SCOPE_LENS", weight: 2 },
  { key: "GRIP_CLAW", weight: 2 },
  { key: "KINGS_ROCK", weight: 2 },
  { key: "LEFTOVERS", weight: 3 },
  { key: "SHELL_BELL", weight: 3 },
  { key: "FOCUS_BAND", weight: 3 },
  { key: "SUPER_POTION", weight: 1 },
  { key: "HYPER_POTION", weight: 2 },
  { key: "REVIVE", weight: 2 },
  { key: "SOOTHE_BELL", weight: 2 },
  { key: "MULTI_LENS", weight: 5 },
  { key: "REVIVER_SEED", weight: 4 },
];

/** Floor so even a "free-ish" find still costs a coin. */
const MIN_PRICE_WEIGHT = 1;

/**
 * Build the Black Market's bargain shop stock. Each entry resolves its modifier
 * type (skipped if absent), then gets a CHEAP wave-scaled price. Order preserved
 * for the shop grid.
 */
export function buildBlackMarketShopStock(): ModifierTypeOption[] {
  const unit = globalScene.getWaveMoneyAmount(1);
  const registry = modifierTypes as Record<string, ModifierTypeFunc | undefined>;
  const out: ModifierTypeOption[] = [];
  for (const good of STALL_GOODS) {
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
