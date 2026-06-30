/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER achievements - batch 2 ("EVERYONE GET OUT!" .. "End the Legend").
//
// A registry + locale gate (engine-free): every new achievement must be present
// in the `achvs` registry with the expected localizationKey / item-atlas icon /
// score, must have a non-empty English name + description in the locale bundle
// (so the screen never shows a raw "<key>.name"), and must resolve to a valid
// AchvCategory (the side-map falls back to BATTLE, never undefined). The combat
// DETECTION paths live in er-achievement-tracker and are exercised in-game (the
// scenario list) rather than here, since they need a live battle scene.
// =============================================================================

import { ER_COMPOSITE_PARTS } from "#data/elite-redux/er-composite-parts";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ErAbilityId } from "#enums/er-ability-id";
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
}

const NEW_ACHVS: NewAchvSpec[] = [
  { key: "EVERYONE_GET_OUT", localizationKey: "everyoneGetOut", icon: "eject_button", score: 50 },
  {
    key: "MUTUALLY_ASSURED_DESTRUCTION",
    localizationKey: "mutuallyAssuredDestruction",
    icon: "reaper_cloth",
    score: 50,
  },
  { key: "FULL_ON_MEGA_POWER", localizationKey: "fullOnMegaPower", icon: "mega_bracelet", score: 75 },
  { key: "ORIGINAL_DRAGON_SPIRIT", localizationKey: "originalDragonSpirit", icon: "dna_splicers", score: 50 },
  { key: "INCOMPATIBLE_HARDWARE", localizationKey: "incompatibleHardware", icon: "dubious_disc", score: 25 },
  { key: "DREAMCATCHER", localizationKey: "dreamcatcher", icon: "moon_stone", score: 50 },
  { key: "COMPLEAT_NIGHTMARE", localizationKey: "compleatNightmare", icon: "dread_plate", score: 25 },
  { key: "POKE_HIM_ON", localizationKey: "pokeHimOn", icon: "zap_plate", score: 25 },
  { key: "SUPER_ARMOR", localizationKey: "superArmor", icon: "metal_coat", score: 50 },
  { key: "PK_STARSTORM", localizationKey: "pkStarstorm", icon: "tm_dragon", score: 25 },
  { key: "REALISTIC_FLASH_IS_BORING", localizationKey: "realisticFlashIsBoring", icon: "power_herb", score: 50 },
  { key: "END_THE_LEGEND", localizationKey: "endTheLegend", icon: "brick", score: 50 },
  { key: "SQUATTER", localizationKey: "squatter", icon: "leftovers", score: 50 },
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

describe("ER new achievements (batch 2) - registry + locale", () => {
  beforeAll(() => initAchievements());

  const locale = JSON.parse(readFileSync(resolve("locales/en/achv.json"), "utf-8")) as Record<
    string,
    { name: string; name_female: string; description: string }
  >;

  it("registers all 12 with the expected id, localizationKey, icon, score, and tier", () => {
    for (const spec of NEW_ACHVS) {
      const achv = achvs[spec.key];
      expect(achv, `${spec.key} missing from registry`).toBeDefined();
      // initAchievements assigns id = the UPPER_SNAKE registry key.
      expect(achv.id).toBe(spec.key);
      expect(achv.localizationKey).toBe(spec.localizationKey);
      expect(achv.getIconImage()).toBe(spec.icon);
      expect(achv.score).toBe(spec.score);
      expect(achv.getTier()).toBe(expectedTier(spec.score));
    }
  });

  it("has a non-empty English name + description in the locale for each", () => {
    for (const spec of NEW_ACHVS) {
      const entry = locale[spec.localizationKey];
      expect(entry, `${spec.localizationKey} missing from locales/en/achv.json`).toBeDefined();
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.name_female.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it("resolves each to a valid AchvCategory (never undefined)", () => {
    const validCategories = new Set(Object.values(AchvCategory).filter((v): v is number => typeof v === "number"));
    for (const spec of NEW_ACHVS) {
      const category = getAchvCategory(achvs[spec.key]);
      expect(validCategories.has(category)).toBe(true);
    }
  });
});

// Mirrors the tracker's RAMPAGE_ABILITY_IDS fixpoint against the real id-map +
// composite tables, proving "End the Legend" counts composites that bundle Rampage
// (e.g. "Berserk + Rampage"), not just the pure Rampage ability.
describe("End the Legend - Rampage composite resolution (data-level)", () => {
  function computeRampageLiveIds(): Set<number> {
    const rampageDrafts = new Set<number>();
    for (const [draft, live] of Object.entries(ER_ID_MAP.abilities)) {
      if (live === ErAbilityId.RAMPAGE) {
        rampageDrafts.add(Number(draft));
      }
    }
    const bearingDrafts = new Set<number>(rampageDrafts);
    let changed = true;
    while (changed) {
      changed = false;
      for (const entry of Object.values(ER_COMPOSITE_PARTS)) {
        if (bearingDrafts.has(entry.erAbilityId)) {
          continue;
        }
        if (entry.parts.some(part => part.kind === "er" && bearingDrafts.has(part.erAbilityId))) {
          bearingDrafts.add(entry.erAbilityId);
          changed = true;
        }
      }
    }
    const liveIds = new Set<number>([ErAbilityId.RAMPAGE]);
    for (const draft of bearingDrafts) {
      const live = ER_ID_MAP.abilities[draft];
      if (typeof live === "number") {
        liveIds.add(live);
      }
    }
    return liveIds;
  }

  it("includes pure Rampage AND the composites that bundle it", () => {
    const liveIds = computeRampageLiveIds();
    // Pure Rampage is always present.
    expect(liveIds.has(ErAbilityId.RAMPAGE)).toBe(true);
    // Known composites whose draft parts include a Rampage draft (275) resolve to live ids.
    const compositeDraftsWithRampage = [480, 683, 721, 762, 811, 992];
    for (const draft of compositeDraftsWithRampage) {
      const live = ER_ID_MAP.abilities[draft];
      expect(typeof live).toBe("number");
      expect(liveIds.has(live as number)).toBe(true);
    }
    // The broadening genuinely adds beyond the single pure-Rampage id.
    expect(liveIds.size).toBeGreaterThan(1);
  });
});
