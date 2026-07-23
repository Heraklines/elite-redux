/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown TOURNAMENT match context (Showdown Tournament P1). A tiny module-level
// stash (mirrors setPendingShowdownPresetStarters) that tags the CURRENT match as
// a tournament match: which tournament, which bracket match, and WHO the bracket
// opponent must be. Set when the player picks "Play match" on the bracket, read at
// three showdown-layer choke points:
//   1. pairing — the peer's username MUST equal `expectedOpponent`, else the match
//      is rejected (constrained pairing; you can only face your bracket opponent).
//   2. wager — the ante is SUPPRESSED (prize-only tournaments): the wager screen
//      renders as team-preview + confirm, escrow is never registered (matchId stays
//      null so every escrow call site no-ops).
//   3. result — on the authoritative match end, the winner is reported to the
//      tournament worker (attestation), which advances the bracket server-side.
// Cleared when the match ends or aborts.
// =============================================================================

import type { BattleFormat, SeriesFormat } from "#data/elite-redux/showdown/tournament-types";

export interface TournamentMatchContext {
  /** The tournament this match belongs to. */
  tournamentId: string;
  /** The bracket match id (`${tournamentId}-r${round}-m${slot}`). */
  matchId: string;
  /** The account username of the bracket opponent this match MUST be against. */
  expectedOpponent: string;
  /**
   * The field width this match is played at (from the tournament record's battleFormat). Both
   * clients read the SAME server-authoritative TournamentView, so this is agreed by construction;
   * it is ALSO cross-checked over the negotiate handshake (a stale client that resolves a different
   * width refuses to pair rather than desync). Absent = singles (back-compat with old contexts).
   */
  battleFormat?: BattleFormat;
  /**
   * SERIES (bo3/bo5): the series wrapper this match is played under, and the CURRENT game number
   * (0-based) within it. Absent/0 = a single game. The worker is authoritative for the series
   * clinch; the client carries these to report each game with its index and to drive the
   * intermission between games.
   */
  seriesFormat?: SeriesFormat;
  /** 0-based index of the current game within the series (0 for a single game). */
  gameIndex?: number;
}

let context: TournamentMatchContext | null = null;

/** Tag the current showdown match as a tournament match. */
export function setTournamentMatchContext(ctx: TournamentMatchContext): void {
  context = ctx;
}

/** The active tournament match context, or null for a plain (non-tournament) match. */
export function getTournamentMatchContext(): TournamentMatchContext | null {
  return context;
}

/** True when the current showdown match is a tournament match. */
export function isTournamentMatch(): boolean {
  return context !== null;
}

/**
 * The constrained-pairing gate: is `peerName` an ALLOWED opponent for the current match?
 * A non-tournament match accepts any peer (returns true). A tournament match accepts ONLY the
 * bracket opponent recorded in the context — both clients call this to reject a mismatch, so a
 * stray/spoofed lobby pairing can never start a tournament match against the wrong person.
 */
export function isTournamentPeerAllowed(peerName: string): boolean {
  return context === null || peerName === context.expectedOpponent;
}

/** Clear the tournament match context (match ended / aborted / returned to title). */
export function clearTournamentMatchContext(): void {
  context = null;
}
