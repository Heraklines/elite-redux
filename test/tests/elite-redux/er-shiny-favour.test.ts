/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Unit test for the Challenge "Favour" → shiny-odds curve and per-challenge
// favour values. Pure functions — no game boot needed.

import type { Challenge } from "#data/challenge";
import { FAVOUR_SHINY_MAX_MULT, favourToShinyMultiplier, getChallengeFavour } from "#data/elite-redux/er-shiny-favour";
import { Challenges } from "#enums/challenges";
import { describe, expect, it } from "vitest";

const challengeStub = (id: Challenges, value: number): Challenge => ({ id, value }) as unknown as Challenge;

describe("ER shiny favour", () => {
  it("curve: +0.5x per 5 favour, capped at 3x", () => {
    expect(favourToShinyMultiplier(0)).toBe(1);
    expect(favourToShinyMultiplier(4)).toBe(1);
    expect(favourToShinyMultiplier(5)).toBe(1.5);
    expect(favourToShinyMultiplier(10)).toBe(2);
    expect(favourToShinyMultiplier(15)).toBe(2.5);
    expect(favourToShinyMultiplier(20)).toBe(3);
    // Cap holds beyond 20.
    expect(favourToShinyMultiplier(100)).toBe(FAVOUR_SHINY_MAX_MULT);
  });

  it("per-challenge favour (active vs inactive)", () => {
    // Confirmed values: No Passives 10, Hardcore 8, Limited Support 6,
    // Mono-type 5, Inverse/Flip 3.
    expect(getChallengeFavour(challengeStub(Challenges.PASSIVES, 1))).toBe(10);
    expect(getChallengeFavour(challengeStub(Challenges.HARDCORE, 1))).toBe(8);
    expect(getChallengeFavour(challengeStub(Challenges.LIMITED_SUPPORT, 1))).toBe(6);
    expect(getChallengeFavour(challengeStub(Challenges.SINGLE_TYPE, 3))).toBe(5);
    expect(getChallengeFavour(challengeStub(Challenges.INVERSE_BATTLE, 1))).toBe(3);
    expect(getChallengeFavour(challengeStub(Challenges.FLIP_STAT, 1))).toBe(3);
    // Inactive (value 0) contributes nothing.
    expect(getChallengeFavour(challengeStub(Challenges.PASSIVES, 0))).toBe(0);
  });
});
