/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Community Challenge - local "My Drafts" store (MY CHALLENGES tab).
//
// A draft is ALSO persisted server-side, but the client must remember it locally
// so it is NEVER lost - in particular a founder who LOSES their qualifying run can
// still find + finalize the draft (the server row stays 'draft', the client just
// forgot its id). This verifies: saveLocalDraft survives, recordLocalDraftAttempt
// counts wins/losses (a win marks it published), and buildMyChallengesFeed turns
// the store into the MY tab feed. Uses an in-memory localStorage stub so it runs
// regardless of the test environment.
// =============================================================================

import {
  buildMyChallengesFeed,
  type CommunityChallengeConfig,
  getLocalDraft,
  listLocalDrafts,
  recordLocalDraftAttempt,
  saveLocalDraft,
} from "#data/elite-redux/er-community-challenges";
import type { ErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { GameModes } from "#enums/game-modes";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function makeConfig(id: string, allowedSpecies: number[] | null = null): CommunityChallengeConfig {
  return {
    schemaVersion: 1,
    id,
    name: `Draft ${id}`,
    subtitle: "",
    description: "",
    author: "Founder",
    gameModeId: GameModes.CHALLENGE,
    difficulty: "elite" as ErDifficulty,
    difficultyTier: 4,
    baseChallenges: [],
    allowedSpecies,
    restrictions: { noLegendary: true },
    targetWave: 200,
    tags: ["MONOTYPE"],
  };
}

describe("ER Community Challenge - local drafts (MY CHALLENGES)", () => {
  // The test env provides a real localStorage; isolate by clearing it around each test.
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("saves a draft on create so it is not lost (and lists newest-first)", () => {
    expect(listLocalDrafts()).toHaveLength(0);
    saveLocalDraft(makeConfig("draft-a"));
    saveLocalDraft(makeConfig("draft-b"));
    const drafts = listLocalDrafts();
    expect(drafts).toHaveLength(2);
    // newest activity first (draft-b was saved last)
    expect(drafts[0].id).toBe("draft-b");
    expect(getLocalDraft("draft-a")?.status).toBe("draft");
  });

  it("a founder LOSS records a failed attempt and KEEPS the draft (still a draft)", () => {
    saveLocalDraft(makeConfig("draft-loss"));
    recordLocalDraftAttempt("draft-loss", "failed", 42);
    const d = getLocalDraft("draft-loss");
    expect(d).not.toBeNull();
    expect(d?.status).toBe("draft"); // NOT lost, NOT published
    expect(d?.attempts).toBe(1);
    expect(d?.failed).toBe(1);
    expect(d?.lastWave).toBe(42);
  });

  it("a founder WIN marks the draft published", () => {
    saveLocalDraft(makeConfig("draft-win"));
    recordLocalDraftAttempt("draft-win", "cleared", 200);
    const d = getLocalDraft("draft-win");
    expect(d?.status).toBe("published");
    expect(d?.cleared).toBe(1);
    expect(d?.attempts).toBe(1);
  });

  it("buildMyChallengesFeed turns the store into the MY tab feed with the founder's stats", () => {
    saveLocalDraft(makeConfig("draft-feed", [1, 4, 7]));
    recordLocalDraftAttempt("draft-feed", "failed", 30);
    const feed = buildMyChallengesFeed();
    expect(feed.featured).toHaveLength(1);
    const entry = feed.featured[0];
    expect(entry.config.id).toBe("draft-feed");
    expect(entry.stats.failed).toBe(1);
    expect(entry.allowedCount).toBe(3);
    expect(entry.allowedPreview).toEqual([1, 4, 7]);
    // rules are derived (difficulty + species cap + restriction + tag), never empty.
    expect(entry.rules.length).toBeGreaterThan(0);
  });

  it("an empty store yields an empty feed (no crash, MY tab shows its empty state)", () => {
    const feed = buildMyChallengesFeed();
    expect(feed.featured).toHaveLength(0);
    expect(feed.selected).toBeNull();
  });
});
