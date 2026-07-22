/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// STRENGTH-TIERED mega/primal stone rarity (er-mega-tiers). Asserts:
//   - box legendaries / primal orbs / "-Z" ultra megas resolve MASTER;
//   - a plain low-BST mega resolves well below MASTER;
//   - the per-tier gen weights are strictly ordered (rarer = lower);
//   - the weighted pick biases HARD toward the common tier (a MASTER stone
//     almost never wins against a lower-tier one), yet keeps weight >= 1 so it
//     stays reachable;
//   - the biome-shop price factor for a MASTER stone dwarfs a COMMON one.
//
// Gated ER_SCENARIO=1 (needs the ER form-change registry + injected form stats).
// Run: ER_SCENARIO=1 npx vitest run test/tests/elite-redux/er-mega-tiers.test.ts
// =============================================================================

import { ER_SHOP_ITEM_TIER_FACTOR } from "#data/elite-redux/er-biome-economy";
import {
  erMegaStoneGenWeight,
  erMegaStoneTier,
  pickErMegaStoneWeighted,
  resetErMegaTierCache,
  TIER_GEN_WEIGHT,
} from "#data/elite-redux/er-mega-tiers";
import { FormChangeItem } from "#enums/form-change-item";
import { ModifierTier } from "#enums/modifier-tier";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER mega stone strength tiers (#mega-rarity)", () => {
  let phaserGame: Phaser.Game;
  // biome-ignore lint/correctness/noUnusedVariables: side-effectful full init
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
    resetErMegaTierCache();
  });

  it("box legendaries / primal orbs / ultra megas are MASTER-tier", () => {
    for (const stone of [
      FormChangeItem.XERNEASITE,
      FormChangeItem.YVELTALITE,
      FormChangeItem.RED_ORB,
      FormChangeItem.LUSTROUS_ORB,
      FormChangeItem.CHARIZARDITE_Z,
    ]) {
      expect(erMegaStoneTier(stone)).toBe(ModifierTier.MASTER);
    }
  });

  it("kit-monster megas are ROGUE, a plain mega is well below MASTER", () => {
    expect(erMegaStoneTier(FormChangeItem.KANGASKHANITE)).toBe(ModifierTier.ROGUE);
    expect(erMegaStoneTier(FormChangeItem.GENGARITE)).toBe(ModifierTier.ROGUE);
    // Snorlax's plain mega is a mid-BST bruiser, nowhere near the elite class.
    expect(erMegaStoneTier(FormChangeItem.SNORLAXITE)).toBeLessThan(ModifierTier.MASTER);
    expect(erMegaStoneTier(FormChangeItem.VENUSAURITE)).toBeLessThan(ModifierTier.MASTER);
  });

  it("gen weights are strictly ordered (rarer tier weighs far less)", () => {
    expect(TIER_GEN_WEIGHT[ModifierTier.COMMON]).toBeGreaterThan(TIER_GEN_WEIGHT[ModifierTier.GREAT]);
    expect(TIER_GEN_WEIGHT[ModifierTier.GREAT]).toBeGreaterThan(TIER_GEN_WEIGHT[ModifierTier.ULTRA]);
    expect(TIER_GEN_WEIGHT[ModifierTier.ULTRA]).toBeGreaterThan(TIER_GEN_WEIGHT[ModifierTier.ROGUE]);
    expect(TIER_GEN_WEIGHT[ModifierTier.ROGUE]).toBeGreaterThan(TIER_GEN_WEIGHT[ModifierTier.MASTER]);
    // Never zero: every stone stays reachable.
    expect(erMegaStoneGenWeight(FormChangeItem.XERNEASITE)).toBeGreaterThanOrEqual(1);
  });

  it("the weighted pick biases hard toward the lower tier", () => {
    // MASTER (weight 1) vs ROGUE (weight 4): the ROGUE stone should win ~4x more.
    const pool = [FormChangeItem.XERNEASITE, FormChangeItem.GENGARITE];
    let xerneas = 0;
    let gengar = 0;
    for (let i = 0; i < 600; i++) {
      if (pickErMegaStoneWeighted(pool) === FormChangeItem.XERNEASITE) {
        xerneas++;
      } else {
        gengar++;
      }
    }
    expect(gengar).toBeGreaterThan(xerneas * 2); // decisively favored, well clear of 1:1
  });

  it("a single eligible stone is always returned (mono-mega party stays reachable)", () => {
    expect(pickErMegaStoneWeighted([FormChangeItem.XERNEASITE])).toBe(FormChangeItem.XERNEASITE);
  });

  it("biome-shop price factor scales with the stone's strength tier", () => {
    const masterFactor = ER_SHOP_ITEM_TIER_FACTOR[erMegaStoneTier(FormChangeItem.XERNEASITE)];
    const commonFactor = ER_SHOP_ITEM_TIER_FACTOR[erMegaStoneTier(FormChangeItem.SNORLAXITE)];
    expect(masterFactor).toBeGreaterThan(commonFactor);
  });
});
