import type { AutoEggRestockSettings } from "#system/auto-egg-restock-settings";
import { VoucherType } from "#system/voucher";

/** Pull count produced per voucher type, mirroring the gacha row defaults. */
const PULLS_PER_VOUCHER: Record<VoucherType, number> = {
  [VoucherType.REGULAR]: 1,
  [VoucherType.PLUS]: 5,
  [VoucherType.PREMIUM]: 10,
  [VoucherType.GOLDEN]: 25,
};

/**
 * Voucher spend priority for auto-restock: cheapest first, so the player keeps
 * their high-tier vouchers for manual spending unless they explicitly opt in.
 */
const VOUCHER_PRIORITY: VoucherType[] = [
  VoucherType.REGULAR,
  VoucherType.PLUS,
  VoucherType.PREMIUM,
  VoucherType.GOLDEN,
];

export interface AutoRestockInput {
  settings: AutoEggRestockSettings;
  eggsHeld: number;
  voucherCounts: Record<VoucherType, number>;
  maxEggs: number;
}

export interface AutoRestockPurchase {
  voucherType: VoucherType;
  vouchers: number;
  pulls: number;
}

export interface AutoRestockPlan {
  purchases: AutoRestockPurchase[];
  eggsAfter: number;
}

/**
 * Pure planner: decides which vouchers to spend to top off the egg queue.
 *
 * Stops before either overshooting the player's target or the hard egg cap.
 * Each `voucherCounts` entry is treated as the number of vouchers held; the
 * plan records aggregated purchases per voucher type rather than per voucher.
 */
export function planAutoRestock(input: AutoRestockInput): AutoRestockPlan {
  const { settings, eggsHeld, voucherCounts, maxEggs } = input;
  const purchases: AutoRestockPurchase[] = [];
  let eggs = eggsHeld;

  if (!settings.enabled) {
    return { purchases, eggsAfter: eggs };
  }
  const target = Math.min(settings.targetCount, maxEggs);
  if (eggs >= target) {
    return { purchases, eggsAfter: eggs };
  }

  const remainingVouchers = { ...voucherCounts };
  for (const v of VOUCHER_PRIORITY) {
    if (!settings.perVoucher[v]) {
      continue;
    }
    while (eggs < target && remainingVouchers[v] > 0) {
      const pulls = PULLS_PER_VOUCHER[v];
      // Don't overshoot the user's chosen target or the hard cap.
      if (eggs + pulls > target) {
        break;
      }
      if (eggs + pulls > maxEggs) {
        break;
      }
      eggs += pulls;
      remainingVouchers[v] -= 1;
      const last = purchases.at(-1);
      if (last && last.voucherType === v) {
        last.vouchers += 1;
        last.pulls += pulls;
      } else {
        purchases.push({ voucherType: v, vouchers: 1, pulls });
      }
    }
  }
  return { purchases, eggsAfter: eggs };
}
