/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown TOURNAMENT — SWISS format engine (Showdown Tournament P3). PURE
// domain: zero Cloudflare deps and zero client deps (the worker-test pattern),
// so every decision is exhaustively unit-testable and the SHAPE re-declares
// client-side for rendering the standings board.
//
// SWISS (as opposed to the single-elimination bracket in tournament-bracket.ts):
// a FIXED number of rounds; nobody is eliminated. Each round pairs players of
// ADJACENT score (equal-or-nearest win count), NEVER repeating a pairing while a
// rematch-free pairing still exists. An odd field gives ONE player a bye (a free
// win) — the lowest-ranked player who has not already had one. After the last
// round the CHAMPION is the top of the STANDINGS (wins, then opponents' win %
// (OW%, Buchholz-style), then seed).
//
// PARTICIPANT identity is the account USERNAME string — the same key the bracket
// engine and escrow use.
// =============================================================================

import type { Participant } from "./tournament-bracket";

/** Standard Swiss round count for `n` entrants: ceil(log2(n)) (min 1). Everyone plays every round. */
export function swissRoundCount(entrants: number): number {
  if (entrants <= 1) {
    return 0;
  }
  return Math.max(1, Math.ceil(Math.log2(entrants)));
}

/**
 * One player's running Swiss record. `opponents` is every participant they have ALREADY been paired
 * against (drives no-rematch pairing + the OW% tiebreak); a bye is counted in `byes` (and as a win),
 * not as an opponent. Additive/serializable — persisted on the tournament like the bracket.
 */
export interface SwissRecord {
  participant: Participant;
  /** 1-based initial seed (the last-resort tiebreak; lower = better). */
  seed: number;
  /** Match wins, INCLUDING byes. */
  wins: number;
  /** Match losses. */
  losses: number;
  /** Byes received (standard Swiss gives a player at most one). */
  byes: number;
  /** Participants already paired against (no-rematch + OW% source). */
  opponents: Participant[];
}

/** One pairing produced for a Swiss round. */
export interface SwissPairing {
  a: Participant;
  b: Participant;
}

/** The pairings + optional bye for one Swiss round. */
export interface SwissRound {
  pairings: SwissPairing[];
  /** The player who received a bye this round (a free win), or null for an even field. */
  bye: Participant | null;
}

/** A fresh record for a participant with the given seed (0-0, no byes, no opponents). */
export function freshSwissRecord(participant: Participant, seed: number): SwissRecord {
  return { participant, seed, wins: 0, losses: 0, byes: 0, opponents: [] };
}

/** Total decided matches a player has (wins + losses, byes fold into wins). */
function played(r: SwissRecord): number {
  return r.wins + r.losses;
}

/**
 * A player's MATCH-WIN percentage for the OW% tiebreak: wins / games, with a conventional 1/3 FLOOR
 * (a player with an ugly record can't drag their opponents' tiebreak below 0.333 — the MtG rule). A
 * player who has not yet played counts as exactly the floor.
 */
function matchWinPct(r: SwissRecord): number {
  const g = played(r);
  if (g === 0) {
    return 1 / 3;
  }
  return Math.max(1 / 3, r.wins / g);
}

/**
 * Opponents' Win % (OW%, Buchholz-style): the AVERAGE match-win percentage of every opponent this
 * player has faced (byes contribute no opponent). Zero when they have faced nobody yet. This is the
 * primary Swiss tiebreak — it rewards a player whose wins came against a tougher field.
 */
export function opponentWinPct(record: SwissRecord, byParticipant: Map<Participant, SwissRecord>): number {
  if (record.opponents.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const opp of record.opponents) {
    const or = byParticipant.get(opp);
    sum += or ? matchWinPct(or) : 1 / 3;
  }
  return sum / record.opponents.length;
}

/** A standings row: the record plus its computed OW% and final rank (1-based). */
export interface SwissStanding {
  record: SwissRecord;
  /** Opponents' win percentage (the primary tiebreak), 0..1. */
  owp: number;
  /** 1-based placement after sorting. */
  rank: number;
}

/**
 * Final (or interim) STANDINGS: sort by wins DESC, then OW% DESC, then seed ASC (lower seed wins the
 * last tie). Returns a ranked list; `standings[0]` is the leader / champion. Pure over a snapshot of
 * records — safe to call every read.
 */
export function computeStandings(records: readonly SwissRecord[]): SwissStanding[] {
  const byParticipant = new Map<Participant, SwissRecord>();
  for (const r of records) {
    byParticipant.set(r.participant, r);
  }
  const rows = records.map(record => ({ record, owp: opponentWinPct(record, byParticipant), rank: 0 }));
  rows.sort((x, y) => {
    if (y.record.wins !== x.record.wins) {
      return y.record.wins - x.record.wins;
    }
    if (y.owp !== x.owp) {
      return y.owp - x.owp;
    }
    return x.record.seed - y.record.seed;
  });
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });
  return rows;
}

