/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown TOURNAMENT bracket engine — PURE domain (Showdown Tournament P1).
// Zero Cloudflare deps and zero client deps: a single-elimination bracket over
// plain records, so it imports cleanly into a plain vitest (the worker-test
// pattern from showdown-escrow) AND its SHAPE is re-declared client-side for
// rendering (the worker cannot import client code, the client cannot import the
// worker build — see showdown-stakes ↔ showdown-escrow). ALL decision logic
// lives HERE so it is exhaustively unit-testable.
//
// FORMAT (locked, design doc 2026-07-14): SINGLE ELIMINATION, byes for
// non-power-of-2 fields. Seeds place #1 and #2 on opposite halves (standard
// bracket ordering); byes go to the TOP seeds. The bracket ADVANCE is
// server-authoritative — clients render what the worker says.
//
// PARTICIPANT identity is a stable string (the account USERNAME, the token `u`)
// — the same key escrow uses. `null` in a slot means BYE / TBD.
//
// ATTESTATION (design doc "result report ... same attestation the escrow flow
// uses"): a match result settles ONLY from AGREEING reports by BOTH paired
// accounts, or an organizer override. A lone report stays pending (P1 resolves a
// stalled match via the organizer route; P2 adds presence-based activity wins).
// =============================================================================

/** A participant is an account username (the token `u`) — mirrors escrow's `Participant`. */
export type Participant = string;

/** How a match's winner was decided. */
export type MatchResolution =
  | "pending" // no winner yet
  | "bye" // auto-advanced (single real player, opponent was a bye)
  | "reported" // settled by AGREEING dual attestation from both paired accounts
  | "manual"; // settled by an organizer override

/** One player's attestation of a match outcome, with the epoch-ms it first arrived. */
export interface MatchReport {
  reporter: Participant;
  winner: Participant;
  /** Epoch ms of the FIRST report from this reporter (re-reports keep this fixed). */
  at: number;
}

/** One bracket match. `a`/`b` are participants or null (bye/TBD). */
export interface BracketMatch {
  /** Stable id: `${tournamentId}-r${round}-m${slot}` (round + slot both 0-based). */
  id: string;
  /** 0-based round index (0 = first round). */
  round: number;
  /** 0-based slot within the round. */
  slot: number;
  a: Participant | null;
  b: Participant | null;
  /** The winner's participant id, or null while undecided. */
  winner: Participant | null;
  resolution: MatchResolution;
  /** Epoch ms this match must be played by (per-round window), or null. */
  deadline: number | null;
  /** Dual-attestation reports (at most one per paired account). */
  reports: MatchReport[];
  /** True once the two reports CONFLICT — needs an organizer manual resolve. */
  disputed: boolean;
}

/** A single-elimination bracket: rounds[0] is the first round. */
export interface Bracket {
  /** 2^k slots (the padded field size). */
  size: number;
  /** rounds[r] holds the matches of round r; the last round is the final (1 match). */
  rounds: BracketMatch[][];
}

/** The result of applying a report / resolve to a match. */
export type ReportResolution = "pending" | "settled" | "disputed";

export interface ApplyReportResult {
  bracket: Bracket;
  resolution: ReportResolution;
  /** The match id that was affected (echo for the caller/persistence). */
  matchId: string;
}

/** Smallest power of two >= n (min 1). */
export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) {
    p *= 2;
  }
  return p;
}

/**
 * Standard single-elimination SEED ORDER for a bracket of `size` slots. Returns an
 * array of seed NUMBERS (1-based): the seed that occupies each slot 0..size-1, so
 * that seed 1 and seed 2 can only meet in the final and higher seeds are spread
 * across the halves. E.g. size 4 -> [1,4,2,3]; size 8 -> [1,8,4,5,2,7,3,6].
 */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    const next: number[] = [];
    for (const s of order) {
      next.push(s);
      next.push(n + 1 - s);
    }
    order = next;
  }
  return order;
}

/** The parent (next-round) match a given match feeds, plus which slot it fills. */
function parentOf(round: number, slot: number): { round: number; slot: number; side: "a" | "b" } {
  return { round: round + 1, slot: Math.floor(slot / 2), side: slot % 2 === 0 ? "a" : "b" };
}

function matchId(tournamentId: string, round: number, slot: number): string {
  return `${tournamentId}-r${round}-m${slot}`;
}

/**
 * Generate a fresh single-elimination bracket. `entrants` MUST already carry a
 * unique 1-based `seed` (1 = top). Byes are assigned to the top seeds. Round-1
 * bye matches auto-advance their single real player; deadlines are per-round
 * windows off `startAt`.
 */
