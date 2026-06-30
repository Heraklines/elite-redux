/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Community Challenge - founder "must clear it to publish" run-state.
//
// When a creator publishes a draft they are dropped into a qualifying run tagged
// with the draft id + config (er-community-run-state). That tag must survive a
// mid-run save + reload so the eventual victory still auto-publishes the draft
// (the publish is "not lost"), and must clear when returning to the title so a
// later normal run is never mistaken for a founder run. This verifies that
// round-trip (the same JSON round-trip the session save performs).
// =============================================================================

import type { CommunityChallengeConfig } from "#data/elite-redux/er-community-challenges";
import {
  type FounderRunState,
  getFounderRunState,
  resetCommunityRunState,
  setFounderRunState,
} from "#data/elite-redux/er-community-run-state";
import type { ErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { Challenges } from "#enums/challenges";
import { GameModes } from "#enums/game-modes";
import { afterEach, describe, expect, it } from "vitest";

function makeConfig(id: string): CommunityChallengeConfig {
  return {
    schemaVersion: 1,
    id,
    name: "Apex Trial",
    subtitle: "",
    description: "",
    author: "Founder",
    gameModeId: GameModes.CHALLENGE,
    difficulty: "hell" as ErDifficulty,
    difficultyTier: 5,
    baseChallenges: [[Challenges.DOUBLES_ONLY, 1]],
    allowedSpecies: null,
    restrictions: {},
    targetWave: 200,
    tags: [],
  };
}

describe("ER Community Challenge - founder run-state", () => {
  afterEach(() => resetCommunityRunState());

  it("starts empty", () => {
    expect(getFounderRunState()).toBeNull();
  });

  it("tags + reads the founder run, and survives a session save/reload round-trip", () => {
    const state: FounderRunState = { draftId: "draft-xyz", config: makeConfig("draft-xyz") };
    setFounderRunState(state);
    expect(getFounderRunState()?.draftId).toBe("draft-xyz");
    expect(getFounderRunState()?.config.difficulty).toBe("hell");

    // Mid-run save: the session save serializes getFounderRunState() to plain JSON,
    // a reload sets it back. Mirror that exact round-trip.
    const serialized = JSON.parse(JSON.stringify(getFounderRunState())) as FounderRunState;
    setFounderRunState(null);
    expect(getFounderRunState()).toBeNull();
    setFounderRunState(serialized);

    const restored = getFounderRunState();
    expect(restored?.draftId).toBe("draft-xyz");
    expect(restored?.config.targetWave).toBe(200);
    expect(restored?.config.baseChallenges).toEqual([[Challenges.DOUBLES_ONLY, 1]]);
  });

  it("returning to the title clears it (a later normal run is never a founder run)", () => {
    setFounderRunState({ draftId: "draft-1", config: makeConfig("draft-1") });
    expect(getFounderRunState()).not.toBeNull();
    resetCommunityRunState();
    expect(getFounderRunState()).toBeNull();
  });
});
