/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 PvP (D4): disconnect lifecycle. Wraps the co-op {@linkcode CoopLifecycle} presence +
// 2-minute grace state machine and adds the showdown-specific ABANDONMENT DECISION:
//
//   - a peer DROPS mid-match -> the grace window opens (reconnect within it RESUMES via the existing
//     per-turn full-state resync; the decision here is a no-op while the state is `grace`),
//   - the grace window EXPIRES (`abandoned`) -> the match resolves by TURN reached:
//       - turn < SHOWDOWN_ABANDON_TURN_THRESHOLD -> VOID (`earlyDisconnect`): too early to be a real
//         match, both clients return to the title with no result,
//       - turn >= threshold -> the SURVIVOR wins by `timeout` (the dropped side is the loser).
//
// PURE + TIME-INJECTED (no Date.now, only the injected mega-free CoopLifecycle) so the whole decision
// is unit-testable headlessly, exactly like {@linkcode CoopLifecycle}. The live phase/runtime layer
// feeds it `disconnect`/`connect` events + the battle turn and reads {@linkcode resolveOnAbandon}.
// =============================================================================

import { CoopLifecycle, type CoopLifecycleOptions } from "#data/elite-redux/coop/coop-lifecycle";
import type { CoopRole } from "#data/elite-redux/coop/coop-transport";
import { type ShowdownOutcome, timeoutResult, voidResult } from "#data/elite-redux/showdown/showdown-outcome";

/**
 * The battle turn at/after which an abandonment awards the survivor the win (a real match was under
 * way); below it, an abandonment VOIDS (the duel barely started - no stakes ride on it). Design value.
 */
export const SHOWDOWN_ABANDON_TURN_THRESHOLD = 3;

/**
 * Presence + grace + abandonment-outcome for one showdown match. Both players are present at battle
 * start (the negotiate + wager already completed), so it starts with both present.
 */
export class ShowdownLifecycle {
  private readonly lifecycle: CoopLifecycle;
  /** The highest battle turn reached (monotonic) - drives the void-vs-survivor threshold. */
  private battleTurn = 0;

  constructor(opts: CoopLifecycleOptions = {}) {
    // Both present at match start (unlike a fresh co-op load, where the guest has not joined yet).
    this.lifecycle = new CoopLifecycle({ hostPresent: true, guestPresent: true, ...opts });
  }

  /** Record the current battle turn (monotonic - a stale lower turn never lowers the threshold). */
  setTurn(turn: number): void {
    this.battleTurn = Math.max(this.battleTurn, turn);
  }

  /** The highest battle turn reached so far. */
  get turn(): number {
    return this.battleTurn;
  }

  /** Mark `role` present at `atMs` (a within-grace reconnect closes the grace window). */
  connect(role: CoopRole, atMs = 0): void {
    this.lifecycle.connect(role, atMs);
  }

  /** Mark `role` dropped at `atMs` (opens the grace window if not already open). */
  disconnect(role: CoopRole, atMs: number): void {
    this.lifecycle.disconnect(role, atMs);
  }

  /** Whether a dropped peer's grace window is still open at `nowMs` (pause + wait for reconnect). */
  withinGrace(nowMs: number): boolean {
    return this.lifecycle.withinGrace(nowMs);
  }

  /** Whether the grace window has expired at `nowMs` (the match is abandoned). */
  graceExpired(nowMs: number): boolean {
    return this.lifecycle.graceExpired(nowMs);
  }

  /** Milliseconds of grace left at `nowMs` (0 when no window is open / it expired). */
  graceRemainingMs(nowMs: number): number {
    return this.lifecycle.graceRemainingMs(nowMs);
  }

  /**
   * The outcome when the match is ABANDONED (grace expired) with `droppedRole` the peer that never
   * returned. Returns null while the match is still `active` (both present / reconnected) or `grace`
   * (within the window - the caller keeps waiting). Below the turn threshold -> VOID (earlyDisconnect);
   * at/above -> the SURVIVOR (the other role) wins by timeout.
   */
  resolveOnAbandon(droppedRole: CoopRole, nowMs: number): ShowdownOutcome | null {
    if (!this.lifecycle.graceExpired(nowMs)) {
      return null;
    }
    if (this.battleTurn < SHOWDOWN_ABANDON_TURN_THRESHOLD) {
      return voidResult("earlyDisconnect");
    }
    // `timeoutResult(loser)` -> winner is the OTHER role, i.e. the surviving player.
    return timeoutResult(droppedRole);
  }
}
