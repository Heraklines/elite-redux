import { describe, expect, it } from "vitest";
// PURE worker-domain module imported by relative path (workers/ is outside the client
// tsconfig, but the module has ZERO Cloudflare deps so it imports cleanly — the
// worker-test pattern from showdown-escrow.test.ts).
import {
  applyResultReport,
  type Bracket,
  champion,
  finalMatch,
  findMatch,
  generateBracket,
  isComplete,
  isPlayable,
  manualResolve,
  nextPowerOfTwo,
  type Participant,
  seedOrder,
} from "../../../../workers/er-telemetry/src/tournament-bracket";

const HOUR = 60 * 60 * 1000;
const WINDOW = 24 * HOUR;

/** Build entrants p1..pN with seeds 1..N. */
function field(n: number): { participant: Participant; seed: number }[] {
  return Array.from({ length: n }, (_, i) => ({ participant: `p${i + 1}`, seed: i + 1 }));
}

/** Every leaf slot's participant (round-0 a,b flattened), byes as null. */
function round0Slots(bracket: Bracket): (Participant | null)[] {
  return bracket.rounds[0].flatMap(m => [m.a, m.b]);
}

describe("nextPowerOfTwo", () => {
  it("rounds up to a power of two", () => {
    expect(nextPowerOfTwo(1)).toBe(1);
    expect(nextPowerOfTwo(2)).toBe(2);
    expect(nextPowerOfTwo(3)).toBe(4);
    expect(nextPowerOfTwo(5)).toBe(8);
    expect(nextPowerOfTwo(8)).toBe(8);
    expect(nextPowerOfTwo(9)).toBe(16);
  });
});

describe("seedOrder (standard bracket ordering)", () => {
  it("places seed 1 and 2 on opposite halves", () => {
    expect(seedOrder(2)).toEqual([1, 2]);
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(seedOrder(16)).toEqual([1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]);
  });
  it("is a permutation of 1..size", () => {
    for (const size of [2, 4, 8, 16, 32]) {
      const order = seedOrder(size);
      expect(order.length).toBe(size);
      expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: size }, (_, i) => i + 1));
    }
  });
});

describe("generateBracket — shape", () => {
  it("builds log2(size) rounds with halving match counts (8 players)", () => {
    const b = generateBracket("t", field(8), WINDOW, 0);
    expect(b.size).toBe(8);
    expect(b.rounds.map(r => r.length)).toEqual([4, 2, 1]);
  });
  it("builds a 16-field with 4 rounds", () => {
    const b = generateBracket("t", field(16), WINDOW, 0);
    expect(b.size).toBe(16);
    expect(b.rounds.map(r => r.length)).toEqual([8, 4, 2, 1]);
  });
  it("seeds so #1 and #2 meet only in the final (8 players)", () => {
    const b = generateBracket("t", field(8), WINDOW, 0);
    // round-0 pairings by the standard order [1,8,4,5,2,7,3,6]
    expect(round0Slots(b)).toEqual(["p1", "p8", "p4", "p5", "p2", "p7", "p3", "p6"]);
  });
  it("sets per-round deadlines off startAt", () => {
    const b = generateBracket("t", field(8), WINDOW, 1000);
    expect(b.rounds[0][0].deadline).toBe(1000 + WINDOW);
    expect(b.rounds[1][0].deadline).toBe(1000 + 2 * WINDOW);
    expect(b.rounds[2][0].deadline).toBe(1000 + 3 * WINDOW);
  });
  it("gives stable match ids", () => {
    const b = generateBracket("cup", field(4), WINDOW, 0);
    expect(b.rounds[0][0].id).toBe("cup-r0-m0");
    expect(b.rounds[0][1].id).toBe("cup-r0-m1");
    expect(b.rounds[1][0].id).toBe("cup-r1-m0");
  });
});

