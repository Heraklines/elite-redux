import { describe, expect, it } from "vitest";
import vanillaAchievementIds from "../../../../scripts/elite-redux/vanilla-achievement-ids.json";
import communitySuggestionAchievements from "../../../../src/data/elite-redux/er-community-suggestion-achievements.json";
import {
  calculateCommunitySuggestionEligibility,
  extractCommunitySuggestionAchievementIds,
  mergeSuggestionDeltas,
  validateCommunitySuggestion,
} from "../../../../workers/er-save-api/src/community-suggestions";

const validDraft = {
  entityType: "pokemon",
  entityKey: "SPECIES_JUMPLUFF_MEGA",
  entityLabel: "Mega Jumpluff",
  reason: "Adds a second utility line without increasing damage.",
  sourceRevision: "abc123",
  changes: {
    "species-abilities": {
      SPECIES_JUMPLUFF_MEGA: { ability2: 5184, innates: [34, 207, 5301] },
    },
  },
  baseline: {
    "species-abilities": {
      SPECIES_JUMPLUFF_MEGA: { ability2: 102, innates: [34, 207, 112] },
    },
  },
};

describe("community editor suggestion validation", () => {
  it("gates by half of distinct Redux-only achievements, not achievement points", () => {
    const reduxIds = communitySuggestionAchievements.achievements.map(achievement => achievement.id);
    const vanillaIds = new Set(vanillaAchievementIds);

    expect(new Set(reduxIds).size).toBe(reduxIds.length);
    expect(reduxIds.some(id => vanillaIds.has(id))).toBe(false);
    expect(communitySuggestionAchievements.totalAchievements).toBe(reduxIds.length);
    expect(communitySuggestionAchievements.requiredAchievements).toBe(Math.ceil(reduxIds.length / 2));
    expect(communitySuggestionAchievements.sourceAchievementCount).toBe(
      communitySuggestionAchievements.totalAchievements + communitySuggestionAchievements.vanillaAchievementsExcluded,
    );

    const eligibleIds = new Set(reduxIds);
    const belowThreshold = calculateCommunitySuggestionEligibility(
      reduxIds.slice(0, communitySuggestionAchievements.requiredAchievements - 1),
      eligibleIds,
      communitySuggestionAchievements.requiredAchievements,
    );
    const atThreshold = calculateCommunitySuggestionEligibility(
      [...reduxIds.slice(0, communitySuggestionAchievements.requiredAchievements), reduxIds[0]],
      eligibleIds,
      communitySuggestionAchievements.requiredAchievements,
    );

    expect(belowThreshold).toMatchObject({
      eligible: false,
      achievementCount: communitySuggestionAchievements.requiredAchievements - 1,
    });
    expect(atThreshold).toMatchObject({
      eligible: true,
      achievementCount: communitySuggestionAchievements.requiredAchievements,
    });
  });

  it("extracts only Redux achievements from a current system save", () => {
    const reduxIds = communitySuggestionAchievements.achievements.map(achievement => achievement.id);
    const eligibleIds = new Set(reduxIds);
    const save = JSON.stringify({
      achvUnlocks: {
        [reduxIds[0]]: 1,
        [reduxIds[1]]: 2,
        CLASSIC_VICTORY: 3,
        UNKNOWN_ACHIEVEMENT: 4,
      },
    });

    expect(extractCommunitySuggestionAchievementIds(save, eligibleIds)).toEqual([reduxIds[0], reduxIds[1]]);
    expect(extractCommunitySuggestionAchievementIds("not-json", eligibleIds)).toEqual([]);
    expect(extractCommunitySuggestionAchievementIds(JSON.stringify({ achvUnlocks: [] }), eligibleIds)).toEqual([]);
  });

  it("accepts a bounded editor-native delta", () => {
    expect(validateCommunitySuggestion(validDraft)).toMatchObject({ ok: true, errors: [] });
  });

  it("accepts a focused multi-section proposal from the shared editor", () => {
    const result = validateCommunitySuggestion({
      ...validDraft,
      entityType: "other",
      entityKey: "BATCH_1234",
      entityLabel: "Editor proposal (2 changes)",
      changes: {
        "egg-moves": { SPECIES_ABRA: ["TACKLE", "ICE_BEAM"] },
        "species-abilities": { SPECIES_ABRA: { ability2: 5184 } },
      },
      baseline: {
        "egg-moves": { SPECIES_ABRA: ["AURA_SPHERE", "ICE_BEAM"] },
        "species-abilities": { SPECIES_ABRA: { ability2: 102 } },
      },
    });
    expect(result).toMatchObject({ ok: true, errors: [] });
  });

  it("rejects unsupported files and missing matching baselines", () => {
    const result = validateCommunitySuggestion({
      ...validDraft,
      changes: { "production-secrets": { SESSION_SECRET: "nope" } },
      baseline: { "species-abilities": validDraft.baseline["species-abilities"] },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("unsupported file");
  });

  it("merges staged changes without erasing sibling editor values", () => {
    const merged = mergeSuggestionDeltas(
      { SPECIES_JUMPLUFF_MEGA: { ability1: 34, ability2: 102 } },
      { SPECIES_JUMPLUFF_MEGA: { ability2: 5184 } },
    );
    expect(merged).toEqual({ SPECIES_JUMPLUFF_MEGA: { ability1: 34, ability2: 5184 } });
  });
});
