import { VoucherType } from "#system/voucher";
import { EggGachaUiHandler } from "#ui/handlers/egg-gacha-ui-handler";
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
