import { describe, expect, it } from "vitest";
// PURE worker-domain module imported by relative path (worker-test pattern; zero CF deps).
// P2 DEADLINE AUTO-RESOLUTION: presence-based activity wins, seed fallback, idempotency.
import {
  applyResultReport,
  type Bracket,
  generateBracket,
  isComplete,
  type Participant,
  recordPresence,
  resolveExpiredMatches,
  wasPresent,
} from "../../../../workers/er-telemetry/src/tournament-bracket";

const HOUR = 60 * 60 * 1000;
const WINDOW = 24 * HOUR;

/** Build entrants p1..pN with seeds 1..N (p1 = top seed). */
function field(n: number): { participant: Participant; seed: number }[] {
  return Array.from({ length: n }, (_, i) => ({ participant: `p${i + 1}`, seed: i + 1 }));
}

/** Seed lookup for a field where pK has seed K. */
const seedOf = (p: Participant): number | null => {
  const m = /^p(\d+)$/.exec(p);
  return m ? Number(m[1]) : null;
};

/** A fresh 4-field bracket started at t=0; round-0 deadline is WINDOW. */
function bracket4(): Bracket {
  return generateBracket("cup", field(4), WINDOW, 0);
}

describe("recordPresence — per-window aggregate", () => {
  it("stamps a paired player onto their open (undecided, within-window) match", () => {
    const b = bracket4();
    const m0 = b.rounds[0][0]; // p1 vs p4
    const changed = recordPresence(b, m0.a as string, WINDOW - 1); // before deadline
    expect(changed).toBe(true);
    expect(wasPresent(m0, m0.a)).toBe(true);
    expect(wasPresent(m0, m0.b)).toBe(false);
  });

  it("is idempotent — a repeat ping does not double-add or report a change", () => {
    const b = bracket4();
    const m0 = b.rounds[0][0];
    expect(recordPresence(b, m0.a as string, 100)).toBe(true);
    expect(recordPresence(b, m0.a as string, 200)).toBe(false);
    expect(m0.present).toEqual([m0.a]);
  });

  it("does NOT stamp once the window has expired (now > deadline)", () => {
    const b = bracket4();
    const m0 = b.rounds[0][0];
    expect(recordPresence(b, m0.a as string, WINDOW + 1)).toBe(false);
    expect(m0.present ?? []).toEqual([]);
  });

  it("does NOT stamp a non-participant", () => {
    const b = bracket4();
    expect(recordPresence(b, "stranger", 100)).toBe(false);
  });
});

describe("resolveExpiredMatches — activity win (exactly one present)", () => {
  it("awards the ONLY present player when the window expires", () => {
    const b = bracket4();
    const m0 = b.rounds[0][0]; // p1(seed1) vs p4(seed4)
    // the LOWER seed (p4) is present, the higher seed (p1) is not -> presence beats seed
    recordPresence(b, m0.b as string, 100);
    const { resolved } = resolveExpiredMatches(b, seedOf, WINDOW + 1);
    expect(m0.winner).toBe(m0.b);
    expect(m0.resolution).toBe("activity");
    const m0res = resolved.find(r => r.matchId === m0.id);
    expect(m0res).toMatchObject({ matchId: m0.id, winner: m0.b, kind: "activity", eliminated: m0.a });
    // winner advanced into the final slot
    expect(b.rounds[1][0].a).toBe(m0.b);
  });
});

describe("resolveExpiredMatches — seed fallback (neither present)", () => {
  it("advances the HIGHER seed (lower seed number) when neither showed up", () => {
    const b = bracket4();
    const m0 = b.rounds[0][0]; // p1 seed1 vs p4 seed4
    const { resolved } = resolveExpiredMatches(b, seedOf, WINDOW + 1);
    expect(m0.winner).toBe("p1"); // seed 1 beats seed 4
    expect(m0.resolution).toBe("seed");
    expect(resolved[0]).toMatchObject({ kind: "seed", winner: "p1", contested: false });
  });
});

