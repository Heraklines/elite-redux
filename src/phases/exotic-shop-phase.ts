/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #488 - The Exotic Trader shop phase. A BiomeShopPhase variant that swaps the
// every-10-wave biome stock for the curated premium Exotic Trader goods
// (er-exotic-shop). Everything else - the full-screen 4x4 shop UI, purchase /
// party-target / money plumbing, leave-confirm - is inherited unchanged.
//
// Launched from the Exotic Trader mystery encounter via the encounter's
// doEncounterRewards hook (unshiftNew), so it runs as a real phase before the
// post-encounter continuation - no softlock.
// =============================================================================

import { erBiomeStockCount } from "#data/elite-redux/er-biome-economy";
import { buildExoticShopStock } from "#data/elite-redux/er-exotic-shop";
import { ModifierTier } from "#enums/modifier-tier";
import { BiomeShopPhase } from "#phases/biome-shop-phase";

export class ExoticShopPhase extends BiomeShopPhase {
  protected override coopMarketProjectionKind(): "exotic" {
    return "exotic";
  }

  protected override buildStock(): void {
    this.shopOptions = buildExoticShopStock();
    // Premium goods stock few copies each (rarer tier = scarcer).
    this.qtys = this.shopOptions.map(o => erBiomeStockCount(o.type.getOrInferTier() ?? ModifierTier.ROGUE));
  }
}
