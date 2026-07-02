/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op RENDERER default-deny gate (#633, M1 - authoritative session replication
// redesign; see docs/plans/2026-07-02-coop-authoritative-replication-redesign.md).
//
// The authoritative co-op GUEST is a PURE RENDERER: it resolves nothing. It renders
// the host's streamed outcome via the CoopReplay* phases and applies the host's
// authoritative checkpoint/snapshot. Any host-authoritative battle-RESOLUTION phase
// that reaches the phase factory (PhaseManager.create) on a renderer is therefore a
// LEAK - some path queued real combat on the client that must never roll RNG / apply
// damage / read per-account state. This module names that denied set and records each
// neutralized leak so the harness can PROVE the renderer runs none of them.
//
// This is a CYCLE-FREE leaf (like coop-authoritative-gate): it imports only that gate
// (which imports nothing heavy), so phase-manager can import it with no import cycle.
// The predicate is a hard `false` off a live authoritative-guest session, so solo /
// host / lockstep are byte-for-byte unaffected (the denied-set lookup never runs).
//
// SCOPE (M1): a conservative DENYLIST of the pure battle-resolution phases the renderer
// PROVABLY never runs in its normal flow (it renders their visuals via the CoopReplay*
// family - see CoopReplayTurnPhase). Later M-steps (M3 interactions, M4 launch, M6
// cleanup) migrate the remaining engine work onto the snapshot and tighten this toward
// a pure allowlist.
// =============================================================================

import { isCoopAuthoritativeGuestGated } from "#data/elite-redux/coop/coop-authoritative-gate";

/**
 * The host-authoritative battle-RESOLUTION phases a co-op RENDERER must never run. The
 * renderer renders each of their visible effects via a dedicated CoopReplay* phase (move
 * anim, hp drain, stat tween, faint) and applies the authoritative checkpoint, so it never
 * needs the real resolution phase - one reaching the factory here is a leak to neutralize.
 * Kept as a literal string set (not typed `PhaseString`) so this stays a cycle-free leaf.
 */
export const COOP_RENDERER_DENIED_PHASES: ReadonlySet<string> = new Set<string>([
  "EnemyCommandPhase", // rolls enemy AI (per-client field-state divergence, desync #4)
  "MovePhase", // resolves a move (draws battle RNG); renderer renders CoopMoveAnimReplayPhase
  "MoveEffectPhase", // applies damage/secondary (per-account innate/passive gating, desync #3)
  "FaintPhase", // faint resolution; renderer renders CoopFaintReplayPhase
  "StatStageChangePhase", // stat resolution; renderer renders CoopStatStageReplayPhase
  "AttemptCapturePhase", // capture resolution; renderer renders CoopCaptureReplayPhase
]);

/** Bounded so a runaway leak can never grow the diagnostic log without limit. */
const NEUTRALIZED_LOG_CAP = 256;
let neutralizedLog: string[] = [];

/**
 * Whether `phaseName` must be NEUTRALIZED for this client right now: we are the live
 * AUTHORITATIVE co-op GUEST (renderer) AND the phase is a battle-resolution phase. Hard
 * `false` for solo / host / lockstep (the gate predicate is false), so those paths never
 * even reach the set lookup. Pure + cheap (a boolean short-circuit + a `Set.has`).
 */
export function isCoopRendererNeutralizedPhase(phaseName: string): boolean {
  return isCoopAuthoritativeGuestGated() && COOP_RENDERER_DENIED_PHASES.has(phaseName);
}

/**
 * Record that a denied resolution phase was neutralized on the renderer (the M1 harness
 * proof + a live diagnostic that a leak was caught). Bounded ring cap.
 */
export function recordCoopRendererNeutralized(phaseName: string): void {
  if (neutralizedLog.length < NEUTRALIZED_LOG_CAP) {
    neutralizedLog.push(phaseName);
  }
}

/** The neutralized-leak log (the M1 harness reads this to assert which resolution phases were caught). */
export function getCoopRendererNeutralizedLog(): readonly string[] {
  return neutralizedLog;
}

/** Reset the neutralized-leak log (per-test in the harness; also safe to call on session teardown). */
export function resetCoopRendererNeutralizedLog(): void {
  neutralizedLog = [];
}
