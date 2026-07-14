/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  clearTournamentMatchContext,
  getTournamentMatchContext,
  isTournamentMatch,
  isTournamentPeerAllowed,
  setTournamentMatchContext,
} from "#data/elite-redux/showdown/tournament-match-context";
import type { BracketView } from "#data/elite-redux/showdown/tournament-types";
import {
  formatDeadline,
  isBracketComplete,
  nextMatchFor,
  opponentOf,
  roundLabel,
} from "#data/elite-redux/showdown/tournament-types";
// Pure client-side tournament logic: the shared view helpers + the constrained-pairing gate.
// No engine boot needed.
import { afterEach, describe, expect, it } from "vitest";

/** A small 4-player bracket view, round 0 partly settled. */
function bracket(): BracketView {
  return {
    size: 4,
    rounds: [
      [
        {
          id: "r0m0",
          round: 0,
          slot: 0,
          a: "carla",
          b: "ash",
          winner: "carla",
          resolution: "reported",
          deadline: 100,
          disputed: false,
        },
        {
          id: "r0m1",
          round: 0,
          slot: 1,
          a: "misty",
          b: "brock",
          winner: null,
          resolution: "pending",
          deadline: 100,
          disputed: false,
        },
      ],
      [
        {
          id: "r1m0",
          round: 1,
          slot: 0,
          a: "carla",
          b: null,
          winner: null,
          resolution: "pending",
          deadline: 200,
          disputed: false,
        },
      ],
    ],
  };
}

describe("tournament-types view helpers", () => {
  it("nextMatchFor finds the participant's undecided match", () => {
    const b = bracket();
    // carla already won r0m0; her next undecided match is the final r1m0
    expect(nextMatchFor(b, "carla")?.id).toBe("r1m0");
    // misty's next is the pending r0m1
    expect(nextMatchFor(b, "misty")?.id).toBe("r0m1");
    // ash lost r0m0 and is in no other match
    expect(nextMatchFor(b, "ash")).toBeNull();
  });
  it("opponentOf returns the other side or null", () => {
    const m = bracket().rounds[0][1]; // misty vs brock
    expect(opponentOf(m, "misty")).toBe("brock");
    expect(opponentOf(m, "brock")).toBe("misty");
    expect(opponentOf(m, "carla")).toBeNull();
  });
  it("isBracketComplete reflects the final winner", () => {
    const b = bracket();
    expect(isBracketComplete(b)).toBe(false);
    b.rounds[1][0].winner = "carla";
    expect(isBracketComplete(b)).toBe(true);
  });
  it("roundLabel names the last rounds", () => {
    expect(roundLabel(2, 3)).toBe("Final");
    expect(roundLabel(1, 3)).toBe("Semifinal");
    expect(roundLabel(0, 3)).toBe("Quarterfinal");
    expect(roundLabel(0, 4)).toBe("Round 1");
  });
  it("formatDeadline renders a short countdown / past-due", () => {
    const now = 1_000_000;
    expect(formatDeadline(null, now)).toBe("");
    expect(formatDeadline(now - 1, now)).toBe("past due");
    expect(formatDeadline(now + 30 * 60_000, now)).toBe("30m left");
    expect(formatDeadline(now + 2 * 3_600_000 + 15 * 60_000, now)).toBe("2h 15m left");
    expect(formatDeadline(now + 25 * 3_600_000, now)).toBe("1d 1h left");
  });
});

describe("tournament match context — constrained pairing gate", () => {
  afterEach(() => clearTournamentMatchContext());

  it("is inactive by default and accepts any peer", () => {
    expect(isTournamentMatch()).toBe(false);
    expect(getTournamentMatchContext()).toBeNull();
    expect(isTournamentPeerAllowed("anyone")).toBe(true);
  });

  it("accepts ONLY the bracket opponent once a tournament match is set", () => {
    setTournamentMatchContext({ tournamentId: "cup", matchId: "cup-r0-m0", expectedOpponent: "ash" });
    expect(isTournamentMatch()).toBe(true);
    expect(isTournamentPeerAllowed("ash")).toBe(true);
    // RED-PROOF of the opponent constraint: any other peer is rejected.
    expect(isTournamentPeerAllowed("brock")).toBe(false);
    expect(isTournamentPeerAllowed("")).toBe(false);
  });

  it("clears back to accepting any peer", () => {
    setTournamentMatchContext({ tournamentId: "cup", matchId: "cup-r0-m0", expectedOpponent: "ash" });
    clearTournamentMatchContext();
    expect(isTournamentMatch()).toBe(false);
    expect(isTournamentPeerAllowed("brock")).toBe(true);
  });
});
