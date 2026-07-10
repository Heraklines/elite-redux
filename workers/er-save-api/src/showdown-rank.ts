/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown RANKED LADDER — PURE domain (Pokemon-Champions-style). Zero Cloudflare
// deps: a progression state machine over plain records, so it imports cleanly into a
// plain vitest (`test/tests/elite-redux/showdown/showdown-rank.test.ts`) with no CF
// stub — the SAME worker-test pattern as showdown-escrow.ts. ALL decision logic lives
// HERE so it is exhaustively unit-testable; the worker (`index.ts`) only persists the
// records to D1 and calls these functions.
//
// LADDER MODEL:
//   Tiers pokeball -> greatball -> ultraball -> masterball -> champion (0..4).
//   Ranks 4 -> 3 -> 2 -> 1 within each tier (champion is a SINGLE rank, always 1).
//   Each rank holds SEGMENTS_PER_RANK segments (0..3). A win adds segments (overflow
//   ranks up); a loss subtracts one (underflow ranks down).
//
//   WIN gain: +1 segment; on a 4th+ consecutive win (streak was already >= 3), +2.
//   LOSS: -1 segment; streak resets to 0.
//   TIER FLOOR: once a tier is reached you can never demote below rank 4 segment 0 of
//     that tier — a loss there is ABSORBED (tier is monotonic within a season).
//   SEASONS: monthly ("YYYY-MM" from server time). The first ranked action of a new
//     season HARD-RESETS to pokeball rank 4 (careerBestTier persists; seasonal
//     highestTierReached resets). The prior season's final tier is surfaced ONCE for
//     the season-end reward hook (server-computed, evaluated lazily).
//   FIRST-WEEK GATE: during days 1-7 of a season, progression into masterball rank 3+
//     and champion is CLAMPED at masterball rank 4 (gauge holds at the gate; overflow
//     is discarded, NOT banked — matches Champions).
//   ANTI-WIN-TRADING (our deviation, invite-based matches): per season, wins vs a GIVEN
//     opponent grant full segments for the first 3, HALF (round down, min 0 — alternating
//     1/0 for an odd base gain) for wins 4-6, and ZERO from win 7+. Losses are always full.
//
// DUAL ATTESTATION (mirrors showdown-escrow.ts): a ranked result is applied only when
// BOTH clients report the SAME winner (settled). A conflict VOIDS the report with no
// rank change, so a single lying client can never self-promote.
// =============================================================================

/** Tier ladder, lowest to highest. Champion is the single-rank apex. */
export const RANK_TIER = {
  pokeball: 0,
  greatball: 1,
  ultraball: 2,
  masterball: 3,
  champion: 4,
} as const;

export type RankTier = (typeof RANK_TIER)[keyof typeof RANK_TIER];

export const MIN_TIER: RankTier = RANK_TIER.pokeball;
export const MAX_TIER: RankTier = RANK_TIER.champion;

/** Bottom (entry) rank of a non-champion tier; also the tier FLOOR. */
export const FLOOR_RANK = 4;
/** Top rank of a non-champion tier; a promotion past it crosses to the next tier. */
export const TOP_RANK = 1;
/** Segments per rank; segment values are 0..SEGMENTS_PER_RANK-1, overflow at SEGMENTS_PER_RANK. */
export const SEGMENTS_PER_RANK = 4;
/** A win with a streak of at least this BEFORE the win grants the +2 bonus (the 4th+ consecutive win). */
export const STREAK_BONUS_MIN = 3;

/** The first-week gate ceiling: masterball rank 4 (champion + masterball rank 3+ are gated). */
export const GATE_TIER: RankTier = RANK_TIER.masterball;
export const GATE_RANK = FLOOR_RANK;

/**
 * A player's ranked progression. `careerBestTier` is the ONLY field that survives a
 * season reset; everything else resets to the pokeball floor on the first ranked action
 * of a new season.
 */