/** The Swiss CHAMPION: the top of the final standings (null for an empty field). */
export function swissChampion(records: readonly SwissRecord[]): Participant | null {
  const standings = computeStandings(records);
  return standings.length > 0 ? standings[0].record.participant : null;
}

/** True if `a` and `b` have already been paired (would be a rematch). */
function isRematch(a: SwissRecord, b: SwissRecord): boolean {
  return a.opponents.includes(b.participant);
}

/**
 * Backtracking perfect-matching over an EVEN, standings-ordered list: pair the highest unpaired player
 * with each candidate in adjacency order (closest score first), recursing on the rest; backtrack when
 * the remainder can't be completed. `allowRematch=false` first (skips prior opponents) so a rematch is
 * only ever produced when NO rematch-free complete pairing exists. Returns the pairing list or null.
 */
function matchPairs(ordered: SwissRecord[], allowRematch: boolean): SwissPairing[] | null {
  if (ordered.length === 0) {
    return [];
  }
  const [first, ...rest] = ordered;
  for (let i = 0; i < rest.length; i++) {
    const cand = rest[i];
    if (!allowRematch && isRematch(first, cand)) {
      continue;
    }
    const remaining = rest.slice(0, i).concat(rest.slice(i + 1));
    const sub = matchPairs(remaining, allowRematch);
    if (sub !== null) {
      return [{ a: first.participant, b: cand.participant }, ...sub];
    }
  }
  return null;
}

/**
 * Pair the NEXT Swiss round from the current records. Players are ordered by standings (wins, OW%,
 * seed); an ODD field first pulls a BYE — the LOWEST-ranked player who has not yet had one (or, if
 * everyone has, the lowest-ranked outright) — leaving an even set to pair. Pairing is ADJACENT-score
 * with NO REMATCH while any rematch-free complete pairing exists (backtracking guarantees it), falling
 * back to allowing rematches only if the no-rematch constraint is infeasible. Deterministic: a given
 * record set always yields the same round. Pure — does not mutate `records`.
 */
export function pairSwissRound(records: readonly SwissRecord[]): SwissRound {
  const standings = computeStandings(records).map(s => s.record);
  let bye: Participant | null = null;
  let toPair = standings;
  if (standings.length % 2 === 1) {
    // Bye goes to the lowest-ranked player WITHOUT a prior bye; if all have one, the lowest-ranked.
    const byeRecord = [...standings].reverse().find(r => r.byes === 0) ?? standings.at(-1);
    if (byeRecord) {
      bye = byeRecord.participant;
      toPair = standings.filter(r => r.participant !== bye);
    }
  }
  const pairings = matchPairs(toPair, false) ?? matchPairs(toPair, true) ?? [];
  return { pairings, bye };
}

/**
 * Record one decided Swiss match into a NEW record list (pure; input untouched). The winner gains a
 * win, the loser a loss, and each is added to the other's opponents list (idempotent — a re-report of
 * the same pairing does not double-count). No-op if either participant is unknown or they never faced
 * off in this call's sense (they are recorded as opponents here).
 */
/** Record ONE side's outcome vs `opponent` (pure, idempotent per pairing) — the applySwissResult core. */
function recordOutcome(r: SwissRecord, opponent: Participant, outcome: "win" | "loss"): SwissRecord {
  if (r.opponents.includes(opponent)) {
    return r; // idempotent: this pairing is already counted for r
  }
  return {
    ...r,
    wins: outcome === "win" ? r.wins + 1 : r.wins,
    losses: outcome === "loss" ? r.losses + 1 : r.losses,
    opponents: [...r.opponents, opponent],
  };
}

export function applySwissResult(
  records: readonly SwissRecord[],
  winner: Participant,
  loser: Participant,
): SwissRecord[] {
  return records.map(r => {
    if (r.participant === winner) {
      return recordOutcome(r, loser, "win");
    }
    if (r.participant === loser) {
      return recordOutcome(r, winner, "loss");
    }
    return r;
  });
}

/**
 * Record a BYE for `participant` into a NEW record list (pure): a free win + a bye tally, no opponent
 * added. Idempotent per round is the caller's concern (a bye is only ever assigned once per round).
 */
export function applySwissBye(records: readonly SwissRecord[], participant: Participant): SwissRecord[] {
  return records.map(r => (r.participant === participant ? { ...r, wins: r.wins + 1, byes: r.byes + 1 } : r));
}
