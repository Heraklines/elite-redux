import { planAutoRestock } from "#system/auto-egg-restock";
import { defaultAutoEggRestockSettings } from "#system/auto-egg-restock-settings";
import { VoucherType } from "#system/voucher";
import { describe, expect, it } from "vitest";

const baseSettings = (overrides: Record<string, unknown> = {}) => ({
  ...defaultAutoEggRestockSettings(),
  enabled: true,
  ...overrides,
});

describe("planAutoRestock", () => {
  it("disabled → no plan", () => {
    const plan = planAutoRestock({
      settings: { ...defaultAutoEggRestockSettings() },
      eggsHeld: 0,
      voucherCounts: {
        [VoucherType.REGULAR]: 100,
        [VoucherType.PLUS]: 0,
        [VoucherType.PREMIUM]: 0,
        [VoucherType.GOLDEN]: 0,
      },
      maxEggs: 10_000,
    });
    expect(plan.purchases).toEqual([]);
  });

  it("eggs already at target → no plan", () => {
    const plan = planAutoRestock({
      settings: baseSettings({ targetCount: 50 }),
      eggsHeld: 50,
      voucherCounts: {
        [VoucherType.REGULAR]: 100,
        [VoucherType.PLUS]: 0,
        [VoucherType.PREMIUM]: 0,
        [VoucherType.GOLDEN]: 0,
      },
      maxEggs: 10_000,
    });
    expect(plan.purchases).toEqual([]);
  });

  it("spends cheapest enabled voucher first; stops at target", () => {
    // target=10, eggsHeld=0 → need 10 pulls. Regular gives 1 pull each. Should buy 10 REGULAR.
    const plan = planAutoRestock({
      settings: baseSettings({ targetCount: 10 }),
      eggsHeld: 0,
      voucherCounts: {
        [VoucherType.REGULAR]: 100,
        [VoucherType.PLUS]: 100,
        [VoucherType.PREMIUM]: 100,
        [VoucherType.GOLDEN]: 100,
      },
      maxEggs: 10_000,
    });
    expect(plan.purchases).toEqual([{ voucherType: VoucherType.REGULAR, vouchers: 10, pulls: 10 }]);
  });

  it("rolls over to next-cheapest when one drains", () => {
    // 3 REGULAR (=3 pulls), then PLUS @ 5 pulls each. Target 10.
    // 3 REGULAR → 3 pulls. 1 PLUS → 8 total. 1 more PLUS → 13 (overshoots target). Behavior: stop before overshooting.
    const plan = planAutoRestock({
      settings: baseSettings({ targetCount: 10 }),
      eggsHeld: 0,
      voucherCounts: {
        [VoucherType.REGULAR]: 3,
        [VoucherType.PLUS]: 5,
        [VoucherType.PREMIUM]: 0,
        [VoucherType.GOLDEN]: 0,
      },
      maxEggs: 10_000,
    });
    expect(plan.purchases).toEqual([
      { voucherType: VoucherType.REGULAR, vouchers: 3, pulls: 3 },
      { voucherType: VoucherType.PLUS, vouchers: 1, pulls: 5 },
    ]);
    expect(plan.eggsAfter).toBe(8);
  });

  it("skips disabled voucher type", () => {
    const settings = baseSettings({ targetCount: 50 });
    settings.perVoucher[VoucherType.REGULAR] = false;
    const plan = planAutoRestock({
      settings,
      eggsHeld: 0,
      voucherCounts: {
        [VoucherType.REGULAR]: 999,
        [VoucherType.PLUS]: 1,
        [VoucherType.PREMIUM]: 0,
        [VoucherType.GOLDEN]: 0,
      },
      maxEggs: 10_000,
    });
    expect(plan.purchases).toEqual([{ voucherType: VoucherType.PLUS, vouchers: 1, pulls: 5 }]);
  });

  it("respects maxEggs cap", () => {
    const plan = planAutoRestock({
      settings: baseSettings({ targetCount: 100 }),
      eggsHeld: 95,
      voucherCounts: {
        [VoucherType.REGULAR]: 999,
        [VoucherType.PLUS]: 0,
        [VoucherType.PREMIUM]: 0,
        [VoucherType.GOLDEN]: 0,
      },
      maxEggs: 100,
    });
    expect(plan.purchases).toEqual([{ voucherType: VoucherType.REGULAR, vouchers: 5, pulls: 5 }]);
  });
});
