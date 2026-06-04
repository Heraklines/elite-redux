import { Passive } from "#enums/passive";
import { describe, expect, it } from "vitest";

describe("Passive bitmask (widened to 3 slots)", () => {
  it("legacy UNLOCKED/ENABLED map to slot 1 (back-compat for existing saves)", () => {
    expect(Passive.UNLOCKED).toBe(1);
    expect(Passive.ENABLED).toBe(2);
    expect(Passive.UNLOCKED).toBe(Passive.UNLOCKED_1);
    expect(Passive.ENABLED).toBe(Passive.ENABLED_1);
  });

  it("slots 2 and 3 use distinct, non-overlapping bits", () => {
    expect(Passive.UNLOCKED_2).toBe(4);
    expect(Passive.ENABLED_2).toBe(8);
    expect(Passive.UNLOCKED_3).toBe(16);
    expect(Passive.ENABLED_3).toBe(32);
  });

  it("all 6 slot bits are independent (no overlap)", () => {
    const bits = [
      Passive.UNLOCKED_1,
      Passive.ENABLED_1,
      Passive.UNLOCKED_2,
      Passive.ENABLED_2,
      Passive.UNLOCKED_3,
      Passive.ENABLED_3,
    ];
    // Each bit must be a power of 2, AND no two bits should share a bit.
    for (const b of bits) {
      expect(Number.isInteger(Math.log2(b))).toBe(true); // exact power of 2
    }
    const union = bits.reduce((a, b) => a | b, 0);
    const sum = bits.reduce((a, b) => a + b, 0);
    expect(union).toBe(sum); // sum === union iff no overlaps
  });

  it("bitwise combos work as expected (slot 1 unlocked + slot 2 unlocked)", () => {
    const flags = Passive.UNLOCKED_1 | Passive.UNLOCKED_2;
    expect(flags & Passive.UNLOCKED_1).toBeTruthy();
    expect(flags & Passive.UNLOCKED_2).toBeTruthy();
    expect(flags & Passive.UNLOCKED_3).toBeFalsy();
  });

  it("all 3 slots fully unlocked + enabled produces value 63", () => {
    const allOn =
      Passive.UNLOCKED_1
      | Passive.ENABLED_1
      | Passive.UNLOCKED_2
      | Passive.ENABLED_2
      | Passive.UNLOCKED_3
      | Passive.ENABLED_3;
    expect(allOn).toBe(63); // 0b111111
  });

  it("legacy save value (3 = UNLOCKED | ENABLED) reads as slot-1 unlocked + enabled", () => {
    // Existing saves stored `passiveAttr = 3` to mean "passive unlocked AND enabled".
    // Under the new layout, this should be interpreted as slot 1 unlocked + enabled.
    const legacy = 3;
    expect(legacy & Passive.UNLOCKED_1).toBeTruthy();
    expect(legacy & Passive.ENABLED_1).toBeTruthy();
    expect(legacy & Passive.UNLOCKED_2).toBeFalsy();
  });
});
