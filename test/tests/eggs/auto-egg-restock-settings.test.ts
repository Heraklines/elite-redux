import { GachaType } from "#enums/gacha-types";
import { defaultAutoEggRestockSettings, mergeAutoEggRestockSettings } from "#system/auto-egg-restock-settings";
import { VoucherType } from "#system/voucher";
import { describe, expect, it } from "vitest";

describe("AutoEggRestockSettings", () => {
  it("default settings are opt-in and conservative", () => {
    const d = defaultAutoEggRestockSettings();
    expect(d.enabled).toBe(false);
    expect(d.targetCount).toBe(50);
    expect(d.gachaType).toBe(GachaType.LEGENDARY);
    expect(d.perVoucher[VoucherType.REGULAR]).toBe(true);
    expect(d.perVoucher[VoucherType.PLUS]).toBe(true);
    expect(d.perVoucher[VoucherType.PREMIUM]).toBe(true);
    expect(d.perVoucher[VoucherType.GOLDEN]).toBe(false);
  });
  it("merge fills missing fields from defaults", () => {
    const merged = mergeAutoEggRestockSettings({ enabled: true });
    expect(merged.enabled).toBe(true);
    expect(merged.targetCount).toBe(50);
    expect(merged.perVoucher[VoucherType.GOLDEN]).toBe(false);
  });
  it("merge clamps targetCount to [0, 10000]", () => {
    expect(mergeAutoEggRestockSettings({ targetCount: -5 }).targetCount).toBe(0);
    expect(mergeAutoEggRestockSettings({ targetCount: 99_999 }).targetCount).toBe(10_000);
  });
});