export interface RankState {
  /** "YYYY-MM" the state belongs to. A mismatch vs the live season triggers a reset. */
  seasonId: string;
  tier: RankTier;
  /** 4..1 within a non-champion tier; always 1 for champion. Lower number = higher rank. */
  rank: number;
  /** 0..SEGMENTS_PER_RANK-1 within the current rank. */
  segments: number;
  /** Consecutive wins (reset to 0 on any loss). */
  streak: number;
  /** Best tier reached THIS season (for display; resets per season). */
  highestTierReached: RankTier;
  /** Best tier ever reached across all seasons (persists; drives first-time promotion rewards). */
  careerBestTier: RankTier;
}

/** Per-opponent win counter for anti-win-trading (scoped to a season, keyed by opponent id). */
export interface OpponentWinCount {
  seasonId: string;
  wins: number;
}

/** What a single ranked result changed, so the events/rewards layer can react. */
export interface RankResultEvents {
  /** True when THIS player won the match. */
  won: boolean;
  /** Tiers newly reached for the FIRST TIME EVER (career-first), ascending. Drives promotion rewards. */
  tiersFirstReached: RankTier[];
  /** The prior season's final tier when this result triggered a season reset (season-end hook), else null. */
  seasonEndedFinalTier: RankTier | null;
}

/** The outcome of applying one ranked result: the new state, the new opponent counter, and the events. */
export interface RankResult {
  state: RankState;
  opponentWins: OpponentWinCount;
  events: RankResultEvents;
}

/** Context for applying a ranked result: outcome and server time. */
export interface RankResultContext {
  /** True when THIS player won. */
  won: boolean;
  /** Server epoch-ms (season id + first-week gate are derived from this — never trust the client clock). */
  now: number;
}

// #region season helpers

/** The season id ("YYYY-MM", UTC) for a server timestamp. */
export function seasonIdFromTime(now: number): string {
  const d = new Date(now);
  const year = d.getUTCFullYear();
  const month = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  return `${year}-${month}`;
}

/** True during days 1-7 (UTC) of the month — the first-week progression gate. */
export function isFirstWeek(now: number): boolean {
  return new Date(now).getUTCDate() <= 7;
}

/** A fresh pokeball-floor state for `seasonId`, carrying `careerBestTier` forward. */
export function initialRankState(seasonId: string, careerBestTier: RankTier = MIN_TIER): RankState {
  return {
    seasonId,
    tier: MIN_TIER,
    rank: FLOOR_RANK,
    segments: 0,
    streak: 0,
    highestTierReached: MIN_TIER,
    careerBestTier,
  };
}

// #endregion
// #region anti-win-trading

/**
 * Effective segment gain for the `k`-th (1-indexed) win vs a GIVEN opponent this season.
 *  - k <= 3          : full `gain`.
 *  - k in 4..6       : HALF (round down); for an odd base gain, ALTERNATE 1/0 (by k parity)
 *                      so a +1 gain isn't silently zeroed for the whole band (min 0).
 *  - k >= 7          : 0.
 */
export function diminishedGain(gain: number, k: number): number {
  if (k <= 3) {
    return gain;
  }
  if (k >= 7) {
    return 0;
  }
  const half = Math.floor(gain / 2);
  if (gain % 2 === 0) {
    return half; // even gain (e.g. +2 streak) halves cleanly to +1
  }
  // Odd base gain (+1): alternate 1/0 across the band so it averages ~half instead of always 0.
  return k % 2 === 0 ? 1 : 0;
}

// #endregion
// #region progression math

/**
 * Add `gain` segments from a win, ranking/tier-ing up on overflow, capping at champion, and
 * clamping at the first-week gate ceiling (masterball rank 4). Returns the new position.
 */
function applyGain(
  tier: RankTier,
  rank: number,
  segments: number,
  gain: number,
  firstWeek: boolean,
): { tier: RankTier; rank: number; segments: number } {
  let t = tier;
  let r = rank;
  let s = segments + gain;
  while (s >= SEGMENTS_PER_RANK) {
    // Champion apex: no rank/tier above — hold at the top segment (clamp, do not bank).
    if (t === MAX_TIER) {
      s = SEGMENTS_PER_RANK - 1;
      break;
    }
    // First-week gate: cannot progress past masterball rank 4 — hold at the gate segment.
    if (firstWeek && t === GATE_TIER && r === GATE_RANK) {
      s = SEGMENTS_PER_RANK - 1;
      break;
    }
    s -= SEGMENTS_PER_RANK;
    if (r > TOP_RANK) {
      r -= 1; // rank up within the tier (4 -> 1)
    } else {
      // Promote to the next tier at its floor rank (champion is single-rank).
      t = (t + 1) as RankTier;
      r = t === MAX_TIER ? TOP_RANK : FLOOR_RANK;
    }
  }
  return { tier: t, rank: r, segments: s };
}

