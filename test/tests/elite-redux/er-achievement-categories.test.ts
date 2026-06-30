import { describeRewardSpec, getAchvRewardSummary } from "#data/elite-redux/er-achievement-rewards";
import { EggTier } from "#enums/egg-type";
import { PlayerGender } from "#enums/player-gender";
import { achvs, initAchievements } from "#system/achv";
import {
  ACHV_CATEGORY_ORDER,
  type AchvCategory,
  computeAchvProgress,
  getAchvCategory,
  getAchvDisplayName,
} from "#system/achv-category";
import { beforeAll, describe, expect, it } from "vitest";

describe("ER achievement categories + reward summaries", () => {
  beforeAll(() => {
    // Assign each achievement its registry-key `id` (the explicit category map keys off it).
    initAchievements();
  });

  it("assigns every achievement to a category in the nav order", () => {
    const valid = new Set<AchvCategory>(ACHV_CATEGORY_ORDER);
    const all = Object.values(achvs);
    expect(all.length).toBeGreaterThan(100);
    for (const achv of all) {
      const category = getAchvCategory(achv);
      expect(valid.has(category), `${achv.id} -> unknown category ${category}`).toBe(true);
    }
  });

  it("computeAchvProgress tallies overall + per-category counts and points consistently", () => {
    const total = Object.keys(achvs).length;
    const totalScore = Object.values(achvs).reduce((s, a) => s + a.score, 0);

    // No unlocks: full denominators, zero earned.
    const none = computeAchvProgress({});
    expect(none.overall.total).toBe(total);
    expect(none.overall.unlocked).toBe(0);
    expect(none.overall.earnedScore).toBe(0);
    expect(none.overall.totalScore).toBe(totalScore);

    // Per-category totals must partition the registry exactly.
    const summedTotal = ACHV_CATEGORY_ORDER.reduce((s, c) => s + none.byCategory[c].total, 0);
    const summedScore = ACHV_CATEGORY_ORDER.reduce((s, c) => s + none.byCategory[c].totalScore, 0);
    expect(summedTotal).toBe(total);
    expect(summedScore).toBe(totalScore);

    // Every achievement unlocked: earned === total everywhere.
    const allUnlocks = Object.fromEntries(Object.keys(achvs).map(id => [id, 1]));
    const full = computeAchvProgress(allUnlocks);
    expect(full.overall.unlocked).toBe(total);
    expect(full.overall.earnedScore).toBe(totalScore);
    for (const c of ACHV_CATEGORY_ORDER) {
      expect(full.byCategory[c].unlocked).toBe(full.byCategory[c].total);
      expect(full.byCategory[c].earnedScore).toBe(full.byCategory[c].totalScore);
    }
  });

  it("describeRewardSpec renders species-free specs without resolving game data", () => {
    expect(describeRewardSpec({ kind: "candyTeam", perMon: 30 })).toBe("30 candy per team member");
    expect(describeRewardSpec({ kind: "eggs", tier: EggTier.RARE, count: 2 })).toBe("2 Rare Eggs");
    expect(describeRewardSpec({ kind: "eggs", tier: EggTier.EPIC, count: 1, shiny: true })).toBe("1 shiny Epic Egg");
    expect(describeRewardSpec({ kind: "shiny", tier: 1, species: "random" })).toBe("a random shiny");
    expect(describeRewardSpec({ kind: "shinyLabEffects", effects: [] })).toBeNull();
  });

  it("getAchvRewardSummary surfaces the configured reward for an achievement", () => {
    const summary = getAchvRewardSummary("CLASSIC_VICTORY");
    expect(summary).toContain("30 candy per team member");
    expect(summary.some(line => /Rare Egg/.test(line))).toBe(true);

    // An achievement with no reward entry resolves to an empty list (points-only).
    expect(getAchvRewardSummary("__no_such_achv__")).toEqual([]);
  });

  it("getAchvDisplayName falls back for digit-leading keys i18next drops, resolves the rest", () => {
    // i18next cannot resolve "1000Dmg.name" (leading-digit keys are dropped from the store),
    // so the fallback supplies the English name; non-digit keys resolve normally.
    expect(getAchvDisplayName(achvs._1000_DMG, PlayerGender.MALE)).toBe("Harder Hitter");
    expect(getAchvDisplayName(achvs._10K_MONEY, PlayerGender.MALE)).toBe("Money Haver");
    expect(getAchvDisplayName(achvs.CLASSIC_VICTORY, PlayerGender.MALE)).toBe("Undefeated");
    // Never leaks a raw "<key>.name" miss to the UI.
    for (const achv of Object.values(achvs)) {
      expect(getAchvDisplayName(achv, PlayerGender.MALE)).not.toMatch(/\.name$/);
    }
  });
});
