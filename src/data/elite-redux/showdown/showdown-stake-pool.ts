/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 WAGER stake pool (Task D3b). Enumerates a player's FULL wagerable
// collection from their save (owned lines as non-shiny stakes, every owned shiny
// VARIANT as its own stake, ER black shinies as the top tier), tier-sorted highest
// first. Pure over an injected {@linkcode StakePoolGameData} subset so it's unit-testable
// without a GameData; the wager screen pages/windows the (potentially hundreds-long) list.
// =============================================================================

import { speciesStarterCosts } from "#balance/starters";
import { type StakeOffer, type StakeVariant, stakeTier } from "#data/elite-redux/showdown/showdown-stakes";
import { DexAttr } from "#enums/dex-attr";
import type { DexData } from "#types/dex-data";
import type { StarterData } from "#types/save-data";

/** The structural subset of GameData the pool builder reads (real GameData satisfies it). */
export interface StakePoolGameData {
  dexData: DexData;
  starterData: StarterData;
}

/** The DexAttr variant bit for a shiny variant index (0/1/2). */
const VARIANT_BITS: [StakeVariant, bigint][] = [
  [0, DexAttr.DEFAULT_VARIANT],
  [1, DexAttr.VARIANT_2],
  [2, DexAttr.VARIANT_3],
];

/**
 * Build the player's full wagerable stake pool, tier-sorted (highest tier first).
 * A line contributes: its non-shiny species stake (if the line is caught), one shiny
 * stake per OWNED variant, and a black-shiny stake when `erBlackShiny` is set.
 */
export function buildShowdownStakePool(gameData: StakePoolGameData): StakeOffer[] {
  const offers: StakeOffer[] = [];
  for (const key of Object.keys(speciesStarterCosts)) {
    const rootId = Number(key);
    const entry = gameData.dexData[rootId];
    if (!entry || entry.caughtAttr === 0n) {
      continue; // not owned — nothing to stake from this line
    }
    const cost = (speciesStarterCosts as Record<number, number>)[rootId] ?? 0;
    // Non-shiny species stake (the base line unlock).
    offers.push({ speciesId: rootId, shiny: false, variant: 0, erBlackShiny: false, cost });
    // One shiny stake per owned variant.
    if (entry.caughtAttr & DexAttr.SHINY) {
      for (const [variant, bit] of VARIANT_BITS) {
        if (entry.caughtAttr & bit) {
          offers.push({ speciesId: rootId, shiny: true, variant, erBlackShiny: false, cost });
        }
      }
    }
    // ER black shiny (top tier).
    if (gameData.starterData[rootId]?.erBlackShiny) {
      offers.push({ speciesId: rootId, shiny: true, variant: 2, erBlackShiny: true, cost });
    }
  }
  // Highest tier first; break ties by species id for a stable order.
  offers.sort((a, b) => stakeTier(b) - stakeTier(a) || a.speciesId - b.speciesId);
  return offers;
}