/**
 * Subtract one segment for a loss, ranking DOWN on underflow, but ABSORBING the loss at the
 * tier floor (rank 4 segment 0) — a tier is never demoted once reached. Returns the new position.
 */
function applyLoss(tier: RankTier, rank: number, segments: number): { tier: RankTier; rank: number; segments: number } {
  if (segments > 0) {
    return { tier, rank, segments: segments - 1 };
  }
  // segment 0: rank down within the tier, unless at the floor rank (absorbed).
  if (rank < FLOOR_RANK) {
    return { tier, rank: rank + 1, segments: SEGMENTS_PER_RANK - 1 };
  }
  // Tier floor (rank 4, segment 0): the loss is absorbed.
  return { tier, rank, segments: 0 };
}

// #endregion

/**
 * Apply ONE ranked result to a player's state + their per-opponent counter. PURE — all
 * season-reset / gate / anti-win-trading rules live here. `opponentWins` is this player's
 * win counter vs the SAME opponent (loaded from D1 by the worker); it is bumped on a win.
 *
 * Order: (1) season-reset if stale, capturing the prior final tier for the season-end hook;
 * (2) win -> streak++, base gain (+1, or +2 on the 4th+ consecutive win), diminish vs opponent,
 * add segments; loss -> streak=0, subtract one (floor-absorbed); (3) recompute highest/career best.
 */
export function applyRankedResult(
  state: RankState,
  opponentWins: OpponentWinCount,
  ctx: RankResultContext,
): RankResult {
  const seasonId = seasonIdFromTime(ctx.now);
  let seasonEndedFinalTier: RankTier | null = null;

  // (1) Season reset. The stale state's tier is the prior season's FINAL tier (season-end hook).
  let s: RankState = state;
  let counter: OpponentWinCount = opponentWins;
  if (state.seasonId !== seasonId) {
    seasonEndedFinalTier = state.tier;
    s = initialRankState(seasonId, state.careerBestTier);
  }
  // The opponent counter is season-scoped: reset it when it belongs to a prior season.
  if (counter.seasonId !== seasonId) {
    counter = { seasonId, wins: 0 };
  }

  const firstWeek = isFirstWeek(ctx.now);
  let tier = s.tier;
  let rank = s.rank;
  let segments = s.segments;
  let streak = s.streak;

  if (ctx.won) {
    const priorStreak = streak;
    streak = priorStreak + 1;
    const baseGain = priorStreak >= STREAK_BONUS_MIN ? 2 : 1;
    const k = counter.wins + 1; // this win's index vs the opponent, this season
    const gain = diminishedGain(baseGain, k);
    counter = { seasonId, wins: counter.wins + 1 };
    const next = applyGain(tier, rank, segments, gain, firstWeek);
    tier = next.tier;
    rank = next.rank;
    segments = next.segments;
  } else {
    streak = 0;
    const next = applyLoss(tier, rank, segments);
    tier = next.tier;
    rank = next.rank;
    segments = next.segments;
  }

  // (3) Highest / career best. Detect career-FIRST tiers reached for the promotion hook.
  const priorCareerBest = s.careerBestTier;
  const highestTierReached = Math.max(s.highestTierReached, tier) as RankTier;
  const careerBestTier = Math.max(priorCareerBest, tier) as RankTier;
  const tiersFirstReached: RankTier[] = [];
  for (let t = priorCareerBest + 1; t <= careerBestTier; t++) {
    tiersFirstReached.push(t as RankTier);
  }

  return {
    state: { seasonId, tier, rank, segments, streak, highestTierReached, careerBestTier },
    opponentWins: counter,
    events: { won: ctx.won, tiersFirstReached, seasonEndedFinalTier },
  };
}

