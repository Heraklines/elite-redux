/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown TOURNAMENT — SERIES (best-of-3 / best-of-5) engine proof. PURE
// worker-domain modules imported by relative path (zero Cloudflare deps — the
// worker-test pattern). Exhaustively covers the Bo3/Bo5 wrapper the client's
// series intermission flow rides on:
//   - per-GAME dual attestation (a game settles only on agreeing reports),
//   - the match CLINCHES (and advances) only when a player reaches wins-to-clinch,
//   - a non-clinching game keeps the match pending (series continues),
//   - the series score tracks per-game wins for the board,
//   - idempotency (duplicate/stale game reports never double-count),
//   - a per-game conflict disputes the match,
//   - RED-PROOFS: a single agreeing game report does NOT clinch a Bo3 (it would
//     under the single-game engine), and a 1-1 Bo3 does not settle.
// =============================================================================

import { describe, expect, it } from "vitest";
import { seriesGameCount, winsNeededForSeries } from "../../../../workers/er-telemetry/src/tournament";
import {
  applySeriesGameReport,
  type Bracket,
  generateBracket,
  type Participant,
  seriesScore,
} from "../../../../workers/er-telemetry/src/tournament-bracket";

const HOUR = 60 * 60 * 1000;
const WINDOW = 24 * HOUR;

/** A 4-field bracket. Seed order for size 4 is [1,4,2,3], so r0-m0 = seed1 vs seed4. */
function bracket4(): Bracket {
  return generateBracket(
    "cup",
    [
      { participant: "alice", seed: 1 },
      { participant: "bob", seed: 4 },
      { participant: "carol", seed: 2 },
      { participant: "dave", seed: 3 },
    ],
    WINDOW,
    0,
  );
}

/** The r0-m0 match id (alice vs bob). */
function m0(bracket: Bracket): string {
  return bracket.rounds[0][0].id;
}

/** Both paired players report the same winner for `gameIndex`; returns the final resolution. */
function bothReport(
  bracket: Bracket,
  id: string,
  a: Participant,
  b: Participant,
  winner: Participant,
  gameIndex: number,
  winsToClinch: number,
  now = 1,
) {
  applySeriesGameReport(bracket, id, a, winner, gameIndex, winsToClinch, now);
  return applySeriesGameReport(bracket, id, b, winner, gameIndex, winsToClinch, now + 1);
}

describe("winsNeededForSeries / seriesGameCount", () => {
  it("single -> 1 win of 1 game; bo3 -> 2 of 3; bo5 -> 3 of 5", () => {
    expect(winsNeededForSeries("single")).toBe(1);
    expect(winsNeededForSeries("bo3")).toBe(2);
    expect(winsNeededForSeries("bo5")).toBe(3);
    expect(seriesGameCount("single")).toBe(1);
    expect(seriesGameCount("bo3")).toBe(3);
    expect(seriesGameCount("bo5")).toBe(5);
  });
});

