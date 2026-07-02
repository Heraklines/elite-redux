/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Phase } from "#app/phase";
import type { PhaseString } from "#types/phase-types";

/**
 * Co-op RENDERER default-deny INERT phase (#633, M1 - authoritative session replication
 * redesign; see docs/plans/2026-07-02-coop-authoritative-replication-redesign.md).
 *
 * Substituted by the phase factory ({@linkcode PhaseManager.create}) for any host-authoritative
 * battle-RESOLUTION phase that reaches it on the authoritative co-op GUEST - a pure renderer that
 * resolves nothing (it renders the host's streamed outcome via the CoopReplay* phases and applies
 * the authoritative checkpoint). It occupies the neutralized phase's queue slot and ADVANCES
 * immediately (start -> end), so the run's control flow is byte-for-byte preserved while the
 * resolution phase's side effects (RNG draws, damage application, per-account state reads) never
 * happen. Off the renderer it is never constructed, so solo / host / lockstep are unaffected.
 */
export class CoopInertPhase extends Phase {
  public readonly phaseName = "CoopInertPhase";

  /** The resolution phase this inert phase stands in for (kept for logs / diagnostics only). */
  public readonly neutralized: PhaseString;

  constructor(neutralized: PhaseString) {
    super();
    this.neutralized = neutralized;
  }

  public override start(): void {
    // Resolve NOTHING: the authoritative host resolved this phase; the renderer only advances so
    // the queue drains normally. State arrives via the streamed cues + the authoritative checkpoint.
    this.end();
  }
}
