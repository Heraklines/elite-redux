/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Pure planner for the "mass unlock affordable innates" feature: cheapest-first,
// only locked slots with a real ability, bounded by candy.

import type { PassiveSlot } from "#utils/passive-utils";
import { isSlotUnlocked, planMassUnlock } from "#utils/passive-utils";
import { describe, expect, it } from "vitest";

describe("planMassUnlock", () => {
  const cost = (slot: PassiveSlot) => [10, 20, 40][slot]; // cheapest = slot 0
  const allHaveAbility = () => true;

  it("buys every slot when candy is plentiful", () => {
    const plan = planMassUnlock(0, 1000, cost, allHaveAbility);
    expect(plan.unlocked).toBe(3);
    expect(plan.candySpent).toBe(70);
    expect(isSlotUnlocked(plan.passiveAttr, 0)).toBe(true);
    expect(isSlotUnlocked(plan.passiveAttr, 1)).toBe(true);
    expect(isSlotUnlocked(plan.passiveAttr, 2)).toBe(true);
  });

  it("buys cheapest-first and stops when candy runs out", () => {
    // 25 candy: buys slot0 (10) + slot1 (20)? 10+20=30 > 25 -> only slot0 (10),
    // then slot1 (20) costs 20 > 15 left -> no; slot2 (40) no. So 1 unlock.
    const plan = planMassUnlock(0, 25, cost, allHaveAbility);
    expect(plan.unlocked).toBe(1);
    expect(plan.candySpent).toBe(10);
    expect(isSlotUnlocked(plan.passiveAttr, 0)).toBe(true);
    expect(isSlotUnlocked(plan.passiveAttr, 1)).toBe(false);
  });

  it("skips already-unlocked slots and NONE-ability slots", () => {
    // slot 0 already unlocked; slot 2 has no ability -> only slot 1 is a candidate.
    const startAttr = (() => {
      // unlock slot 0 only
      const r = planMassUnlock(0, 10, cost, s => s === 0);
      return r.passiveAttr;
    })();
    const hasAbility = (s: PassiveSlot) => s !== 2; // slot 2 = no innate
    const plan = planMassUnlock(startAttr, 1000, cost, hasAbility);
    expect(plan.unlocked).toBe(1); // only slot 1
    expect(plan.candySpent).toBe(20);
    expect(isSlotUnlocked(plan.passiveAttr, 1)).toBe(true);
    expect(isSlotUnlocked(plan.passiveAttr, 2)).toBe(false);
  });

  it("is a no-op when nothing is affordable", () => {
    const plan = planMassUnlock(0, 5, cost, allHaveAbility);
    expect(plan.unlocked).toBe(0);
    expect(plan.candySpent).toBe(0);
    expect(plan.passiveAttr).toBe(0);
  });
});
