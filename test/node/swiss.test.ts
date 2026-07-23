/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Node-lane pure tests for the SWISS tournament engine (Showdown Tournament P3).
// swiss.ts only type-imports the bracket engine (erased at runtime), so its
// import graph is engine/DOM-free -> runs in milliseconds in the node project.
// Pins the correctness-critical invariants: round count, adjacent-score +
// no-rematch pairing (with the forced-rematch fallback), bye assignment/rotation,
// result/bye accounting, and the standings sort (wins -> OW% -> seed).
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  applySwissBye,
  applySwissResult,
  computeStandings,
  freshSwissRecord,
  opponentWinPct,
  pairSwissRound,
  type SwissPairing,
  type SwissRecord,
  swissChampion,
  swissRoundCount,
} from "../../workers/er-telemetry/src/swiss";

/** Build a fresh field p1..pN with seeds 1..N. */
function field(n: number): SwissRecord[] {
  return Array.from({ length: n }, (_, i) => freshSwissRecord(`p${i + 1}`, i + 1));
}

/** Normalize a pairing to an unordered key so {a,b} and {b,a} compare equal. */
function pairKey(p: SwissPairing): string {
  return [p.a, p.b].sort().join("|");
}

describe("swissRoundCount", () => {
  it("is ceil(log2(n)) with a floor of 1 for a real field, 0 for <=1", () => {
    expect(swissRoundCount(0)).toBe(0);
    expect(swissRoundCount(1)).toBe(0);
    expect(swissRoundCount(2)).toBe(1);
    expect(swissRoundCount(4)).toBe(2);
    expect(swissRoundCount(5)).toBe(3); // ceil(log2 5)=3
    expect(swissRoundCount(8)).toBe(3);
    expect(swissRoundCount(9)).toBe(4);
    expect(swissRoundCount(16)).toBe(4);
    expect(swissRoundCount(64)).toBe(6);
  });
});

describe("pairSwissRound — round 1 (all 0-0)", () => {
  it("pairs adjacent seeds with no bye on an even field", () => {
    const round = pairSwissRound(field(4));
    expect(round.bye).toBeNull();
    // all 0-0 -> standings order is seed order p1,p2,p3,p4 -> adjacent pairs (p1,p2),(p3,p4)
    expect(round.pairings.map(pairKey).sort()).toEqual(["p1|p2", "p3|p4"]);
  });

  it("gives the LOWEST-ranked player the bye on an odd field", () => {
    const round = pairSwissRound(field(5));
    expect(round.bye).toBe("p5"); // lowest seed, all 0-0
    expect(round.pairings).toHaveLength(2);
    // the byed player appears in no pairing
    expect(round.pairings.flatMap(p => [p.a, p.b])).not.toContain("p5");
  });
});

describe("applySwissResult / applySwissBye — accounting", () => {
  it("credits a win/loss and records the mutual opponent", () => {
    const recs = applySwissResult(field(2), "p1", "p2");
    const p1 = recs.find(r => r.participant === "p1")!;
    const p2 = recs.find(r => r.participant === "p2")!;
    expect(p1).toMatchObject({ wins: 1, losses: 0, opponents: ["p2"] });
    expect(p2).toMatchObject({ wins: 0, losses: 1, opponents: ["p1"] });
  });

  it("is idempotent — re-reporting the same pairing does not double-count", () => {
    let recs = applySwissResult(field(2), "p1", "p2");
    recs = applySwissResult(recs, "p1", "p2");
    expect(recs.find(r => r.participant === "p1")!.wins).toBe(1);
    expect(recs.find(r => r.participant === "p2")!.losses).toBe(1);
    expect(recs.find(r => r.participant === "p1")!.opponents).toEqual(["p2"]);
  });

  it("a bye is a free win + a bye tally, with no opponent added", () => {
    const recs = applySwissBye(field(3), "p3");
    const p3 = recs.find(r => r.participant === "p3")!;
    expect(p3).toMatchObject({ wins: 1, byes: 1, opponents: [] });
  });
});

describe("pairSwissRound — no rematch while a rematch-free pairing exists", () => {
  it("round 2 never repeats a round-1 pairing (4 players)", () => {
    const r1 = pairSwissRound(field(4)); // (p1,p2),(p3,p4)
    // p1 and p3 win their matches.
    let recs = field(4);
    recs = applySwissResult(recs, "p1", "p2");
    recs = applySwissResult(recs, "p3", "p4");
    const r2 = pairSwissRound(recs);
    const r1keys = new Set(r1.pairings.map(pairKey));
    // winners (p1,p3 at 1-0) pair each other; losers (p2,p4 at 0-1) pair each other -> no repeat
    for (const p of r2.pairings) {
      expect(r1keys.has(pairKey(p))).toBe(false);
    }
    expect(r2.pairings.map(pairKey).sort()).toEqual(["p1|p3", "p2|p4"]);
  });

  it("falls back to a rematch only when no rematch-free pairing remains (2 players)", () => {
    let recs = field(2);
    recs = applySwissResult(recs, "p1", "p2"); // they have now played
    const r2 = pairSwissRound(recs); // only two players -> the sole pairing is a forced rematch
    expect(r2.pairings.map(pairKey)).toEqual(["p1|p2"]);
    expect(r2.bye).toBeNull();
  });
});

