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
 * The premium goods, each with a PRICE WEIGHT (multiplied by the wave money unit
 * to set the steep shop price). No heals. Rough ordering: balls + utility +
 * charms, priciest = the run-defining charms and Master Ball.
 */
const EXOTIC_GOODS: { func: ModifierTypeFunc | undefined; weight: number }[] = [
  { func: modifierTypes.MASTER_BALL, weight: 28 },
  { func: modifierTypes.ROGUE_BALL, weight: 9 },
  { func: modifierTypes.ULTRA_BALL, weight: 4 },
  { func: modifierTypes.SHELL_BELL, weight: 12 },
  { func: modifierTypes.LEFTOVERS, weight: 10 },
  { func: modifierTypes.FOCUS_BAND, weight: 12 },
  { func: modifierTypes.KINGS_ROCK, weight: 9 },
  { func: modifierTypes.GRIP_CLAW, weight: 9 },
  { func: modifierTypes.WIDE_LENS, weight: 8 },
  { func: modifierTypes.SCOPE_LENS, weight: 9 },
  { func: modifierTypes.MULTI_LENS, weight: 16 },
  { func: modifierTypes.AMULET_COIN, weight: 13 },
  { func: modifierTypes.GOLDEN_EXP_CHARM, weight: 20 },
  { func: modifierTypes.ABILITY_CHARM, weight: 18 },
  { func: modifierTypes.SHINY_CHARM, weight: 24 },
  { func: modifierTypes.IV_SCANNER, weight: 8 },
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
  const out: ModifierTypeOption[] = [];
  for (const good of EXOTIC_GOODS) {
    if (!good.func) {
      continue;
    }
    const option = generateModifierTypeOption(good.func);
    if (!option) {
      continue;
    }
    option.cost = Math.round(unit * Math.max(MIN_PRICE_WEIGHT, good.weight));
    out.push(option);
  }
  return out;
}
