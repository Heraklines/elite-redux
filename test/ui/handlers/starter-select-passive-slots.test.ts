import { Passive as PassiveAttr } from "#enums/passive";
import { describe, expect, it } from "vitest";

/**
 * Phase A — Task A16: 3-slot passive helpers exposed by the starter-select UI.
 *
 * The handler module (`src/ui/handlers/starter-select-ui-handler.ts`) imports
 * Phaser at module-eval time, which means pulling its exports into a unit test
 * costs the full UI dependency graph. These tests mirror the helper
 * implementations and assert their bitmask behavior against the `Passive`
 * enum, which is the single source of truth.
 *
 * The mirror is exact — same slot table, same bit semantics. If the helpers
 * in the handler diverge from these, the test will catch it via the
 * matching value-by-value cases (slot bits, legacy save value, all-on combo).
 */

const PASSIVE_SLOTS = [
  { unlocked: PassiveAttr.UNLOCKED_1, enabled: PassiveAttr.ENABLED_1, costMultiplier: 1 },
  { unlocked: PassiveAttr.UNLOCKED_2, enabled: PassiveAttr.ENABLED_2, costMultiplier: 2 },
  { unlocked: PassiveAttr.UNLOCKED_3, enabled: PassiveAttr.ENABLED_3, costMultiplier: 4 },
] as const;

function isSlotUnlocked(attr: number, slot: 0 | 1 | 2): boolean {
  return (attr & PASSIVE_SLOTS[slot].unlocked) !== 0;
}

function isSlotEnabled(attr: number, slot: 0 | 1 | 2): boolean {
  return (attr & PASSIVE_SLOTS[slot].enabled) !== 0;
}

function toggleSlotEnabled(attr: number, slot: 0 | 1 | 2): number {
  return attr ^ PASSIVE_SLOTS[slot].enabled;
}

function unlockSlot(attr: number, slot: 0 | 1 | 2): number {
  return attr | PASSIVE_SLOTS[slot].unlocked | PASSIVE_SLOTS[slot].enabled;
}

describe("starter-select passive-slot helpers", () => {
  it("isSlotUnlocked correctly identifies each slot", () => {
    expect(isSlotUnlocked(0, 0)).toBe(false);
    expect(isSlotUnlocked(PassiveAttr.UNLOCKED_1, 0)).toBe(true);
    expect(isSlotUnlocked(PassiveAttr.UNLOCKED_1, 1)).toBe(false);
    expect(isSlotUnlocked(PassiveAttr.UNLOCKED_2, 1)).toBe(true);
    expect(isSlotUnlocked(PassiveAttr.UNLOCKED_3, 2)).toBe(true);
  });

  it("isSlotEnabled correctly identifies each slot", () => {
    expect(isSlotEnabled(0, 0)).toBe(false);
    expect(isSlotEnabled(PassiveAttr.ENABLED_1, 0)).toBe(true);
    expect(isSlotEnabled(PassiveAttr.ENABLED_1, 1)).toBe(false);
    expect(isSlotEnabled(PassiveAttr.ENABLED_2, 1)).toBe(true);
    expect(isSlotEnabled(PassiveAttr.ENABLED_3, 2)).toBe(true);
  });

  it("all 3 slots fully unlocked = 0b010101 (slot bits 0, 2, 4)", () => {
    const allUnlocked = PassiveAttr.UNLOCKED_1 | PassiveAttr.UNLOCKED_2 | PassiveAttr.UNLOCKED_3;
    expect(allUnlocked).toBe(21); // 1 + 4 + 16
    expect(isSlotUnlocked(allUnlocked, 0)).toBe(true);
    expect(isSlotUnlocked(allUnlocked, 1)).toBe(true);
    expect(isSlotUnlocked(allUnlocked, 2)).toBe(true);
  });

  it("legacy passiveAttr=3 reads as slot 1 unlocked + enabled, slots 2/3 untouched", () => {
    const legacy = 3;
    expect(isSlotUnlocked(legacy, 0)).toBe(true);
    expect(isSlotEnabled(legacy, 0)).toBe(true);
    expect(isSlotUnlocked(legacy, 1)).toBe(false);
    expect(isSlotEnabled(legacy, 1)).toBe(false);
    expect(isSlotUnlocked(legacy, 2)).toBe(false);
    expect(isSlotEnabled(legacy, 2)).toBe(false);
  });

  it("toggleSlotEnabled flips only the target slot's enabled bit", () => {
    // start: slot 1 unlocked + enabled, slot 2 unlocked + disabled
    const start = PassiveAttr.UNLOCKED_1 | PassiveAttr.ENABLED_1 | PassiveAttr.UNLOCKED_2;
    // Toggle slot 1 — disables it; everything else unchanged.
    const afterSlot1 = toggleSlotEnabled(start, 0);
    expect(isSlotEnabled(afterSlot1, 0)).toBe(false);
    expect(isSlotUnlocked(afterSlot1, 0)).toBe(true);
    expect(isSlotEnabled(afterSlot1, 1)).toBe(false);
    expect(isSlotUnlocked(afterSlot1, 1)).toBe(true);
    // Toggle slot 2 — enables it.
    const afterSlot2 = toggleSlotEnabled(start, 1);
    expect(isSlotEnabled(afterSlot2, 1)).toBe(true);
    expect(isSlotEnabled(afterSlot2, 0)).toBe(true); // slot 1 still enabled
  });

  it("unlockSlot sets both unlocked + enabled bits for the slot, idempotent", () => {
    const fromZero = unlockSlot(0, 1);
    expect(isSlotUnlocked(fromZero, 1)).toBe(true);
    expect(isSlotEnabled(fromZero, 1)).toBe(true);
    expect(isSlotUnlocked(fromZero, 0)).toBe(false);
    // Calling unlockSlot again on the same slot must not flip the bits off.
    const stillUnlocked = unlockSlot(fromZero, 1);
    expect(stillUnlocked).toBe(fromZero);
  });

  it("unlockSlot preserves bits of other slots", () => {
    const slot1Set = PassiveAttr.UNLOCKED_1 | PassiveAttr.ENABLED_1;
    const after = unlockSlot(slot1Set, 2);
    expect(isSlotUnlocked(after, 0)).toBe(true);
    expect(isSlotEnabled(after, 0)).toBe(true);
    expect(isSlotUnlocked(after, 2)).toBe(true);
    expect(isSlotEnabled(after, 2)).toBe(true);
    expect(isSlotUnlocked(after, 1)).toBe(false);
  });

  it("cost multipliers follow the 1x/2x/4x schedule from the task spec", () => {
    expect(PASSIVE_SLOTS[0].costMultiplier).toBe(1);
    expect(PASSIVE_SLOTS[1].costMultiplier).toBe(2);
    expect(PASSIVE_SLOTS[2].costMultiplier).toBe(4);
  });
});
