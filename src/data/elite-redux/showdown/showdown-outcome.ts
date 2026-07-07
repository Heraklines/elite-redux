/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 OUTCOME detection (C6) - PURE. Turns the terminal battle state into the
// `showdownResult` / `showdownVoid` wire decision both clients emit + adopt:
//
//   - KO SWEEP: one side has ALL mons fainted (and the other does not) -> a decisive
//     victory for the surviving side (`reason: "victory"`).
//   - FORFEIT / TIMEOUT: a side conceded or ran out its clock -> the OTHER side wins.
//   - VOID: the match resolves with NO winner - a diverged battle whose safety-net resync
//     exhausted (`reason: "checksum"`), an illegal team (`illegalTeam`, C2), or an early
//     disconnect (`earlyDisconnect`).
//
// The `winner` is always a {@linkcode CoopRole}. Engine-free (booleans in, decisions out) so
// it is unit-testable without a scene; the phase layer feeds it the live faint state and
// emits the wire message. Mirrors the wire shapes on CoopMessage (showdownResult/showdownVoid).
// =============================================================================

import type { CoopRole } from "#data/elite-redux/coop/coop-transport";
import type { GhostTrainerProfile } from "#data/elite-redux/er-ghost-profile";

/** How a decisive showdown match ended (the `showdownResult.reason` domain). */
export type ShowdownResultReason = "victory" | "forfeit" | "timeout";

/** Why a showdown match voided with no winner (the `showdownVoid.reason` domain). */
export type ShowdownVoidReason = "checksum" | "illegalTeam" | "earlyDisconnect";

/** A settled decisive result: which role won and how. */
export interface ShowdownResultDecision {
  kind: "result";
  winner: CoopRole;
  reason: ShowdownResultReason;
}

/** A voided match: no winner, with the reason. */
export interface ShowdownVoidDecision {
  kind: "void";
  reason: ShowdownVoidReason;
}

export type ShowdownOutcome = ShowdownResultDecision | ShowdownVoidDecision;

/** The other role (the winner when its opponent forfeits / times out / is swept). */
export function otherRole(role: CoopRole): CoopRole {
  return role === "host" ? "guest" : "host";
}

/**
 * PURE: the WINNING role from THIS client's viewpoint. A client knows only its OWN role and whether
 * IT won (`localWon`); the wire `showdownResult.winner` is always an absolute {@linkcode CoopRole}, so
 * map the local view to it: the local role when this client won, else the other role. Extracted from
 * {@linkcode ShowdownResultPhase} (was an inline nested ternary) so the mapping is unit-testable and
 * the two callers can't drift.
 */
export function winnerFromLocalResult(localRole: CoopRole, localWon: boolean): CoopRole {
  return localWon ? localRole : otherRole(localRole);
}

/**
 * PURE: decide the winner from a KO sweep. The host's team occupies the authoritative PLAYER
 * side; the guest's team the ENEMY side. A side is SWEPT when all its mons have fainted. Returns
 * the surviving side's role, or `null` when the match is not yet decided by a sweep (both sides
 * still have a live mon, or a simultaneous double-sweep with no distinguished winner - the caller
 * keeps playing / falls back to another terminator).
 */
export function detectKoSweepWinner(hostTeamSwept: boolean, guestTeamSwept: boolean): CoopRole | null {
  if (hostTeamSwept === guestTeamSwept) {
    // Neither swept (undecided) or both swept (no distinguished winner) -> not decided here.
    return null;
  }
  return hostTeamSwept ? "guest" : "host";
}

/** PURE: the full victory decision from a KO sweep, or null when undecided. */
export function detectShowdownVictory(hostTeamSwept: boolean, guestTeamSwept: boolean): ShowdownResultDecision | null {
  const winner = detectKoSweepWinner(hostTeamSwept, guestTeamSwept);
  return winner == null ? null : { kind: "result", winner, reason: "victory" };
}

/**
 * PURE: the result decision when `loser` forfeits (the other side wins by forfeit).
 * D4: wired by Task D4 (disconnect/forfeit lifecycle) - defined here so the wire shapes are stable.
 */
export function forfeitResult(loser: CoopRole): ShowdownResultDecision {
  return { kind: "result", winner: otherRole(loser), reason: "forfeit" };
}

/**
 * PURE: the result decision when `loser` runs out its turn clock (the other side wins).
 * D4: wired by Task D4 (disconnect/forfeit lifecycle) - defined here so the wire shapes are stable.
 */
export function timeoutResult(loser: CoopRole): ShowdownResultDecision {
  return { kind: "result", winner: otherRole(loser), reason: "timeout" };
}

/**
 * PURE: a void decision with the given reason (no winner). The `"checksum"` reason is live (C6);
 * D4: `"earlyDisconnect"` is wired by Task D4 (disconnect/forfeit lifecycle) - defined here so the
 * wire shapes are stable.
 */
export function voidResult(reason: ShowdownVoidReason): ShowdownVoidDecision {
  return { kind: "void", reason };
}

/**
 * PURE (Task C7): the OPPONENT'S ghost-trainer dialogue line to show at the result screen, mirroring
 * ghost-battle victory/defeat line semantics EXACTLY:
 *   - the client that WON shows the opponent's `dialogue.defeated`  (the line the opponent says when IT is defeated),
 *   - the client that LOST shows the opponent's `dialogue.defeatPlayer` (the line the opponent says when IT wins).
 * A VOID shows NO line (returns undefined). Also undefined when the opponent has no profile / no matching
 * line, so callers skip silently. Returns the RAW authored line (placeholder tokens are resolved by the
 * caller against its own live battle state, like the ghost dialogue getters).
 */
export function selectShowdownResultLine(
  profile: GhostTrainerProfile | null | undefined,
  localWon: boolean,
  voided: boolean,
): string | undefined {
  if (voided || !profile?.dialogue) {
    return;
  }
  return localWon ? profile.dialogue.defeated : profile.dialogue.defeatPlayer;
}
