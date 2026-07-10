/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER achievement expansion wave (#900) - registry + locale + category + reward +
// effect-gate gate (engine-free). Every new achievement must:
//   - be present in the `achvs` registry with the expected id / localizationKey /
//     item-atlas icon / score / derived tier,
//   - have a non-empty English name + description (so the screen never shows a raw
//     "<key>.name"),
//   - resolve to its intended AchvCategory (VERSUS / COOP / BATTLE / COLLECTION),
//   - carry a non-empty reward summary (each one grants something), and
//   - the new marquee achvs each unlock exactly their bound Shiny Lab effect.
// The live DETECTION paths are exercised in er-social-achievement-detection.test.ts
// (pure evaluators) + in-game scenarios; those need a live scene.
// =============================================================================

import { getAchvRewardSummary } from "#data/elite-redux/er-achievement-rewards";
import { ER_SHINY_LAB_EFFECT_ACHV, getErShinyLabEffectsForAchv } from "#data/elite-redux/er-shiny-lab-effects";
import { AchvTier, achvs, initAchievements } from "#system/achv";
import { AchvCategory, getAchvCategory } from "#system/achv-category";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

interface NewAchvSpec {
  key: keyof typeof achvs;
  localizationKey: string;
  icon: string;
  score: number;
  category: AchvCategory;
}

const NEW_ACHVS: NewAchvSpec[] = [
  // --- Versus ---
  { key: "FIRST_BLOOD", localizationKey: "firstBlood", icon: "brick", score: 25, category: AchvCategory.VERSUS },
  { key: "DUELIST", localizationKey: "duelist", icon: "rb", score: 50, category: AchvCategory.VERSUS },
  { key: "VETERAN_DUELIST", localizationKey: "veteranDuelist", icon: "mb", score: 75, category: AchvCategory.VERSUS },
  {
    key: "LEGENDARY_DUELIST",
    localizationKey: "legendaryDuelist",
    icon: "relic_crown",
    score: 100,
    category: AchvCategory.VERSUS,
  },
  { key: "HIGH_ROLLER", localizationKey: "highRoller", icon: "coin_case", score: 50, category: AchvCategory.VERSUS },
  { key: "ALL_IN", localizationKey: "allIn", icon: "relic_gold", score: 75, category: AchvCategory.VERSUS },
  { key: "RAW_TALENT", localizationKey: "rawTalent", icon: "eviolite", score: 50, category: AchvCategory.VERSUS },
  {
    key: "BUDGET_CHAMPION",
    localizationKey: "budgetChampion",
    icon: "nugget",
    score: 50,
    category: AchvCategory.VERSUS,
  },
  {
    key: "RAGS_TO_RICHES",
    localizationKey: "ragsToRiches",
    icon: "big_nugget",
    score: 75,
    category: AchvCategory.VERSUS,
  },
  {
    key: "APEX_PREDATOR",
    localizationKey: "apexPredator",
    icon: "scope_lens",
    score: 75,
    category: AchvCategory.VERSUS,
  },
  {
    key: "FLAWLESS_DUEL",
    localizationKey: "flawlessDuel",
    icon: "focus_sash",
    score: 75,
    category: AchvCategory.VERSUS,
  },
  {
    key: "DAVID_AND_GOLIATH",
    localizationKey: "davidAndGoliath",
    icon: "focus_band",
    score: 75,
    category: AchvCategory.VERSUS,
  },
  {
    key: "GOOD_SPORT",
    localizationKey: "goodSport",
    icon: "ribbon_friendship",
    score: 25,
    category: AchvCategory.VERSUS,
  },
  // --- Co-op ---
  {
    key: "CO_OP_INITIATE",
    localizationKey: "coOpInitiate",
    icon: "linking_cord",
    score: 25,
    category: AchvCategory.COOP,
  },
  {
    key: "BETTER_TOGETHER",
    localizationKey: "betterTogether",
    icon: "linking_cord",
    score: 25,
    category: AchvCategory.COOP,
  },
  {
    key: "PARTNERS_IN_CRIME",
    localizationKey: "partnersInCrime",
    icon: "linking_cord",
    score: 50,
    category: AchvCategory.COOP,
  },
  { key: "LONG_HAUL_DUO", localizationKey: "longHaulDuo", icon: "leftovers", score: 75, category: AchvCategory.COOP },
  { key: "THE_LONG_ROAD", localizationKey: "theLongRoad", icon: "dusk_stone", score: 100, category: AchvCategory.COOP },
  {
    key: "DYNAMIC_DUO",
    localizationKey: "dynamicDuo",
    icon: "classic_ribbon_default",
    score: 100,
    category: AchvCategory.COOP,
  },
  { key: "GENEROUS_SOUL", localizationKey: "generousSoul", icon: "soul_dew", score: 25, category: AchvCategory.COOP },
  {
    key: "GUARDIAN_ANGEL",
    localizationKey: "guardianAngel",
    icon: "focus_sash",
    score: 50,
    category: AchvCategory.COOP,
  },
  {
    key: "SHARED_TRIUMPH",
    localizationKey: "sharedTriumph",
    icon: "legendary_egg",
    score: 100,
    category: AchvCategory.COOP,
  },
  {
    key: "DOUBLE_TROUBLE_HELL",
    localizationKey: "doubleTroubleHell",
    icon: "dread_plate",
    score: 100,
    category: AchvCategory.COOP,
  },
  // --- Triples (BATTLE) ---
  {
    key: "THREES_COMPANY",
    localizationKey: "threesCompany",
    icon: "multi_lens",
    score: 25,
    category: AchvCategory.BATTLE,
  },
  {
    key: "TRIPLE_THREAT",
    localizationKey: "tripleThreat",
    icon: "multi_lens",
    score: 50,
    category: AchvCategory.BATTLE,
  },
  { key: "TRIPLE_DOWN", localizationKey: "tripleDown", icon: "multi_lens", score: 75, category: AchvCategory.BATTLE },
  { key: "CENTER_STAGE", localizationKey: "centerStage", icon: "scope_lens", score: 50, category: AchvCategory.BATTLE },
  {
    key: "HOLD_THE_LINE",
    localizationKey: "holdTheLine",
    icon: "protective_pads",
    score: 50,
    category: AchvCategory.BATTLE,
  },
  { key: "GHOST_TRIAD", localizationKey: "ghostTriad", icon: "ghost_gem", score: 75, category: AchvCategory.BATTLE },
  {
    key: "ONE_TURN_CLEAR",
    localizationKey: "oneTurnClear",
    icon: "power_herb",
    score: 75,
    category: AchvCategory.BATTLE,
  },
  {
    key: "TRIAD_OF_HELL",
    localizationKey: "triadOfHell",
    icon: "dread_plate",
    score: 100,
    category: AchvCategory.BATTLE,
  },
  // --- Shiny Lab (COLLECTION) ---
  {
    key: "FASHIONISTA",
    localizationKey: "fashionista",
    icon: "shiny_charm",
    score: 25,
    category: AchvCategory.COLLECTION,
  },
  {
    key: "LOOK_COLLECTOR_10",
    localizationKey: "lookCollector10",
    icon: "shiny_charm",
    score: 25,
    category: AchvCategory.COLLECTION,
  },
  {
    key: "LOOK_COLLECTOR_25",
    localizationKey: "lookCollector25",
    icon: "shiny_charm",
    score: 50,
    category: AchvCategory.COLLECTION,
  },
  {
    key: "LOOK_COLLECTOR_50",
    localizationKey: "lookCollector50",
    icon: "shiny_charm",
    score: 75,
    category: AchvCategory.COLLECTION,
  },
  {
    key: "LOOK_COLLECTOR_100",
    localizationKey: "lookCollector100",
    icon: "shiny_charm",
    score: 100,
    category: AchvCategory.COLLECTION,
  },
  {
    key: "PRESET_CURATOR",
    localizationKey: "presetCurator",
    icon: "baton",
    score: 50,
    category: AchvCategory.COLLECTION,
  },
  {
    key: "SIGNATURE_STYLE",
    localizationKey: "signatureStyle",
    icon: "pb_gold",
    score: 75,
    category: AchvCategory.COLLECTION,
  },
  // --- #900 follow-up: challenge-stack apex + combos (CHALLENGE) ---
  { key: "COCYTUS", localizationKey: "cocytus", icon: "icicle_plate", score: 175, category: AchvCategory.CHALLENGE },
  { key: "GIUDECCA", localizationKey: "giudecca", icon: "pb_black", score: 160, category: AchvCategory.CHALLENGE },
  {
    key: "THE_UPSIDE_DOWN",
    localizationKey: "theUpsideDown",
    icon: "inverse",
    score: 110,
    category: AchvCategory.CHALLENGE,
  },
  {
    key: "MONOCHROME_REQUIEM",
    localizationKey: "monochromeRequiem",
    icon: "dubious_disc",
    score: 110,
    category: AchvCategory.CHALLENGE,
  },
  {
    key: "TYPECAST_TRIO",
    localizationKey: "typecastTrio",
    icon: "multi_lens",
    score: 100,
    category: AchvCategory.CHALLENGE,
  },
];

/** Tier is derived purely from score (see Achv.getTier). */
function expectedTier(score: number): AchvTier {
  if (score >= 100) {
    return AchvTier.MASTER;
  }
  if (score >= 75) {
    return AchvTier.ROGUE;
  }
  if (score >= 50) {
    return AchvTier.ULTRA;
  }
  if (score >= 25) {
    return AchvTier.GREAT;
  }
  return AchvTier.COMMON;
}

describe("ER achievement expansion wave (#900) - registry + locale + category", () => {
  beforeAll(() => initAchievements());

  const locale = JSON.parse(readFileSync(resolve("locales/en/achv.json"), "utf-8")) as Record<
    string,
    { name: string; name_female: string; description: string }
  >;

  it("adds 43 new/revised achievements across Versus / Co-op / Triples / Shiny Lab / Challenge", () => {
    expect(NEW_ACHVS).toHaveLength(43);
  });

  it("registers each with the expected id, localizationKey, icon, score, and tier", () => {
    for (const spec of NEW_ACHVS) {
      const achv = achvs[spec.key];
      expect(achv, `${spec.key} missing from registry`).toBeDefined();
      expect(achv.id).toBe(spec.key);
      expect(achv.localizationKey).toBe(spec.localizationKey);
      expect(achv.getIconImage()).toBe(spec.icon);
      expect(achv.score).toBe(spec.score);
      expect(achv.getTier()).toBe(expectedTier(spec.score));
    }
  });

  it("has a non-empty English name + description for each", () => {
    for (const spec of NEW_ACHVS) {
      const entry = locale[spec.localizationKey];
      expect(entry, `${spec.localizationKey} missing from locales/en/achv.json`).toBeDefined();
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.name_female.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      // Maintainer rule: no em dash in player-facing text.
      expect(entry.description).not.toContain("—");
    }
  });

  it("has the new category localization keys", () => {
    const category = (locale as unknown as { category: Record<string, string> }).category;
    expect(category.versus.length).toBeGreaterThan(0);
    expect(category.coop.length).toBeGreaterThan(0);
  });

  it("resolves each to its intended AchvCategory", () => {
    for (const spec of NEW_ACHVS) {
      expect(getAchvCategory(achvs[spec.key]), `${spec.key} miscategorized`).toBe(spec.category);
    }
  });

  it("grants a non-empty reward summary for each", () => {
    for (const spec of NEW_ACHVS) {
      const summary = getAchvRewardSummary(spec.key);
      expect(summary.length, `${spec.key} has no reward`).toBeGreaterThan(0);
      for (const line of summary) {
        expect(line.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("ER achievement expansion wave (#900) - Shiny Lab effect gates", () => {
  // Each of these marquee achvs unlocks exactly ONE new Shiny Lab effect (thematic).
  const EXPECTED_GATES: Record<string, string> = {
    FIRST_BLOOD: "embers",
    LEGENDARY_DUELIST: "moonstone",
    HIGH_ROLLER: "rosegold",
    ALL_IN: "sparkle",
    FLAWLESS_DUEL: "marble",
    DAVID_AND_GOLIATH: "camo",
    DYNAMIC_DUO: "duosunset",
    SHARED_TRIUMPH: "starmap",
    DOUBLE_TROUBLE_HELL: "heatshimmer",
    GHOST_TRIAD: "vortex",
    ONE_TURN_CLEAR: "neonwire",
    TRIAD_OF_HELL: "lavacracks",
    CENTER_STAGE: "luminous",
    FASHIONISTA: "vaporwave",
  };

  it("binds each marquee achv to its intended (existing) effect", () => {
    for (const [achvId, effectId] of Object.entries(EXPECTED_GATES)) {
      expect(ER_SHINY_LAB_EFFECT_ACHV[effectId], `${effectId} not bound to ${achvId}`).toBe(achvId);
      expect(getErShinyLabEffectsForAchv(achvId), `${achvId} effect not resolved`).toContain(effectId);
    }
  });

  it("never binds two effects to the same new achv id (one cosmetic each)", () => {
    const byAchv = new Map<string, number>();
    for (const achvId of Object.values(ER_SHINY_LAB_EFFECT_ACHV)) {
      byAchv.set(achvId, (byAchv.get(achvId) ?? 0) + 1);
    }
    for (const achvId of Object.keys(EXPECTED_GATES)) {
      expect(byAchv.get(achvId), `${achvId} bound to >1 effect`).toBe(1);
    }
  });
});
