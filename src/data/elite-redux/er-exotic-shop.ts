/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #488 - The Exotic Trader's stock. A curated PREMIUM goods list for the real
// shop screen (ExoticShopPhase), faithful to the recovered design: "every single
// good is Master-Ball to Ultra-Ball tier ... prices are still high, but there's
// some good stuff." So: top-shelf balls + premium held items + charms, at STEEP
// prices, and NO healing items (no potions / revives / ethers).
//
// Pure data layer: builds ModifierTypeOption[] for the biome-shop UI to render.
// Keys are resolved null-safe (a missing key is skipped, never throws), and each
// option's cost is set to a wave-scaled premium so the trader is a money sink for
// the genuinely good stuff, not a cheap giveaway.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { generateModifierTypeOption } from "#mystery-encounters/encounter-phase-utils";
import type { ModifierTypeOption } from "#modifiers/modifier-type";
import type { ModifierTypeFunc } from "#types/modifier-types";

/**
 * The premium goods by modifier-type KEY, each with a PRICE WEIGHT (multiplied by
 * the wave money unit to set the steep shop price). No heals. Keys (not direct
 * func refs) so the modifierTypes registry is read LAZILY at call time - it is an
 * empty object until initModifierTypes() runs, so capturing func refs at module
 * load would freeze in `undefined` and empty the shop.
 */
const EXOTIC_GOODS: { key: string; weight: number }[] = [
  { key: "MASTER_BALL", weight: 28 },
  { key: "ROGUE_BALL", weight: 9 },
  { key: "ULTRA_BALL", weight: 4 },
  { key: "SHELL_BELL", weight: 12 },
  { key: "LEFTOVERS", weight: 10 },
  { key: "FOCUS_BAND", weight: 12 },
  { key: "KINGS_ROCK", weight: 9 },
  { key: "GRIP_CLAW", weight: 9 },
  { key: "WIDE_LENS", weight: 8 },
  { key: "SCOPE_LENS", weight: 9 },
  { key: "MULTI_LENS", weight: 16 },
  { key: "AMULET_COIN", weight: 13 },
  { key: "GOLDEN_EXP_CHARM", weight: 20 },
  { key: "ABILITY_CHARM", weight: 18 },
  { key: "SHINY_CHARM", weight: 24 },
  { key: "IV_SCANNER", weight: 8 },
];

/** Floor so even the "cheapest" exotic good still reads as premium. */
const MIN_PRICE_WEIGHT = 6;

/**
 * Build the Exotic Trader's shop stock. Each entry resolves its modifier type
 * (skipped if the key is absent in this build), then gets a steep wave-scaled
 * price. Returns the options in declaration order for the shop grid.
 */
export function buildExoticShopStock(): ModifierTypeOption[] {
  const unit = globalScene.getWaveMoneyAmount(1);
  const registry = modifierTypes as Record<string, ModifierTypeFunc | undefined>;
  const out: ModifierTypeOption[] = [];
  for (const good of EXOTIC_GOODS) {
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