export function generateBracket(
  tournamentId: string,
  entrants: { participant: Participant; seed: number }[],
  roundWindowMs: number,
  startAt: number,
): Bracket {
  const n = entrants.length;
  const size = Math.max(2, nextPowerOfTwo(n));
  const rounds = Math.log2(size);

  // seed number -> participant (seeds beyond n are byes / undefined)
  const bySeed = new Map<number, Participant>();
  for (const e of entrants) {
    bySeed.set(e.seed, e.participant);
  }
  const order = seedOrder(size);
  const slotParticipant = order.map(seed => bySeed.get(seed) ?? null);

  const bracket: Bracket = { size, rounds: [] };
  for (let r = 0; r < rounds; r++) {
    const count = size / 2 ** (r + 1);
    const roundMatches: BracketMatch[] = [];
    for (let m = 0; m < count; m++) {
      roundMatches.push({
        id: matchId(tournamentId, r, m),
        round: r,
        slot: m,
        a: r === 0 ? slotParticipant[m * 2] : null,
        b: r === 0 ? slotParticipant[m * 2 + 1] : null,
        winner: null,
        resolution: "pending",
        deadline: startAt + (r + 1) * roundWindowMs,
        reports: [],
        disputed: false,
      });
    }
    bracket.rounds.push(roundMatches);
  }

  // Resolve round-0 byes and propagate the auto-advances forward.
  for (const match of bracket.rounds[0]) {
    const aReal = match.a !== null;
    const bReal = match.b !== null;
    if (aReal !== bReal) {
      // exactly one real player -> bye advance
      setWinner(bracket, match, (aReal ? match.a : match.b) as Participant, "bye");
    }
  }
  return bracket;
}

/** Internal: set a match winner, mark resolution, and feed the parent slot. */
function setWinner(bracket: Bracket, match: BracketMatch, winner: Participant, resolution: MatchResolution): void {
  match.winner = winner;
  match.resolution = resolution;
  const last = bracket.rounds.length - 1;
  if (match.round >= last) {
    return; // final — nothing to feed
  }
  const p = parentOf(match.round, match.slot);
  const parent = bracket.rounds[p.round][p.slot];
  if (p.side === "a") {
    parent.a = winner;
  } else {
    parent.b = winner;
  }
}

/** Find a match by id, or null. */
export function findMatch(bracket: Bracket, id: string): BracketMatch | null {
  for (const round of bracket.rounds) {
    for (const match of round) {
      if (match.id === id) {
        return match;
      }
    }
  }
  return null;
}

/** True once both feeder participants of a match are known (ready to play). */
export function isPlayable(match: BracketMatch): boolean {
  return match.a !== null && match.b !== null && match.winner === null;
}

/** The final match (last round, slot 0). */
export function finalMatch(bracket: Bracket): BracketMatch {
  const lastRound = bracket.rounds.at(-1);
  if (lastRound === undefined) {
    throw new Error("bracket has no rounds");
  }
  return lastRound[0];
}

/** The champion once the final is decided, else null. */
export function champion(bracket: Bracket): Participant | null {
  return finalMatch(bracket).winner;
}

/** True once the whole bracket is decided. */
export function isComplete(bracket: Bracket): boolean {
  return champion(bracket) !== null;
}

/**
 * Apply one player's result report (dual attestation, escrow discipline). Rules:
 *  - match must exist, be PLAYABLE (both players known, undecided) — else no-op pending.
 *  - reporter must be one of the two paired players; winner must be one of them.
 *  - FIRST report from a player is canonical (a re-report keeps the first `winner`/`at`).
 *  - BOTH players reported AND AGREE -> settle ("reported") + advance.
 *  - BOTH reported but CONFLICT -> `disputed` (stays pending; organizer must resolve).
 *  - ONE report -> pending (P1: peer must agree, or the organizer resolves the deadline).
 * Mutates the passed bracket in place and returns it.
 */
export function applyResultReport(
  bracket: Bracket,
  id: string,
  reporter: Participant,
  winner: Participant,
  now: number,
): ApplyReportResult {
  const match = findMatch(bracket, id);
  if (match === null || match.winner !== null || match.a === null || match.b === null) {
    return { bracket, resolution: match?.winner ? "settled" : "pending", matchId: id };
  }
  const isPlayer = reporter === match.a || reporter === match.b;
  const winnerIsPlayer = winner === match.a || winner === match.b;
  if (!isPlayer || !winnerIsPlayer) {
    return { bracket, resolution: "pending", matchId: id };
  }

  // Record the report (first from this reporter is canonical).
  if (!match.reports.some(r => r.reporter === reporter)) {
    match.reports.push({ reporter, winner, at: now });
  }

  const reportA = match.reports.find(r => r.reporter === match.a);
  const reportB = match.reports.find(r => r.reporter === match.b);
  if (reportA && reportB) {
    if (reportA.winner === reportB.winner) {
      setWinner(bracket, match, reportA.winner, "reported");
      return { bracket, resolution: "settled", matchId: id };
    }
    match.disputed = true;
    return { bracket, resolution: "disputed", matchId: id };
  }
  return { bracket, resolution: "pending", matchId: id };
}

/**
 * Organizer manual resolve (disputes, deadline no-shows). Sets the winner
 * directly and advances, regardless of reports. `winner` MUST be one of the two
 * paired players. Mutates + returns the bracket.
 */
export function manualResolve(bracket: Bracket, id: string, winner: Participant): ApplyReportResult {
  const match = findMatch(bracket, id);
  if (match === null || match.winner !== null || match.a === null || match.b === null) {
    return { bracket, resolution: match?.winner ? "settled" : "pending", matchId: id };
  }
  if (winner !== match.a && winner !== match.b) {
    return { bracket, resolution: "pending", matchId: id };
  }
  match.disputed = false;
  setWinner(bracket, match, winner, "manual");
  return { bracket, resolution: "settled", matchId: id };
}
