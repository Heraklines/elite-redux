import { modifierTypes } from "#data/data-lists";
import { ExtraModifierModifier } from "#modifiers/modifier";
import { NumberHolder } from "#utils/common";
import { describe, expect, it } from "vitest";

// ER reward ball: Greater Golden Ball = the Golden Poke Ball's +1 reward-option
// mechanism (ExtraModifierModifier), but +2. Verifies it seeds at stack 2 and
// feeds the reward-option counter that SelectModifierPhase.getModifierCount reads.
describe("ER Greater Golden Ball", () => {
  it("is an ExtraModifierModifier seeded at stack 2", () => {
    const mod = modifierTypes.ER_GREATER_GOLDEN_BALL().newModifier();
    expect(mod).toBeInstanceOf(ExtraModifierModifier);
    expect((mod as ExtraModifierModifier).getStackCount()).toBe(2);
  });

  it("adds +2 to the reward-option count", () => {
    const mod = modifierTypes.ER_GREATER_GOLDEN_BALL().newModifier() as ExtraModifierModifier;
    const count = new NumberHolder(3); // SelectModifierPhase.getModifierCount() base
    mod.apply(count);
    expect(count.value).toBe(5);
  });
});