describe("resolveExpiredMatches — both present, no result (design call: seed, flagged)", () => {
  it("advances the higher seed and FLAGS the resolution contested", () => {
    const b = bracket4();
    const m0 = b.rounds[0][0]; // p1 vs p4
    recordPresence(b, m0.a as string, 100);
    recordPresence(b, m0.b as string, 100);
    const { resolved } = resolveExpiredMatches(b, seedOf, WINDOW + 1);
    expect(m0.winner).toBe("p1"); // higher seed
    expect(m0.resolution).toBe("seed");
    expect(resolved[0].contested).toBe(true);
  });
});

describe("resolveExpiredMatches — idempotency (red-proof)", () => {
  it("never re-resolves an already-decided match on a later read", () => {
    const b = bracket4();
    const m0 = b.rounds[0][0];
    recordPresence(b, m0.b as string, 100); // p4 present -> activity win
    const first = resolveExpiredMatches(b, seedOf, WINDOW + 1);
    expect(first.resolved.some(r => r.matchId === m0.id)).toBe(true);
    const winnerAfterFirst = m0.winner;
    // a SECOND read far later, with the OTHER player now marked present, must not flip or re-report.
    const second = resolveExpiredMatches(b, seedOf, WINDOW + 10 * HOUR);
    expect(second.resolved).toHaveLength(0);
    expect(m0.winner).toBe(winnerAfterFirst);
    expect(m0.resolution).toBe("activity");
  });

  it("never touches a match settled by a real reported result", () => {
    const b = bracket4();
    const m0 = b.rounds[0][0];
    applyResultReport(b, m0.id, m0.a as string, m0.a as string, 10);
    applyResultReport(b, m0.id, m0.b as string, m0.a as string, 20); // settled reported -> p_a wins
    const { resolved } = resolveExpiredMatches(b, seedOf, WINDOW + 1);
    // m0 was already reported -> the resolver must not touch it (m1 still auto-resolves).
    expect(resolved.some(r => r.matchId === m0.id)).toBe(false);
    expect(m0.resolution).toBe("reported");
  });
});

describe("resolveExpiredMatches — window not expired", () => {
  it("is a no-op while the window is still open", () => {
    const b = bracket4();
    const { resolved } = resolveExpiredMatches(b, seedOf, WINDOW - 1);
    expect(resolved).toHaveLength(0);
    expect(b.rounds[0][0].winner).toBeNull();
  });
});

describe("resolveExpiredMatches — multi-round cascade (long-abandoned tournament)", () => {
  it("resolves both rounds in one pass when both windows have expired", () => {
    const b = bracket4();
    // no presence anywhere -> seed advances throughout. Read well past the FINAL deadline (2*WINDOW).
    const { resolved } = resolveExpiredMatches(b, seedOf, 2 * WINDOW + 1);
    // round-0 m0 (p1 v p4 -> p1), m1 (p2 v p3 -> p2), final (p1 v p2 -> p1)
    expect(resolved.map(r => r.matchId)).toEqual(["cup-r0-m0", "cup-r0-m1", "cup-r1-m0"]);
    expect(isComplete(b)).toBe(true);
    expect(b.rounds[1][0].winner).toBe("p1");
  });
});

describe("resolveExpiredMatches — kicked-player safety net", () => {
  it("walks the opponent over a kicked player at the deadline (not a seed/activity call)", () => {
    const b = bracket4();
    const m0 = b.rounds[0][0]; // p1 vs p4
    b.kicked = [m0.a as string]; // p1 kicked but their match never got the fixpoint (opponent arrived late)
    const { resolved } = resolveExpiredMatches(b, seedOf, WINDOW + 1);
    expect(m0.winner).toBe(m0.b);
    expect(m0.resolution).toBe("walkover");
    expect(resolved[0].kind).toBe("walkover");
  });
});
