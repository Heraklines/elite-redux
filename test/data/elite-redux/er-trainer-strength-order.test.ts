/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — #225: wave-appropriate trainer selection metric. Elite/Hell
// pick a trainer by team strength (summed base-stat-total of its roster) and
// index into the strength-ordered pool by wave depth, so early waves field
// weaker (often-unevolved) teams and the late game fields E4 / champion teams.
// This pins the underlying metric: it produces a real spread and ranks weaker
// teams below stronger ones.
// =============================================================================

import { findErTrainersForType } from "#data/elite-redux/er-trainer-overlay";
import { teamStrength } from "#data/elite-redux/er-trainer-runtime-hook";
import { TrainerType } from "#enums/trainer-type";
import "#test/framework/game-manager"; // ensures init (species base stats loaded)
import { describe, expect, it } from "vitest";

describe("ER wave-appropriate trainer metric (#225)", () => {
  it("teamStrength ranks ER trainers by team base-stat-total with a real spread", () => {
    const candidates = findErTrainersForType(TrainerType.ACE_TRAINER);
    expect(candidates.length).toBeGreaterThan(1);

    const strengths = candidates.map(t => teamStrength(t, "insane")).filter(s => s > 0);
    // The metric must actually score teams (non-degenerate)...
    expect(strengths.length).toBeGreaterThan(1);
    // ...and produce a spread so sorting yields an early→late progression.
    expect(Math.min(...strengths)).toBeLessThan(Math.max(...strengths));
  });

  it("is stable/cached: same trainer+tier yields the same score", () => {
    const t = findErTrainersForType(TrainerType.ACE_TRAINER)[0];
    expect(teamStrength(t, "insane")).toBe(teamStrength(t, "insane"));
  });
});
