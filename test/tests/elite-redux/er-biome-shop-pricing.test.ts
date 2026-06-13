/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #440 - Biome Market pricing/stock differentiation (PURE, no game harness).
//
// Regression guard for the bug where the shop hook never set each item's id, so
// getOrInferTier() returned null and EVERY item collapsed to one flat price +
// one stock count (all balls same price, Focus Band == Quick Claw, uniform
// stock). These tests pin the tier-resolution logic + the monotonic price/stock
// factor tables that make a Rogue item cost more (and stock fewer) than a Common
// one. They don't boot a battle, so they run in normal CI.
// =============================================================================

import {
  ER_SHOP_CATEGORY_DEFAULT_TIER,
  ER_SHOP_EXPLICIT_ITEM_TIER,
  ER_SHOP_ITEM_TIER_FACTOR,
  ER_SHOP_STOCK_BY_TIER,
  erBiomeShopResolveTier,
  erBiomeStockCount,
} from "#data/elite-redux/er-biome-economy";
import { ModifierTier } from "#enums/modifier-tier";
import { describe, expect, it } from "vitest";

describe("ER Biome Market pricing + stock by rarity tier (#440)", () => {
  it("the four balls resolve to escalating tiers (Poke < Great < Ultra < Rogue)", () => {
    // Balls are NOT in the random reward pool, so they rely on the explicit
    // staple map - the part getOrInferTier can never supply.
    expect(ER_SHOP_EXPLICIT_ITEM_TIER.POKEBALL).toBe(ModifierTier.COMMON);
    expect(ER_SHOP_EXPLICIT_ITEM_TIER.GREAT_BALL).toBe(ModifierTier.GREAT);
    expect(ER_SHOP_EXPLICIT_ITEM_TIER.ULTRA_BALL).toBe(ModifierTier.ULTRA);
    expect(ER_SHOP_EXPLICIT_ITEM_TIER.ROGUE_BALL).toBe(ModifierTier.ROGUE);
    // And the price factor must strictly increase across that sequence.
    expect(ER_SHOP_ITEM_TIER_FACTOR[ModifierTier.COMMON]).toBeLessThan(ER_SHOP_ITEM_TIER_FACTOR[ModifierTier.GREAT]);
    expect(ER_SHOP_ITEM_TIER_FACTOR[ModifierTier.GREAT]).toBeLessThan(ER_SHOP_ITEM_TIER_FACTOR[ModifierTier.ULTRA]);
    expect(ER_SHOP_ITEM_TIER_FACTOR[ModifierTier.ULTRA]).toBeLessThan(ER_SHOP_ITEM_TIER_FACTOR[ModifierTier.ROGUE]);
  });

  it("erBiomeShopResolveTier: explicit map wins, then inferred tier, then category default", () => {
    // 1. Explicit staple map takes priority even if a (wrong) tier is inferred.
    expect(erBiomeShopResolveTier("POKEBALL", ModifierTier.MASTER, "BALLS")).toBe(ModifierTier.COMMON);
    // 2. No explicit entry -> use the reward-pool inferred tier (the Focus Band
    //    (ROGUE) vs Quick Claw (ULTRA) case the user reported as identical).
    expect(erBiomeShopResolveTier("FOCUS_BAND", ModifierTier.ROGUE, "HELD")).toBe(ModifierTier.ROGUE);
    expect(erBiomeShopResolveTier("QUICK_CLAW", ModifierTier.ULTRA, "HELD")).toBe(ModifierTier.ULTRA);
    // 3. Neither explicit nor inferable -> the category default, never null.
    expect(erBiomeShopResolveTier("SOME_UNPOOLED_KEY" as never, null, "HELD")).toBe(ER_SHOP_CATEGORY_DEFAULT_TIER.HELD);
    expect(erBiomeShopResolveTier("SOME_UNPOOLED_KEY" as never, null, "TM")).toBe(ER_SHOP_CATEGORY_DEFAULT_TIER.TM);
  });

  it("stock counts decrease with rarity and are not uniform", () => {
    expect(ER_SHOP_STOCK_BY_TIER[ModifierTier.COMMON]).toBeGreaterThan(ER_SHOP_STOCK_BY_TIER[ModifierTier.GREAT]);
    expect(ER_SHOP_STOCK_BY_TIER[ModifierTier.GREAT]).toBeGreaterThan(ER_SHOP_STOCK_BY_TIER[ModifierTier.ULTRA]);
    expect(ER_SHOP_STOCK_BY_TIER[ModifierTier.ULTRA]).toBeGreaterThan(ER_SHOP_STOCK_BY_TIER[ModifierTier.ROGUE]);
    // A mixed shop yields more than one distinct stock count.
    const counts = [ModifierTier.COMMON, ModifierTier.GREAT, ModifierTier.ULTRA, ModifierTier.ROGUE].map(t =>
      erBiomeStockCount(t),
    );
    expect(new Set(counts).size).toBeGreaterThan(1);
  });
});
