/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #489 - The Black Market shop phase. A BiomeShopPhase variant that swaps the
// every-10-wave biome stock for the cheap, mixed-tier bargain goods
// (er-black-market-shop). Everything else - the full-screen 4x4 shop UI,
// purchase / party-target / money / leave plumbing - is inherited unchanged.
//
// Launched from the Black Market mystery encounter via the encounter's
// doEncounterRewards hook (unshiftNew), so it runs as a real phase before the
// post-encounter continuation - no softlock.
// =============================================================================

import { erBiomeStockCount } from "#data/elite-redux/er-biome-economy";
import { buildBlackMarketShopStock } from "#data/elite-redux/er-black-market-shop";
import { ModifierTier } from "#enums/modifier-tier";
import { BiomeShopPhase } from "#phases/biome-shop-phase";

export class BlackMarketShopPhase extends BiomeShopPhase {
  protected override coopMarketProjectionKind(): "black-market" {
    return "black-market";
  }

  protected override erIsBlackMarket(): boolean {
    return true;
  }

  protected override buildStock(): void {
    this.shopOptions = buildBlackMarketShopStock();
    // Bargain goods stock a few copies each (scarcer for the rarer odd find).
    this.qtys = this.shopOptions.map(o => erBiomeStockCount(o.type.getOrInferTier() ?? ModifierTier.GREAT));
  }
}
