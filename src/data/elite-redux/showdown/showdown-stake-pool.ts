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
    const isShiny = (entry.caughtAttr & DexAttr.SHINY) !== 0n;
    const hasBlack = gameData.starterData[rootId]?.erBlackShiny === true;

    // M2 (reviewer ruling): a NON-SHINY line stake ("lose the species") is offered ONLY when the
    // line owns NO shiny variant — this keeps the "clear the whole line" removal from ever orphaning
    // a shiny, since a shiny owner can never stake the bare species.
    if (!isShiny) {
      offers.push({ speciesId: rootId, shiny: false, variant: 0, erBlackShiny: false, cost });
    }

    // One shiny stake per owned variant.
    if (isShiny) {
      for (const [variant, bit] of VARIANT_BITS) {
        if (!(entry.caughtAttr & bit)) {
          continue;
        }
        // C2 (reviewer ruling): when the line owns the BLACK shiny, the save model can't distinguish
        // "owns black" from "owns black + regular v3" (they share the VARIANT_3 bit), so the regular
        // variant-3 (v2) stake is SUPPRESSED — only the BLACK is stakeable for that top slot. Lower
        // variants (v0/v1) stay individually stakeable.
        if (variant === 2 && hasBlack) {
          continue;
        }
        offers.push({ speciesId: rootId, shiny: true, variant, erBlackShiny: false, cost });
      }
    }

    // ER black shiny (top tier) — the only v3-tier stake when the black is owned.
    if (hasBlack) {
      offers.push({ speciesId: rootId, shiny: true, variant: 2, erBlackShiny: true, cost });
    }
  }
  // Highest tier first; break ties by species id for a stable order.
  offers.sort((a, b) => stakeTier(b) - stakeTier(a) || a.speciesId - b.speciesId);
  return offers;
}
