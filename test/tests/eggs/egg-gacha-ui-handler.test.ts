import { VoucherType } from "#system/voucher";
import {
  cycleMultiplier,
  EggGachaUiHandler,
  MULTIPLIER_STEPS,
  resolveMaxMultiplier,
} from "#ui/handlers/egg-gacha-ui-handler";
import { describe, expect, it } from "vitest";

// Access the private static via cast for testing
// biome-ignore lint/suspicious/noExplicitAny: testing a private static method
const cursorToVoucher = (EggGachaUiHandler as any).cursorToVoucher as (
  cursor: number,
  multiplier?: number,
) => [VoucherType, number, number] | undefined;

describe("EggGachaUiHandler.cursorToVoucher", () => {
  it("default multiplier of 1 preserves legacy behavior", () => {
    expect(cursorToVoucher(0)).toEqual([VoucherType.REGULAR, 1, 1]);
    expect(cursorToVoucher(1)).toEqual([VoucherType.REGULAR, 10, 10]);
    expect(cursorToVoucher(4)).toEqual([VoucherType.GOLDEN, 1, 25]);
  });
  it("multiplier scales both vouchers consumed and pulls", () => {
    expect(cursorToVoucher(0, 5)).toEqual([VoucherType.REGULAR, 5, 5]);
    expect(cursorToVoucher(4, 100)).toEqual([VoucherType.GOLDEN, 100, 2500]);
    expect(cursorToVoucher(2, 10)).toEqual([VoucherType.PLUS, 10, 50]);
  });
  it("returns undefined for out-of-range cursor", () => {
    expect(cursorToVoucher(5)).toBeUndefined();
    expect(cursorToVoucher(-1)).toBeUndefined();
  });
});

describe("multiplier stepping", () => {
  it("MULTIPLIER_STEPS exposes the canonical sequence", () => {
    expect(MULTIPLIER_STEPS).toEqual([1, 5, 10, 25, 50, 100, "MAX"]);
  });
  it("cycleMultiplier(+1) advances; clamps at MAX", () => {
    expect(cycleMultiplier(1, +1)).toBe(5);
    expect(cycleMultiplier(100, +1)).toBe("MAX");
    expect(cycleMultiplier("MAX", +1)).toBe("MAX");
  });
  it("cycleMultiplier(-1) retreats; clamps at 1", () => {
    expect(cycleMultiplier(5, -1)).toBe(1);
    expect(cycleMultiplier(1, -1)).toBe(1);
    expect(cycleMultiplier("MAX", -1)).toBe(100);
  });
  it("resolveMaxMultiplier respects vouchers held and remaining cap", () => {
    // 200 GOLDEN vouchers held, 0 eggs already, cap 10000 → 25 pulls each → max 200 (vouchers)
    expect(
      resolveMaxMultiplier({ vouchersPerStep: 1, pullsPerStep: 25, vouchersHeld: 200, eggsHeld: 0, maxEggs: 10_000 }),
    ).toBe(200);
    // 5 eggs already, cap 10 → 5 slots / 5 pulls each → max 1
    expect(
      resolveMaxMultiplier({ vouchersPerStep: 1, pullsPerStep: 5, vouchersHeld: 99, eggsHeld: 5, maxEggs: 10 }),
    ).toBe(1);
    // No room → 0
    expect(
      resolveMaxMultiplier({ vouchersPerStep: 1, pullsPerStep: 1, vouchersHeld: 99, eggsHeld: 10, maxEggs: 10 }),
    ).toBe(0);
  });
});