describe("generateBracket — byes to top seeds", () => {
  it("gives byes to the top seeds for a 5-player field (size 8)", () => {
    const b = generateBracket("t", field(5), WINDOW, 0);
    expect(b.size).toBe(8);
    // seeds 6,7,8 are byes -> slots holding them are null
    expect(round0Slots(b)).toEqual(["p1", null, "p4", "p5", "p2", null, "p3", null]);
  });
  it("auto-advances the real player in every bye match (round 0)", () => {
    const b = generateBracket("t", field(5), WINDOW, 0);
    const r0 = b.rounds[0];
    // m0: p1 vs bye -> p1 advances
    expect(r0[0].winner).toBe("p1");
    expect(r0[0].resolution).toBe("bye");
    // m1: p4 vs p5 -> real match, undecided
    expect(r0[1].winner).toBeNull();
    expect(r0[1].resolution).toBe("pending");
    // m2: p2 vs bye -> p2 advances
    expect(r0[2].winner).toBe("p2");
    // m3: p3 vs bye -> p3 advances
    expect(r0[3].winner).toBe("p3");
  });
  it("propagates bye winners into round 1 slots", () => {
    const b = generateBracket("t", field(5), WINDOW, 0);
    // r1 m0 gets p1 (from m0 bye) in slot a; slot b awaits winner(p4 vs p5)
    expect(b.rounds[1][0].a).toBe("p1");
    expect(b.rounds[1][0].b).toBeNull();
    // r1 m1 gets p2 and p3 (both byes) -> becomes immediately playable
    expect(b.rounds[1][1].a).toBe("p2");
    expect(b.rounds[1][1].b).toBe("p3");
    expect(isPlayable(b.rounds[1][1])).toBe(true);
  });
  it("never produces a bye-vs-bye round-1 match (3 players)", () => {
    const b = generateBracket("t", field(3), WINDOW, 0);
    expect(b.size).toBe(4);
    // slots [1,4(bye),2,3] -> m0 p1 vs bye, m1 p2 vs p3
    expect(b.rounds[0][0].winner).toBe("p1");
    expect(b.rounds[0][1].winner).toBeNull();
    // final: p1 already in, awaits winner(p2v3) — not a double bye
    expect(b.rounds[1][0].a).toBe("p1");
    expect(b.rounds[1][0].b).toBeNull();
  });
});

describe("applyResultReport — dual attestation (escrow discipline)", () => {
  it("stays pending on a lone report", () => {
    const b = generateBracket("t", field(4), WINDOW, 0);
    const m = b.rounds[0][0]; // p1 vs p4
    const res = applyResultReport(b, m.id, "p1", "p1", 100);
    expect(res.resolution).toBe("pending");
    expect(m.winner).toBeNull();
    expect(m.reports.length).toBe(1);
  });
  it("settles + advances on AGREEING dual reports", () => {
    const b = generateBracket("t", field(4), WINDOW, 0);
    const m = b.rounds[0][0];
    applyResultReport(b, m.id, "p1", "p1", 100);
    const res = applyResultReport(b, m.id, "p4", "p1", 200);
    expect(res.resolution).toBe("settled");
    expect(m.winner).toBe("p1");
    expect(m.resolution).toBe("reported");
    // advanced into the final slot a
    expect(b.rounds[1][0].a).toBe("p1");
  });
  it("marks disputed on CONFLICTING reports (no winner)", () => {
    const b = generateBracket("t", field(4), WINDOW, 0);
    const m = b.rounds[0][0];
    applyResultReport(b, m.id, "p1", "p1", 100);
    const res = applyResultReport(b, m.id, "p4", "p4", 200);
    expect(res.resolution).toBe("disputed");
    expect(m.disputed).toBe(true);
    expect(m.winner).toBeNull();
    expect(b.rounds[1][0].a).toBeNull();
  });
  it("first report from a player is canonical (re-report does not flip)", () => {
    const b = generateBracket("t", field(4), WINDOW, 0);
    const m = b.rounds[0][0];
    applyResultReport(b, m.id, "p1", "p1", 100);
    applyResultReport(b, m.id, "p1", "p4", 150); // p1 tries to change its call
    expect(m.reports.length).toBe(1);
    expect(m.reports[0].winner).toBe("p1");
    // now p4 agrees with the CANONICAL p1 call -> settles p1
    const res = applyResultReport(b, m.id, "p4", "p1", 200);
    expect(res.resolution).toBe("settled");
    expect(m.winner).toBe("p1");
  });
  it("rejects a report from a non-participant", () => {
    const b = generateBracket("t", field(4), WINDOW, 0);
    const m = b.rounds[0][0]; // p1 vs p4
    const res = applyResultReport(b, m.id, "p2", "p1", 100);
    expect(res.resolution).toBe("pending");
    expect(m.reports.length).toBe(0);
  });
  it("rejects a winner who is not one of the two players", () => {
    const b = generateBracket("t", field(4), WINDOW, 0);
    const m = b.rounds[0][0];
    const res = applyResultReport(b, m.id, "p1", "p2", 100);
    expect(res.resolution).toBe("pending");
    expect(m.reports.length).toBe(0);
  });
  it("is a no-op on an unknown match id", () => {
    const b = generateBracket("t", field(4), WINDOW, 0);
    const res = applyResultReport(b, "nope", "p1", "p1", 100);
    expect(res.resolution).toBe("pending");
  });
  it("is a no-op on an already-decided match", () => {
    const b = generateBracket("t", field(4), WINDOW, 0);
    const m = b.rounds[0][0];
    applyResultReport(b, m.id, "p1", "p1", 100);
    applyResultReport(b, m.id, "p4", "p1", 200); // settled
    const res = applyResultReport(b, m.id, "p1", "p4", 300);
    expect(res.resolution).toBe("settled");
    expect(m.winner).toBe("p1"); // unchanged
  });
  it("cannot report a not-yet-playable match (feeder undecided)", () => {
    const b = generateBracket("t", field(4), WINDOW, 0);
    const finalM = b.rounds[1][0]; // both feeders undecided
    const res = applyResultReport(b, finalM.id, "p1", "p1", 100);
    expect(res.resolution).toBe("pending");
    expect(finalM.reports.length).toBe(0);
  });
});

