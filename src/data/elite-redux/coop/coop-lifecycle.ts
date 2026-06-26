/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op session lifecycle (#633, P5/#639): presence + disconnect-grace state
// machine. Pure and TIME-INJECTED (no Date.now) so it is fully deterministic and
// headlessly unit-testable. The host engine consults this to enforce the two
// persistence rules:
//   1. RESUME-REQUIRES-BOTH: a saved co-op run may only resume once BOTH players
//      are present. On load the host is present and the guest is not yet, so the
//      run waits in a lobby until the partner reconnects.
//   2. DISCONNECT GRACE: if a peer drops mid-run, a grace window opens. While it
//      is open the run pauses and waits for the peer to return; if it expires the
//      run is abandoned (the surviving player can convert it to solo or quit).
//
// Engine-free (only the CoopRole type) - the real WebRTC transport feeds presence
// in at P6; nothing here changes.
// =============================================================================

import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopRole } from "#data/elite-redux/coop/coop-transport";

/** Default disconnect grace window: 2 minutes for the peer to reconnect. */
export const COOP_DISCONNECT_GRACE_MS = 120_000;

/** The high-level lifecycle state of a co-op session at a point in time. */
export type CoopLifecycleState =
  /** Both players present (or lobby, waiting for the guest's first join). */
  | "active"
  /** A peer dropped; the grace window is still open - pause and wait. */
  | "grace"
  /** The grace window expired without a reconnect - the co-op run is abandoned. */
  | "abandoned";

/** Options for {@linkcode CoopLifecycle}. */
export interface CoopLifecycleOptions {
  /** Whether the host is present at construction (default true - the host is local). */
  hostPresent?: boolean;
  /** Whether the guest is present at construction (default false - not yet joined). */
  guestPresent?: boolean;
  /** Disconnect grace window in ms (default {@linkcode COOP_DISCONNECT_GRACE_MS}). */
  graceMs?: number;
}

/**
 * Presence + disconnect-grace state machine for one co-op session. Construct with
 * the known starting presence, feed it `connect`/`disconnect` events (with the
 * event time in ms), and query `canResume()` / `state(nowMs)` to drive the run.
 */
export class CoopLifecycle {
  private hostPresent: boolean;
  private guestPresent: boolean;
  private readonly graceMs: number;
  /** When the CURRENT grace window opened (ms), or null when no peer is missing. */
  private disconnectedAtMs: number | null = null;

  constructor(opts: CoopLifecycleOptions = {}) {
    this.hostPresent = opts.hostPresent ?? true;
    this.guestPresent = opts.guestPresent ?? false;
    this.graceMs = opts.graceMs ?? COOP_DISCONNECT_GRACE_MS;
  }

  private isPresent(role: CoopRole): boolean {
    return role === "host" ? this.hostPresent : this.guestPresent;
  }

  private setPresent(role: CoopRole, present: boolean): void {
    if (role === "host") {
      this.hostPresent = present;
    } else {
      this.guestPresent = present;
    }
  }

  /** Whether both players are currently present. */
  bothPresent(): boolean {
    return this.hostPresent && this.guestPresent;
  }

  /**
   * A saved co-op run may only resume when BOTH players are present (#639). The
   * caller keeps the run in a "waiting for partner" lobby until this is true.
   */
  canResume(): boolean {
    return this.bothPresent();
  }

  /**
   * Mark `role` as present at time `atMs`. When this brings BOTH players back, any
   * open grace window is closed (the run un-pauses). `atMs` is unused when both are
   * already present; it is accepted for call-site symmetry with {@linkcode disconnect}.
   */
  connect(role: CoopRole, _atMs = 0): void {
    const fromState = this.state(_atMs);
    const wasPresent = this.isPresent(role);
    this.setPresent(role, true);
    if (this.bothPresent()) {
      this.disconnectedAtMs = null;
    }
    const toState = this.state(_atMs);
    coopLog(
      "lifecycle",
      `connect role=${role} atMs=${_atMs} wasPresent=${wasPresent} state ${fromState}->${toState} `
        + `bothPresent=${this.bothPresent()} canResume=${this.canResume()}`,
    );
  }

  /**
   * Mark `role` as having dropped at time `atMs`. Opens the grace window if one is
   * not already open (the FIRST drop starts the clock; a second drop does not
   * restart it).
   */
  disconnect(role: CoopRole, atMs: number): void {
    const fromState = this.state(atMs);
    const graceWasOpen = this.disconnectedAtMs !== null;
    this.setPresent(role, false);
    if (this.disconnectedAtMs === null) {
      this.disconnectedAtMs = atMs;
    }
    const toState = this.state(atMs);
    coopWarn(
      "lifecycle",
      `disconnect role=${role} atMs=${atMs} state ${fromState}->${toState} `
        + `graceWasOpen=${graceWasOpen} graceMs=${this.graceMs} graceOpenedAt=${this.disconnectedAtMs}`,
    );
  }

  /** The lifecycle state at time `nowMs`. */
  state(nowMs: number): CoopLifecycleState {
    if (this.bothPresent()) {
      return "active";
    }
    // No grace clock running (e.g. lobby waiting for the guest's first join):
    // treat as active/waiting, not abandoned.
    if (this.disconnectedAtMs === null) {
      return "active";
    }
    return nowMs - this.disconnectedAtMs <= this.graceMs ? "grace" : "abandoned";
  }

  /** Whether a dropped peer's grace window is still open at `nowMs` (pause + wait). */
  withinGrace(nowMs: number): boolean {
    return this.state(nowMs) === "grace";
  }

  /** Whether the grace window has expired at `nowMs` (the run is abandoned). */
  graceExpired(nowMs: number): boolean {
    return this.state(nowMs) === "abandoned";
  }

  /** Milliseconds of grace left at `nowMs` (0 when no window is open or it expired). */
  graceRemainingMs(nowMs: number): number {
    if (this.disconnectedAtMs === null) {
      return 0;
    }
    return Math.max(0, this.graceMs - (nowMs - this.disconnectedAtMs));
  }
}