describe("applySeriesGameReport — per-game dual attestation", () => {
  it("a single agreeing game does NOT settle the match until a player CLINCHES (Bo3)", () => {
    const b = bracket4();
    const id = m0(b);
    const wins = winsNeededForSeries("bo3");

    // Game 0: both report alice.
    const r = bothReport(b, id, "alice", "bob", "alice", 0, wins);
    expect(r.resolution).toBe("pending"); // 1-0 does NOT clinch a Bo3
    const match = b.rounds[0][0];
    expect(match.winner).toBeNull();
    expect(seriesScore(match)).toEqual({ a: 1, b: 0 });
    // The match has NOT advanced.
    expect(b.rounds[1][0].a).toBeNull();
  });

  it("clinches a Bo3 at 2-0 and advances the bracket", () => {
    const b = bracket4();
    const id = m0(b);
    const wins = winsNeededForSeries("bo3");

    bothReport(b, id, "alice", "bob", "alice", 0, wins);
    const r = bothReport(b, id, "alice", "bob", "alice", 1, wins);

    expect(r.resolution).toBe("settled");
    const match = b.rounds[0][0];
    expect(match.winner).toBe("alice");
    expect(match.resolution).toBe("reported");
    expect(seriesScore(match)).toEqual({ a: 2, b: 0 });
    // Alice advances into the final slot.
    expect(b.rounds[1][0].a).toBe("alice");
  });

  it("plays a full Bo3 to 2-1 (game order alice, bob, alice)", () => {
    const b = bracket4();
    const id = m0(b);
    const wins = winsNeededForSeries("bo3");

    expect(bothReport(b, id, "alice", "bob", "alice", 0, wins).resolution).toBe("pending");
    expect(bothReport(b, id, "alice", "bob", "bob", 1, wins).resolution).toBe("pending");
    const match = b.rounds[0][0];
    expect(seriesScore(match)).toEqual({ a: 1, b: 1 }); // 1-1, NOT settled

    expect(bothReport(b, id, "alice", "bob", "alice", 2, wins).resolution).toBe("settled");
    expect(match.winner).toBe("alice");
    expect(seriesScore(match)).toEqual({ a: 2, b: 1 });
  });

  it("clinches a Bo5 at 3-2", () => {
    const b = bracket4();
    const id = m0(b);
    const wins = winsNeededForSeries("bo5");

    // alice, bob, alice, bob, alice -> 3-2 alice.
    for (const [gi, w] of [
      [0, "alice"],
      [1, "bob"],
      [2, "alice"],
      [3, "bob"],
    ] as const) {
      expect(bothReport(b, id, "alice", "bob", w, gi, wins).resolution).toBe("pending");
    }
    const match = b.rounds[0][0];
    expect(seriesScore(match)).toEqual({ a: 2, b: 2 });
    expect(bothReport(b, id, "alice", "bob", "alice", 4, wins).resolution).toBe("settled");
    expect(match.winner).toBe("alice");
    expect(seriesScore(match)).toEqual({ a: 3, b: 2 });
  });

  it("a lone (single-sided) game report never settles the game (dual attestation)", () => {
    const b = bracket4();
    const id = m0(b);
    const wins = winsNeededForSeries("bo3");
    const r = applySeriesGameReport(b, id, "alice", "alice", 0, wins, 1);
    expect(r.resolution).toBe("pending");
    expect(seriesScore(b.rounds[0][0])).toEqual({ a: 0, b: 0 }); // game not settled yet
  });

  it("is idempotent: duplicate + stale reports for a settled game never double-count", () => {
    const b = bracket4();
    const id = m0(b);
    const wins = winsNeededForSeries("bo3");

    bothReport(b, id, "alice", "bob", "alice", 0, wins);
    expect(seriesScore(b.rounds[0][0])).toEqual({ a: 1, b: 0 });

    // Re-report game 0 (both, again) — must not add a second game win.
    bothReport(b, id, "alice", "bob", "alice", 0, wins);
    expect(seriesScore(b.rounds[0][0])).toEqual({ a: 1, b: 0 });
    // A re-report cannot flip a settled game either.
    bothReport(b, id, "alice", "bob", "bob", 0, wins);
    expect(seriesScore(b.rounds[0][0])).toEqual({ a: 1, b: 0 });
  });

  it("a per-game CONFLICT disputes the match", () => {
    const b = bracket4();
    const id = m0(b);
    const wins = winsNeededForSeries("bo3");
    applySeriesGameReport(b, id, "alice", "alice", 0, wins, 1);
    const r = applySeriesGameReport(b, id, "bob", "bob", 0, wins, 2);
    expect(r.resolution).toBe("disputed");
    expect(b.rounds[0][0].disputed).toBe(true);
    expect(b.rounds[0][0].winner).toBeNull();
  });

  it("rejects a non-paired reporter and a non-paired winner", () => {
    const b = bracket4();
    const id = m0(b);
    const wins = winsNeededForSeries("bo3");
    expect(applySeriesGameReport(b, id, "carol", "alice", 0, wins, 1).resolution).toBe("pending");
    expect(applySeriesGameReport(b, id, "alice", "carol", 0, wins, 1).resolution).toBe("pending");
    expect(seriesScore(b.rounds[0][0])).toEqual({ a: 0, b: 0 });
  });

  it("ignores reports once the match is already decided", () => {
    const b = bracket4();
    const id = m0(b);
    const wins = winsNeededForSeries("bo3");
    bothReport(b, id, "alice", "bob", "alice", 0, wins);
    bothReport(b, id, "alice", "bob", "alice", 1, wins); // clinched 2-0
    expect(b.rounds[0][0].winner).toBe("alice");
    // A late game-2 report is a no-op.
    const r = bothReport(b, id, "alice", "bob", "bob", 2, wins);
    expect(r.resolution).toBe("settled");
    expect(seriesScore(b.rounds[0][0])).toEqual({ a: 2, b: 0 });
  });
});

describe("RED-PROOF — series must NOT settle early", () => {
  it("a Bo3 stuck at 1-1 is not decided", () => {
    const b = bracket4();
    const id = m0(b);
    const wins = winsNeededForSeries("bo3");
    bothReport(b, id, "alice", "bob", "alice", 0, wins);
    bothReport(b, id, "alice", "bob", "bob", 1, wins);
    expect(b.rounds[0][0].winner).toBeNull();
    expect(b.rounds[1][0].a).toBeNull(); // no advance
  });
});
