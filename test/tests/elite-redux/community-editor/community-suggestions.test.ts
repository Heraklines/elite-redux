import { describe, expect, it } from "vitest";
import {
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
  it("accepts a bounded editor-native delta", () => {
    expect(validateCommunitySuggestion(validDraft)).toMatchObject({ ok: true, errors: [] });
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
