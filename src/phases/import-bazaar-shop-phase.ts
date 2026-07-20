/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #542 - The Import Bazaar shop phase. A BiomeShopPhase variant that swaps the
// every-10-wave biome stock for the curated ISLAND bazaar goods (er-import-shop).
// Everything else - the full-screen 4x4 shop UI, purchase / party-target / money
// plumbing, leave-confirm - is inherited unchanged.
//
// Launched from the Import Bazaar mystery encounter (unshiftNew), so the player
// browses a REAL paid shop like the Black Market / Exotic Trader, not a free
// reward screen.
// =============================================================================

import { erBiomeStockCount } from "#data/elite-redux/er-biome-economy";
import { buildImportShopStock } from "#data/elite-redux/er-import-shop";
import { ModifierTier } from "#enums/modifier-tier";
import { BiomeShopPhase } from "#phases/biome-shop-phase";

export class ImportBazaarShopPhase extends BiomeShopPhase {
  protected override coopMarketProjectionKind(): "import-bazaar" {
    return "import-bazaar";
  }

  protected override buildStock(): void {
    this.shopOptions = buildImportShopStock();
    // Bazaar goods are plentiful: stock per-tier counts like the biome shop.
    this.qtys = this.shopOptions.map(o => erBiomeStockCount(o.type.getOrInferTier() ?? ModifierTier.GREAT));
  }
}
