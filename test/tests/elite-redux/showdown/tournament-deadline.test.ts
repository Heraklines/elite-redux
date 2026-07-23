import { describe, expect, it } from "vitest";
// PURE worker-domain module imported by relative path (worker-test pattern; zero CF deps).
// P2 DEADLINE AUTO-RESOLUTION: presence-based activity wins, seed fallback, idempotency.
import {
  applyResultReport,
  applySeriesGameReport,
  type Bracket,
  type BracketMatch,
  generateBracket,
  isComplete,
  type Participant,
  recordPresence,
  resolveExpiredMatches,
  seriesScore,
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

// =============================================================================
// P2 x SERIES composition — an EXPIRED bo3/bo5 with a partial score.
// CHOSEN RULE (flagged): a series with games PLAYED and a STRICT game-score leader
// auto-resolves to that leader ("series"); the no-show forfeits the remaining games.
// A partial series lead is real, played signal and OUTRANKS presence/seed. A TIED or
// unplayed series carries no series signal and falls through to activity/seed. A kick
// (admin elimination) still overrides even a series lead.
// =============================================================================

/** Drive a settled game into a series match via dual attestation (both paired players agree). */
function settleGame(b: Bracket, m: BracketMatch, gameIndex: number, gameWinner: Participant, at: number): void {
  const BO3_CLINCH = 2; // never reached in these partial-lead fixtures
  applySeriesGameReport(b, m.id, m.a as string, gameWinner, gameIndex, BO3_CLINCH, at);
  applySeriesGameReport(b, m.id, m.b as string, gameWinner, gameIndex, BO3_CLINCH, at);
}

describe("resolveExpiredMatches — SERIES lead (expired bo3/bo5 with a partial score)", () => {
  it("advances the game-score LEADER on expiry, outranking the higher seed", () => {
    const b = bracket4();
    const m0 = b.rounds[0][0]; // p1(seed1) vs p4(seed4)
    // p4 (the LOWER seed) wins game 0 -> series 0-1, still unclinched (bo3 needs 2).
    settleGame(b, m0, 0, m0.b as string, 100);
    expect(seriesScore(m0)).toEqual({ a: 0, b: 1 });
    expect(m0.winner).toBeNull(); // not yet clinched
    const { resolved } = resolveExpiredMatches(b, seedOf, WINDOW + 1);
    expect(m0.winner).toBe(m0.b); // the leader (p4) advances, NOT the higher seed p1
    expect(m0.resolution).toBe("series");
    expect(resolved[0]).toMatchObject({ kind: "series", winner: m0.b, eliminated: m0.a, contested: false });
    expect(b.rounds[1][0].a).toBe(m0.b);
  });

  it("series lead OUTRANKS presence: a lone-present TRAILING player does not steal the win", () => {
    const b = bracket4();
    const m0 = b.rounds[0][0]; // p1 vs p4
    settleGame(b, m0, 0, m0.a as string, 100); // p1 leads 1-0
    recordPresence(b, m0.b as string, 200); // p4 (trailing) is the only one present
    const { resolved } = resolveExpiredMatches(b, seedOf, WINDOW + 1);
    expect(m0.winner).toBe(m0.a); // the LEADER wins despite not being the present one
    expect(m0.resolution).toBe("series");
    expect(resolved[0].kind).toBe("series");
  });

  it("a TIED series (1-1) carries no signal -> falls through to seed", () => {
    const b = bracket4();
    const m0 = b.rounds[0][0]; // p1 seed1 vs p4 seed4
    settleGame(b, m0, 0, m0.a as string, 100); // p1 wins g0
    settleGame(b, m0, 1, m0.b as string, 200); // p4 wins g1 -> 1-1
    expect(seriesScore(m0)).toEqual({ a: 1, b: 1 });
    const { resolved } = resolveExpiredMatches(b, seedOf, WINDOW + 1);
    expect(m0.winner).toBe("p1"); // higher seed, seed fallback
    expect(m0.resolution).toBe("seed");
    expect(resolved[0].kind).toBe("seed");
  });

  it("an UNPLAYED series (0-0) is normal presence/seed (no series branch)", () => {
    const b = bracket4();
    const m0 = b.rounds[0][0];
    recordPresence(b, m0.b as string, 100); // lone-present p4 -> activity
    const { resolved } = resolveExpiredMatches(b, seedOf, WINDOW + 1);
    expect(m0.winner).toBe(m0.b);
    expect(m0.resolution).toBe("activity");
    expect(resolved[0].kind).toBe("activity");
  });

  it("a KICK still overrides a series lead (admin elimination wins)", () => {
    const b = bracket4();
    const m0 = b.rounds[0][0]; // p1 vs p4
    settleGame(b, m0, 0, m0.a as string, 100); // p1 leads 1-0
    b.kicked = [m0.a as string]; // ...but p1 is kicked
    const { resolved } = resolveExpiredMatches(b, seedOf, WINDOW + 1);
    expect(m0.winner).toBe(m0.b); // the kicked leader loses; opponent walks over
    expect(m0.resolution).toBe("walkover");
    expect(resolved[0].kind).toBe("walkover");
  });

  it("is idempotent — a resolved series match is not re-resolved on a later read", () => {
    const b = bracket4();
    const m0 = b.rounds[0][0];
    settleGame(b, m0, 0, m0.b as string, 100); // p4 leads 1-0
    const first = resolveExpiredMatches(b, seedOf, WINDOW + 1);
    expect(first.resolved.some(r => r.matchId === m0.id)).toBe(true);
    const second = resolveExpiredMatches(b, seedOf, WINDOW + 10 * HOUR);
    expect(second.resolved.some(r => r.matchId === m0.id)).toBe(false);
    expect(m0.resolution).toBe("series");
  });
});