describe("pairSwissRound — bye rotation", () => {
  it("does not give a second bye while a player without one is available", () => {
    // p5 took the bye in round 1; after a round everyone else has played.
    let recs = field(5);
    recs = applySwissBye(recs, "p5");
    recs = applySwissResult(recs, "p1", "p2");
    recs = applySwissResult(recs, "p3", "p4");
    const r2 = pairSwissRound(recs);
    // 5 players, odd -> someone byes, but NOT p5 (already had one)
    expect(r2.bye).not.toBe("p5");
    expect(r2.bye).not.toBeNull();
  });
});

describe("computeStandings + opponentWinPct — sort + tiebreak", () => {
  it("sorts by wins DESC first", () => {
    let recs = field(4);
    recs = applySwissResult(recs, "p1", "p2");
    recs = applySwissResult(recs, "p1", "p3"); // p1 2-0 (contrived: two wins)
    const standings = computeStandings(recs);
    expect(standings[0].record.participant).toBe("p1");
    expect(standings[0].rank).toBe(1);
  });

  it("breaks a win tie by OPPONENTS' win % (tougher field ranks higher)", () => {
    // Two 1-0 players; p1 beat a strong opponent, p3 beat a weak one.
    let recs = field(4); // p1,p2,p3,p4
    // p2 (p1's victim) also wins its other game -> strong opponent (mwp high)
    // p4 (p3's victim) also loses its other game -> weak opponent (mwp low)
    recs = applySwissResult(recs, "p1", "p2"); // p1 1-0, p2 0-1
    recs = applySwissResult(recs, "p3", "p4"); // p3 1-0, p4 0-1
    recs = applySwissResult(recs, "p2", "p4"); // p2 -> 1-1, p4 -> 0-2
    // now p1 and p3 are both 1-0. p1's opp is p2 (1-1 => mwp .5); p3's opp is p4 (0-2 => floor .333)
    const byId = new Map(recs.map(r => [r.participant, r]));
    const p1owp = opponentWinPct(byId.get("p1")!, byId);
    const p3owp = opponentWinPct(byId.get("p3")!, byId);
    expect(p1owp).toBeGreaterThan(p3owp);
    const standings = computeStandings(recs);
    const p1rank = standings.find(s => s.record.participant === "p1")!.rank;
    const p3rank = standings.find(s => s.record.participant === "p3")!.rank;
    expect(p1rank).toBeLessThan(p3rank); // p1 ranks above p3 on OW%
  });

  it("applies the 1/3 match-win-percentage floor in OW%", () => {
    // p1 beat p2; p2 has an 0-1 record (mwp would be 0 but floors to 1/3).
    const recs = applySwissResult(field(2), "p1", "p2");
    const byId = new Map(recs.map(r => [r.participant, r]));
    expect(opponentWinPct(byId.get("p1")!, byId)).toBeCloseTo(1 / 3, 6);
  });

  it("breaks a full tie (wins + OW%) by seed, lower seed first", () => {
    const recs = field(4); // all 0-0, no opponents -> OW% 0 for all
    const standings = computeStandings(recs);
    expect(standings.map(s => s.record.participant)).toEqual(["p1", "p2", "p3", "p4"]);
  });
});

describe("swissChampion + a full 4-player, 2-round simulation", () => {
  it("crowns the standings leader after the final round", () => {
    let recs = field(4);
    // Round 1: pair + play
    const r1 = pairSwissRound(recs);
    expect(r1.pairings.map(pairKey).sort()).toEqual(["p1|p2", "p3|p4"]);
    recs = applySwissResult(recs, "p1", "p2");
    recs = applySwissResult(recs, "p3", "p4");
    // Round 2: winners meet, losers meet
    const r2 = pairSwissRound(recs);
    expect(r2.pairings.map(pairKey).sort()).toEqual(["p1|p3", "p2|p4"]);
    recs = applySwissResult(recs, "p1", "p3"); // p1 2-0
    recs = applySwissResult(recs, "p2", "p4"); // p2 1-1
    const standings = computeStandings(recs);
    expect(standings.map(s => s.record.participant)[0]).toBe("p1");
    expect(standings[0].record.wins).toBe(2);
    expect(swissChampion(recs)).toBe("p1");
    // Every player played exactly 2 distinct opponents (no rematch across the run).
    for (const r of recs) {
      expect(new Set(r.opponents).size).toBe(r.opponents.length);
      expect(r.opponents.length).toBe(2);
    }
  });

  it("champion is null for an empty field", () => {
    expect(swissChampion([])).toBeNull();
  });
});

describe("pairSwissRound — no-rematch holds across a full odd-field run", () => {
  it("5 players, 3 rounds: no pairing repeats until forced, byes rotate", () => {
    let recs = field(5);
    const seenPairings = new Set<string>();
    const byeHolders = new Set<string>();
    for (let round = 0; round < 3; round++) {
      const r = pairSwissRound(recs);
      if (r.bye) {
        byeHolders.add(r.bye);
        recs = applySwissBye(recs, r.bye);
      }
      for (const p of r.pairings) {
        // A rematch-free pairing must be unique across rounds (5 players over 3 rounds has room).
        expect(seenPairings.has(pairKey(p))).toBe(false);
        seenPairings.add(pairKey(p));
        // deterministically: lower current standing wins
        const st = computeStandings(recs);
        const rankOf = (x: string) => st.find(s => s.record.participant === x)!.rank;
        const [w, l] = rankOf(p.a) < rankOf(p.b) ? [p.a, p.b] : [p.b, p.a];
        recs = applySwissResult(recs, w, l);
      }
    }
    // Three distinct players took the three byes (odd field, no double-bye while avoidable).
    expect(byeHolders.size).toBe(3);
    const champ = swissChampion(recs);
    expect(champ).not.toBeNull();
  });
});