describe("manualResolve — organizer override", () => {
  it("settles a disputed match and advances", () => {
    const b = generateBracket("t", field(4), WINDOW, 0);
    const m = b.rounds[0][0];
    applyResultReport(b, m.id, "p1", "p1", 100);
    applyResultReport(b, m.id, "p4", "p4", 200); // disputed
    const res = manualResolve(b, m.id, "p4");
    expect(res.resolution).toBe("settled");
    expect(m.winner).toBe("p4");
    expect(m.resolution).toBe("manual");
    expect(m.disputed).toBe(false);
    expect(b.rounds[1][0].a).toBe("p4");
  });
  it("resolves a stalled (no-report) match directly", () => {
    const b = generateBracket("t", field(4), WINDOW, 0);
    const m = b.rounds[0][1]; // p2 vs p3
    const res = manualResolve(b, m.id, "p2");
    expect(res.resolution).toBe("settled");
    expect(m.winner).toBe("p2");
  });
  it("rejects a winner not in the match", () => {
    const b = generateBracket("t", field(4), WINDOW, 0);
    const m = b.rounds[0][0];
    const res = manualResolve(b, m.id, "p3");
    expect(res.resolution).toBe("pending");
    expect(m.winner).toBeNull();
  });
});

describe("full tournament advance + champion", () => {
  it("plays an 8-field to completion", () => {
    const b = generateBracket("t", field(8), WINDOW, 0);
    // helper: settle a playable match for the given winner
    const settle = (id: string, w: Participant) => {
      const m = findMatch(b, id)!;
      applyResultReport(b, m.id, m.a as Participant, w, 1);
      applyResultReport(b, m.id, m.b as Participant, w, 2);
    };
    // round 0: [p1,p8,p4,p5,p2,p7,p3,p6] -> higher seed (lower number) wins
    settle("t-r0-m0", "p1");
    settle("t-r0-m1", "p4");
    settle("t-r0-m2", "p2");
    settle("t-r0-m3", "p3");
    expect(isComplete(b)).toBe(false);
    // round 1: p1 vs p4 -> p1 ; p2 vs p3 -> p2
    settle("t-r1-m0", "p1");
    settle("t-r1-m1", "p2");
    // final: p1 vs p2 -> p1
    expect(isPlayable(finalMatch(b))).toBe(true);
    settle("t-r2-m0", "p1");
    expect(isComplete(b)).toBe(true);
    expect(champion(b)).toBe("p1");
  });
});