/**
 * Lazily fold a season reset when a player's stored state is stale, WITHOUT applying a result
 * (used by GET /showdown/rank so the season-end hook + reset fire on the first LOGIN of a new
 * season, not only on the first match). Returns the fresh state + the prior final tier (or null).
 */
export function reconcileSeason(
  state: RankState,
  now: number,
): { state: RankState; seasonEndedFinalTier: RankTier | null } {
  const seasonId = seasonIdFromTime(now);
  if (state.seasonId === seasonId) {
    return { state, seasonEndedFinalTier: null };
  }
  return { state: initialRankState(seasonId, state.careerBestTier), seasonEndedFinalTier: state.tier };
}

// #region dual-attestation reconciliation (mirrors showdown-escrow.applyResultReport)

/** Which side reported. Mirrors the escrow `MatchRole`. */
export type RankRole = "host" | "guest";

/** The lifecycle of a ranked-result reconciliation. */
export type RankMatchState = "open" | "settled" | "void";

/** One side's attestation of who won the ranked match. */
export interface RankReport {
  winner: RankRole;
  at: number;
}

/** The reconciliation ledger row for a ranked match (persisted to D1 by the worker). */
export interface RankMatchRecord {
  id: string;
  hostUid: string;
  guestUid: string;
  state: RankMatchState;
  hostReport: RankReport | null;
  guestReport: RankReport | null;
  /** The agreed winning role once settled (null until then / on void). */
  winner: RankRole | null;
  createdAt: number;
  resolvedAt: number | null;
}

export type RankReportResolution = "pending" | "settled" | "void";

export interface ApplyRankReportResult {
  match: RankMatchRecord;
  resolution: RankReportResolution;
}

/** The role of `uid` in a ranked match, or null if not a participant. */
export function rankRoleOf(match: RankMatchRecord, uid: string): RankRole | null {
  if (uid === match.hostUid) {
    return "host";
  }
  if (uid === match.guestUid) {
    return "guest";
  }
  return null;
}

/** A fresh open ranked-match reconciliation record. */
export function newRankMatch(id: string, hostUid: string, guestUid: string, now: number): RankMatchRecord {
  return {
    id,
    hostUid,
    guestUid,
    state: "open",
    hostReport: null,
    guestReport: null,
    winner: null,
    createdAt: now,
    resolvedAt: null,
  };
}

/**
 * Apply one player's ranked-result report (dual attestation). Rules mirror the escrow:
 *  - already resolved -> idempotent no-op.
 *  - reporter not a participant -> unchanged, pending.
 *  - FIRST report from a role is canonical (a re-report cannot flip the winner).
 *  - BOTH present: agree -> settled (that winner); conflict -> void (NO rank change).
 *  - ONE present -> pending (a ranked result that is never dual-confirmed simply never counts,
 *    which is the safe default: a single client can't self-promote).
 */
export function applyRankReport(
  match: RankMatchRecord,
  reporterUid: string,
  winner: RankRole,
  now: number,
): ApplyRankReportResult {
  if (match.state === "settled" || match.state === "void") {
    return { match, resolution: match.state };
  }
  const role = rankRoleOf(match, reporterUid);
  if (role === null) {
    return { match, resolution: "pending" };
  }
  const next: RankMatchRecord = { ...match };
  const existing = role === "host" ? next.hostReport : next.guestReport;
  const report: RankReport = existing ?? { winner, at: now };
  if (role === "host") {
    next.hostReport = report;
  } else {
    next.guestReport = report;
  }
  if (next.hostReport && next.guestReport) {
    if (next.hostReport.winner === next.guestReport.winner) {
      return {
        match: { ...next, state: "settled", winner: next.hostReport.winner, resolvedAt: now },
        resolution: "settled",
      };
    }
    return { match: { ...next, state: "void", winner: null, resolvedAt: now }, resolution: "void" };
  }
  return { match: next, resolution: "pending" };
}

// #endregion
