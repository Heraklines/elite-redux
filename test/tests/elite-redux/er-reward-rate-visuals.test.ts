import {
  formatErRewardRate,
  getErRewardRateGrade,
  getErRewardRateRowTooltip,
} from "#data/elite-redux/er-reward-rate-visuals";
import type { ErRewardRateBreakdown } from "#data/elite-redux/er-reward-rates";
import { describe, expect, it } from "vitest";

const rates: ErRewardRateBreakdown = {
  difficulty: "hell",
  equivalentWave: 200,
  tier: 10,
  baseShiny: 8,
  baseCandy: 11,
  baseVoucher: 11,
  favourMultiplier: 3,
  endlessBonus: 0,
  totalCap: 50,
  totalShiny: 24,
  totalCandy: 33,
  totalVoucher: 11,
};

describe("ER reward-rate panel visuals", () => {
  it("formats every supported fixed-column boundary", () => {
    expect([0, 1, 9, 10, 49, 50].map(formatErRewardRate)).toEqual(["—", "×1", "×9", "×10", "×49", "×50"]);
  });

  it("assigns the accessibility frame treatments at their exact thresholds", () => {
    expect([0, 1, 2, 3, 4, 6, 10, 15, 20, 30, 40, 50].map(value => getErRewardRateGrade(value).level)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  it("uses the authoritative breakdown and excludes Favour from vouchers", () => {
    expect(getErRewardRateRowTooltip("shiny", rates)).toEqual({
      title: "Shiny ×24",
      content: "Hell depth rate: ×8\nFavour: ×3\nEndless: +0\nTotal: ×24",
    });
    expect(getErRewardRateRowTooltip("voucher", rates)).toEqual({
      title: "Voucher ×11",
      content: "Hell depth rate: ×11\nFavour: not applied\nEndless: +0\nTotal: ×11",
    });
  });
});
