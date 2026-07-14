/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown TOURNAMENT — client-side SHARED SHAPE (Showdown Tournament P1). A
// byte-for-byte MIRROR of the worker's serialized bracket/tournament views
// (workers/er-telemetry/src/tournament-bracket.ts + tournament.ts). The worker
// cannot import client code and the client cannot import the worker build, so
// the shape is re-declared here (exactly as showdown-stakes mirrors the escrow
// StakeRecord). The client only RENDERS what the worker sends — the bracket
// ADVANCE is server-authoritative.
// =============================================================================

/** A participant is an account username. `null` in a slot = bye / TBD. */
export type TournamentParticipant = string;

export type TournamentState = "registration" | "in_progress" | "complete" | "cancelled";

export type MatchResolution = "pending" | "bye" | "reported" | "manual";

/** One bracket match (mirror of the worker BracketMatch). */
export interface BracketMatchView {
  id: string;
  round: number;
  slot: number;
  a: TournamentParticipant | null;
  b: TournamentParticipant | null;
  winner: TournamentParticipant | null;
  resolution: MatchResolution;
  deadline: number | null;
  disputed: boolean;
}

/** The bracket (mirror of the worker Bracket). */
export interface BracketView {
  size: number;
  rounds: BracketMatchView[][];
}

/** One entrant summary in a tournament view. */
export interface EntrantView {
  participant: TournamentParticipant;
  name: string;
  seed: number | null;
}

/** The full tournament view (list is the same minus `bracket`). */
export interface TournamentView {
  id: string;
  name: string;
  organizer: TournamentParticipant;
  state: TournamentState;
  roundWindowMs: number;
  maxEntrants: number;
  createdAt: number;
  startedAt: number | null;
  champion: TournamentParticipant | null;
  entrantCount: number;
  entrants: EntrantView[];
  /** Present on the bracket endpoint; omitted (undefined) in the list endpoint. */
  bracket?: BracketView | null;
}

/** Find a participant's NEXT playable/undecided match (their current front), or null. */
export function nextMatchFor(bracket: BracketView, participant: TournamentParticipant): BracketMatchView | null {
  for (const round of bracket.rounds) {
    for (const match of round) {
      if (match.winner === null && (match.a === participant || match.b === participant)) {
        return match;
      }
    }
  }
  return null;
}

/** The opponent of `participant` in a match, or null (bye/TBD/not in match). */
export function opponentOf(match: BracketMatchView, participant: TournamentParticipant): TournamentParticipant | null {
  if (match.a === participant) {
    return match.b;
  }
  if (match.b === participant) {
    return match.a;
  }
  return null;
}

/** True once the bracket final is decided. */
export function isBracketComplete(bracket: BracketView): boolean {
  const last = bracket.rounds.at(-1);
  return last !== undefined && last[0].winner !== null;
}

/** A short human label for a round given the total round count (Final / Semifinal / Round N). */
export function roundLabel(roundIndex: number, totalRounds: number): string {
  const fromEnd = totalRounds - 1 - roundIndex;
  if (fromEnd === 0) {
    return "Final";
  }
  if (fromEnd === 1) {
    return "Semifinal";
  }
  if (fromEnd === 2) {
    return "Quarterfinal";
  }
  return `Round ${roundIndex + 1}`;
}

/** Format a deadline as a short "Xh Ym left" / "past due" countdown against `now`. */
export function formatDeadline(deadline: number | null, now: number): string {
  if (deadline === null) {
    return "";
  }
  const ms = deadline - now;
  if (ms <= 0) {
    return "past due";
  }
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h left`;
  }
  if (hours > 0) {
    return `${hours}h ${mins}m left`;
  }
  return `${mins}m left`;
}
