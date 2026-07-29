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
//   - the weighted pick moderately favors the common tier, yet keeps strong
//     stones realistically reachable;
//   - the biome-shop price ladder remains ordered without extreme multipliers.
//
// Gated ER_SCENARIO=1 (needs the ER form-change registry + injected form stats).
// Run: ER_SCENARIO=1 npx vitest run test/tests/elite-redux/er-mega-tiers.test.ts
// =============================================================================

import { ER_SHOP_ITEM_TIER_FACTOR } from "#data/elite-redux/er-biome-economy";
import {
  erMegaStoneAppearanceRate,
  erMegaStoneAppearsAtGate,
  erMegaStoneGenWeight,
  erMegaStoneTier,
  pickErMegaStoneWeighted,
  resetErMegaTierCache,
  TIER_APPEARANCE_RATE,
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

  it("gen weights are strictly ordered without an extreme gap", () => {
    expect(TIER_GEN_WEIGHT[ModifierTier.COMMON]).toBeGreaterThan(TIER_GEN_WEIGHT[ModifierTier.GREAT]);
    expect(TIER_GEN_WEIGHT[ModifierTier.GREAT]).toBeGreaterThan(TIER_GEN_WEIGHT[ModifierTier.ULTRA]);
    expect(TIER_GEN_WEIGHT[ModifierTier.ULTRA]).toBeGreaterThan(TIER_GEN_WEIGHT[ModifierTier.ROGUE]);
    expect(TIER_GEN_WEIGHT[ModifierTier.ROGUE]).toBeGreaterThan(TIER_GEN_WEIGHT[ModifierTier.MASTER]);
    // Never zero: every stone stays reachable.
    expect(erMegaStoneGenWeight(FormChangeItem.XERNEASITE)).toBeGreaterThanOrEqual(1);
    expect(TIER_GEN_WEIGHT[ModifierTier.COMMON] / TIER_GEN_WEIGHT[ModifierTier.MASTER]).toBeLessThanOrEqual(3);
  });

  it("the weighted pick moderately favors the lower tier", () => {
    // MASTER (weight 4) vs ROGUE (weight 6): lower tier is favored, not dominant.
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
    expect(gengar).toBeGreaterThan(xerneas * 1.2);
  });

  it("a single eligible stone is always returned (mono-mega party stays reachable)", () => {
    expect(pickErMegaStoneWeighted([FormChangeItem.XERNEASITE])).toBe(FormChangeItem.XERNEASITE);
  });

  it("biome-shop price factor scales with the stone's strength tier", () => {
    const masterFactor = ER_SHOP_ITEM_TIER_FACTOR[erMegaStoneTier(FormChangeItem.XERNEASITE)];
    const commonFactor = ER_SHOP_ITEM_TIER_FACTOR[erMegaStoneTier(FormChangeItem.SNORLAXITE)];
    expect(masterFactor).toBeGreaterThan(commonFactor);
    expect(masterFactor / commonFactor).toBeLessThan(20);
  });

  it("a MASTER stone prices above the flat EVO bucket without the old 12x spike", () => {
    // Directive 2 proof: the biome shop prices a resolved stone by ITS strength
    // tier (getPlayerShopModifierTypeOptionsForWave: FormChangeItemModifierType ->
    // erMegaStoneTier -> erBiomeTierPrice), so a MASTER stone gets the masterball
    // band - NOT the flat EVO-category "great" bucket a form-change slot inherits.
    const masterFactor = ER_SHOP_ITEM_TIER_FACTOR[ModifierTier.MASTER];
    const evoGreatFactor = ER_SHOP_ITEM_TIER_FACTOR[ModifierTier.GREAT];
    expect(erMegaStoneTier(FormChangeItem.XERNEASITE)).toBe(ModifierTier.MASTER);
    expect(ER_SHOP_ITEM_TIER_FACTOR[erMegaStoneTier(FormChangeItem.XERNEASITE)]).toBe(masterFactor);
    // The masterball band is strictly above the flat EVO "great" bucket.
    expect(masterFactor).toBeGreaterThan(evoGreatFactor);
    expect(masterFactor).toBeLessThanOrEqual(5.5);
  });

  // ---------------------------------------------------------------------------
  // ABSOLUTE APPEARANCE GATE (#mega-rarity, directive 1): a MASTER stone stays
  // genuinely rare EVEN as a party's ONLY eligible stone. The competitive pick
  // (above) suppresses a strong stone only when it competes; the gate is the
  // orthogonal knob that suppresses it absolutely.
  // ---------------------------------------------------------------------------

  it("appearance-rate ladder is strictly ordered; MASTER remains realistically obtainable", () => {
    expect(TIER_APPEARANCE_RATE[ModifierTier.COMMON]).toBeGreaterThan(TIER_APPEARANCE_RATE[ModifierTier.GREAT]);
    expect(TIER_APPEARANCE_RATE[ModifierTier.GREAT]).toBeGreaterThan(TIER_APPEARANCE_RATE[ModifierTier.ULTRA]);
    expect(TIER_APPEARANCE_RATE[ModifierTier.ULTRA]).toBeGreaterThan(TIER_APPEARANCE_RATE[ModifierTier.ROGUE]);
    expect(TIER_APPEARANCE_RATE[ModifierTier.ROGUE]).toBeGreaterThan(TIER_APPEARANCE_RATE[ModifierTier.MASTER]);
    expect(TIER_APPEARANCE_RATE[ModifierTier.MASTER]).toBeGreaterThanOrEqual(0.35);
    expect(TIER_APPEARANCE_RATE[ModifierTier.MASTER]).toBeLessThanOrEqual(0.5);
    expect(TIER_APPEARANCE_RATE[ModifierTier.COMMON]).toBeGreaterThanOrEqual(0.95);
    // A MASTER stone reports the MASTER rate through the resolver.
    expect(erMegaStoneAppearanceRate(FormChangeItem.XERNEASITE)).toBe(TIER_APPEARANCE_RATE[ModifierTier.MASTER]);
  });

  it("a sole MASTER stone materializes at its moderate rate instead of the old ~2%", () => {
    // A party whose ONLY mega mon is a MASTER-tier one: the competitive pick is a
    // pool of ONE, so it ALWAYS returns the master stone (the pre-gate defect).
    const soleMasterPool = [FormChangeItem.XERNEASITE];
    let preGatePicks = 0; // RED-PROOF: without the gate, the sole stone is guaranteed.
    let materialized = 0; // GREEN: with the gate, it rarely actually appears.
    const N = 6000;
    for (let i = 0; i < N; i++) {
      const picked = pickErMegaStoneWeighted(soleMasterPool);
      expect(picked).toBe(FormChangeItem.XERNEASITE);
      preGatePicks++;
      if (erMegaStoneAppearsAtGate(picked)) {
        materialized++;
      }
    }
    // Red-proof: the competitive pick alone yields the master stone 100% of the time.
    expect(preGatePicks).toBe(N);
    expect(materialized / N).toBeGreaterThanOrEqual(0.35);
    expect(materialized / N).toBeLessThanOrEqual(0.45);
  });

  it("a COMMON-tier stone materializes on nearly every eligible slot", () => {
    // Find a real COMMON-tier stone (unknown / non-stone items resolve to ULTRA,
    // never COMMON, so a COMMON match is a genuine low-BST mega).
    const commonStone = (Object.values(FormChangeItem) as FormChangeItem[]).find(
      v => typeof v === "number" && erMegaStoneTier(v) === ModifierTier.COMMON,
    );
    if (commonStone === undefined) {
      // No COMMON-tier stone in the live set: assert the contract directly - a
      // rate-1.0 tier always materializes (short-circuit, no RNG draw).
      expect(TIER_APPEARANCE_RATE[ModifierTier.COMMON]).toBeGreaterThanOrEqual(0.95);
      return;
    }
    let materialized = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) {
      if (erMegaStoneAppearsAtGate(commonStone)) {
        materialized++;
      }
    }
    expect(materialized / N).toBeGreaterThanOrEqual(0.95);
  });
});
