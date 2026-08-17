import {
  type ErRewardRateContext,
  getErIntegerFavourMultiplier,
  getErRewardTier,
  resolveErRewardRates,
} from "#data/elite-redux/er-reward-rates";
import type { ErDifficulty } from "#data/elite-redux/er-run-difficulty";
import type { ErRunPacing } from "#data/elite-redux/er-run-pacing";
import { describe, expect, it } from "vitest";

const difficulties: readonly ErDifficulty[] = ["youngster", "ace", "elite", "hell"];
const pacingModes: readonly ErRunPacing[] = ["normal", "sprint"];

function context(overrides: Partial<ErRewardRateContext> = {}): ErRewardRateContext {
  return {
    difficulty: "hell",
    pacing: "normal",
    runWave: 1,
    favourPoints: 0,
    favourCap: 3,
    endlessActive: false,
    endlessEquivalentDepth: 0,
    ...overrides,
  };
}

describe("ER integer depth reward rates", () => {
  it("maps Normal and Sprint waves through the same ten equivalent-depth tiers", () => {
    for (let tier = 1; tier <= 10; tier++) {
      expect(getErRewardTier((tier - 1) * 20 + 1, "normal")).toBe(tier);
      expect(getErRewardTier((tier - 1) * 10 + 1, "sprint")).toBe(tier);
    }
    expect(getErRewardTier(9999, "normal")).toBe(10);
    expect(getErRewardTier(9999, "sprint")).toBe(10);
  });

  it("uses the nearest integer Favour progression and respects both caps", () => {
    expect([0, 4, 5, 14, 15, 24, 25, 34, 35].map(value => getErIntegerFavourMultiplier(value, 5))).toEqual([
      1, 1, 2, 2, 3, 3, 4, 4, 5,
    ]);
    expect(getErIntegerFavourMultiplier(60, 3)).toBe(3);
    expect(getErIntegerFavourMultiplier(60, 5)).toBe(5);
  });

  it("returns safe capped integers for every difficulty, pacing, tier, Favour, and Endless sample", () => {
    for (const difficulty of difficulties) {
      for (const pacing of pacingModes) {
        for (let tier = 1; tier <= 10; tier++) {
          for (let favourPoints = 0; favourPoints <= 60; favourPoints++) {
            for (const favourCap of [3, 5] as const) {
              for (const endlessEquivalentDepth of [0, 49, 50, 499, 2500]) {
                const rates = resolveErRewardRates(
                  context({
                    difficulty,
                    pacing,
                    runWave: (tier - 1) * (pacing === "sprint" ? 10 : 20) + 1,
                    favourPoints,
                    favourCap,
                    endlessActive: endlessEquivalentDepth > 0,
                    endlessEquivalentDepth,
                  }),
                );
                for (const value of [rates.totalShiny, rates.totalCandy, rates.totalVoucher]) {
                  expect(Number.isSafeInteger(value)).toBe(true);
                  expect(value).toBeGreaterThanOrEqual(0);
                  expect(value).toBeLessThanOrEqual(50);
                }
              }
            }
          }
        }
      }
    }
  });

  it("keeps vouchers independent of Favour", () => {
    const low = resolveErRewardRates(context({ difficulty: "elite", runWave: 181, favourPoints: 0 }));
    const high = resolveErRewardRates(context({ difficulty: "elite", runWave: 181, favourPoints: 60, favourCap: 5 }));
    expect(high.totalVoucher).toBe(low.totalVoucher);
    expect(high.totalShiny).toBeGreaterThan(low.totalShiny);
    expect(high.totalCandy).toBeGreaterThan(low.totalCandy);
  });

  it("holds Tier X in Endless and adds rather than multiplies its depth bonus", () => {
    const rates = resolveErRewardRates(
      context({
        difficulty: "hell",
        runWave: 12,
        favourPoints: 20,
        endlessActive: true,
        endlessEquivalentDepth: 150,
      }),
    );
    expect(rates.tier).toBe(10);
    expect(rates.baseVoucher).toBe(11);
    expect(rates.endlessBonus).toBe(3);
    expect(rates.totalVoucher).toBe(14);
    expect(rates.totalShiny).toBe(Math.min(50, rates.baseShiny * rates.favourMultiplier + 3));
  });

  it("matches the exact endpoint tables used by the compact panel", () => {
    expect(resolveErRewardRates(context({ difficulty: "youngster", runWave: 181 })).baseCandy).toBe(8);
    expect(resolveErRewardRates(context({ difficulty: "ace", runWave: 181 })).baseShiny).toBe(4);
    expect(resolveErRewardRates(context({ difficulty: "elite", runWave: 181 })).baseVoucher).toBe(8);
    expect(resolveErRewardRates(context({ difficulty: "hell", runWave: 181 })).baseVoucher).toBe(11);
    expect(resolveErRewardRates(context({ difficulty: "youngster", runWave: 181 })).totalVoucher).toBe(0);
  });
});
