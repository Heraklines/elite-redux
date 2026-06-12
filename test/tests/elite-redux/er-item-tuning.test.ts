/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Editor-managed item tuning (er-item-tuning.json → player reward pool tier /
// weight / ER-community stack caps). Tests inject tuning tables directly
// (applyErItemTuning) and assert the live pool changes, absence = unchanged.
// Run: ER_SCENARIO=1 npx vitest run test/tests/elite-redux/er-item-tuning.test.ts
import { ER_COMMUNITY_ITEM_CONFIG } from "#data/elite-redux/er-community-items";
import { applyErItemTuning } from "#data/elite-redux/init-elite-redux-item-tuning";
import { ModifierTier } from "#enums/modifier-tier";
import { modifierPool } from "#modifiers/modifier-pools";
import type { WeightedModifierType } from "#modifiers/modifier-type";
import { afterEach, describe, expect, it } from "vitest";

function findEntry(itemKey: string): { entry: WeightedModifierType; tier: ModifierTier } | undefined {
  for (const tier of [
    ModifierTier.COMMON,
    ModifierTier.GREAT,
    ModifierTier.ULTRA,
    ModifierTier.ROGUE,
    ModifierTier.MASTER,
  ]) {
    for (const entry of modifierPool[tier] ?? []) {
      if (entry.modifierType.id === itemKey) {
        return { entry, tier };
      }
    }
  }
  return;
}

describe("ER item tuning (er-item-tuning.json loader)", () => {
  const originalMaxStack = ER_COMMUNITY_ITEM_CONFIG.loadedDice.maxStack;

  afterEach(() => {
    // Restore Loaded Dice to its shipped state (ULTRA, weight 4, stack 3).
    const found = findEntry("ER_LOADED_DICE");
    if (found && found.tier !== ModifierTier.ULTRA) {
      modifierPool[found.tier].splice(modifierPool[found.tier].indexOf(found.entry), 1);
      modifierPool[ModifierTier.ULTRA].push(found.entry);
      found.entry.setTier(ModifierTier.ULTRA);
    }
    const restored = findEntry("ER_LOADED_DICE");
    if (restored) {
      restored.entry.weight = 4;
      restored.entry.maxWeight = 4;
    }
    (ER_COMMUNITY_ITEM_CONFIG as Record<string, { maxStack: number }>).loadedDice.maxStack = originalMaxStack;
  });

  it("replaces an item's weight in place", () => {
    const before = findEntry("ER_LOADED_DICE");
    expect(before).toBeDefined();
    const result = applyErItemTuning({ ER_LOADED_DICE: { weight: 9 } });
    expect(result.weightsApplied).toBe(1);
    const after = findEntry("ER_LOADED_DICE");
    expect(after?.entry.weight).toBe(9);
    expect(after?.entry.maxWeight).toBe(9);
    expect(after?.tier).toBe(before?.tier);
  });

  it("moves an item between reward tiers by name", () => {
    const result = applyErItemTuning({ ER_LOADED_DICE: { tier: "ROGUE" } });
    expect(result.tiersMoved).toBe(1);
    const after = findEntry("ER_LOADED_DICE");
    expect(after?.tier).toBe(ModifierTier.ROGUE);
    expect(modifierPool[ModifierTier.ULTRA].some(e => e.modifierType.id === "ER_LOADED_DICE")).toBe(false);
  });

  it("updates an ER community item's stack cap", () => {
    const result = applyErItemTuning({ ER_LOADED_DICE: { maxStack: 2 } });
    expect(result.maxStacksApplied).toBe(1);
    expect(ER_COMMUNITY_ITEM_CONFIG.loadedDice.maxStack).toBe(2);
  });

  it("absent items keep their current pool state", () => {
    const before = findEntry("ER_OMNI_GEM");
    expect(before).toBeDefined();
    const weightBefore = before?.entry.weight;
    const result = applyErItemTuning({ ER_LOADED_DICE: { weight: 5 } });
    expect(result.skipped).toBe(0);
    const after = findEntry("ER_OMNI_GEM");
    expect(after?.tier).toBe(before?.tier);
    expect(after?.entry.weight).toBe(weightBefore);
  });

  it("unknown item keys are counted, not applied", () => {
    const result = applyErItemTuning({ NOT_A_REAL_ITEM_XYZ: { weight: 5 } });
    expect(result.skipped).toBe(1);
    expect(result.weightsApplied).toBe(0);
  });
});
