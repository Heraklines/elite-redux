/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - CUTOVER SURFACE 1 (turn/command): the SWITCHBOARD.
//
// The shadow harness (shadow.ts) runs the v2 turn protocol ALONGSIDE legacy and
// only COMPARES. This module is the flip: when the `authority.v2turn` capability
// is negotiated by BOTH peers AND the harness is present, the TURN surface stops
// being a legacy authority. The frozen cutover rule (contract.ts, decisions 1+2):
// once cut over, legacy must NOT remain a second authority for this surface.
//
// This module is the single, ENGINE-FREE source of truth the legacy seams consult
// to decide "legacy or v2" for the turn surface:
//   - HOST: commit ONLY the v2 TURN_COMMIT (the harness log is the sole retained
//     authority). The legacy turnResolution carrier is emitted cosmetically for
//     observability but is NOT retained / resent / acked - so the legacy
//     RE-SEND + requestTurnCommit loops MUST NOT run for a negotiated session.
//   - GUEST: apply the turn through the v2 replica pipeline (applyEntry -> the
//     injected material applier mapped to the checkpoint-apply seam -> the injected
//     projector installing the COMMAND control on the real phase manager). The
//     guest ignores the legacy turnResolution as authority; the legacy await/request
//     retry loops MUST NOT run.
//
// It imports NOTHING engine-coupled: the harness type is node-pure (BattleScene /
// CoopTransport are type-only in shadow.ts), and the live replica seams are
// INJECTED interfaces the runtime backs with the real engine. So the whole
// switchboard - the mode decision, the suppression predicates, and the active-
// cutover accounting - runs in the node-pure vitest lane.
//
// SHIP SAFETY (capability-off byte-identity): every legacy seam gates on
// `isCoopV2TurnCutoverActive()`, a pure module read that is `false` unless the
// runtime has installed a live cutover (which it does only when BOTH peers
// negotiated the capability). When it is false EVERY seam takes its exact legacy
// path - no allocation, no branch beyond the single boolean read.
// =============================================================================

import type { CoopAuthorityEntry, CoopFrameContextV2 } from "#data/elite-redux/coop/authority-v2/contract";
import type { CoopAuthorityV2Shadow, CoopV2ShadowTurnTap } from "#data/elite-redux/coop/authority-v2/shadow";

// Re-export the live replica seam type (defined where the harness consumes it) so cutover callers have one import site.
export type { CoopV2LiveReplicaSeams } from "#data/elite-redux/coop/authority-v2/shadow";

// ---------------------------------------------------------------------------
// Build-feature gate. DEFAULT OFF (unlike the shadow harness, which is default
// ON): the cutover authorizes real progression, so it ships dark and CI flips it
// per-lane with env COOP_AUTHORITY_V2_TURN=on. Advertising it is still gated on
// BOTH peers negotiating - a locally-on build paired with a locally-off build
// drops the capability from the intersection and BOTH stay on legacy.
// ---------------------------------------------------------------------------
const COOP_V2_TURN_ENABLED = typeof process !== "undefined" && process.env?.COOP_AUTHORITY_V2_TURN === "on";

/** Whether this build ADVERTISES the authority-v2 turn/command cutover capability (default OFF; on with env COOP_AUTHORITY_V2_TURN=on). */
export function isCoopV2TurnEnabled(): boolean {
  return COOP_V2_TURN_ENABLED;
}

// ---------------------------------------------------------------------------
// Mode resolution (pure). The turn surface runs on v2 iff the build advertises it,
// BOTH peers negotiated the capability, and the harness that owns the v2 log is
// present. Any missing precondition falls back to "legacy" - fail closed.
// ---------------------------------------------------------------------------

export type CoopTurnAuthorityMode = "legacy" | "v2";

/** The three preconditions for the turn cutover, each resolved by the runtime and fed in verbatim. */
export interface CoopTurnAuthorityInputs {
  /** This build advertises the cutover (isCoopV2TurnEnabled()). */
  readonly buildEnabled: boolean;
  /** BOTH peers negotiated authority.v2turn (isCoopCapabilityNegotiated(COOP_CAP_AUTHORITY_V2_TURN)). */
  readonly negotiated: boolean;
  /** The shadow harness that owns the v2 authority log + frame channel is built for this runtime. */
  readonly harnessPresent: boolean;
}

/** Resolve the turn-surface authority mode. `v2` iff every precondition holds; otherwise `legacy` (fail closed). */
export function resolveCoopTurnAuthorityMode(inputs: CoopTurnAuthorityInputs): CoopTurnAuthorityMode {
  return inputs.buildEnabled && inputs.negotiated && inputs.harnessPresent ? "v2" : "legacy";
}

// ---------------------------------------------------------------------------
// Suppression predicates (pure). One per legacy loop the cutover retires. Each is
// a trivial `mode === "v2"` today, but naming them individually documents EXACTLY
// which legacy authority each seam drops, and lets a future surface keep one loop
// while retiring another without touching call sites.
// ---------------------------------------------------------------------------

/** HOST: suppress the legacy turn-commit RETENTION + RE-SEND loop (v2 log owns redelivery). */
export function suppressesLegacyTurnResend(mode: CoopTurnAuthorityMode): boolean {
  return mode === "v2";
}

/** GUEST: suppress the legacy requestTurnCommit RETRY loop (v2 log owns tail requests). */
export function suppressesLegacyGuestTurnRequest(mode: CoopTurnAuthorityMode): boolean {
  return mode === "v2";
}

/** GUEST: suppress the legacy next-command RENDEZVOUS barrier (the authority STATES the successor COMMAND). */
export function suppressesLegacyNextCommandBarrier(mode: CoopTurnAuthorityMode): boolean {
  return mode === "v2";
}

// ---------------------------------------------------------------------------
// The live cutover controller. Wraps the per-runtime harness; the host commit
// path delegates to the harness's turn tap (which, with the live seams wired, IS
// the authoritative commit + deliver + guest-apply round-trip). The runtime
// installs exactly one as the module-level ACTIVE cutover for the live session.
// ---------------------------------------------------------------------------

export class CoopV2TurnCutover {
  private readonly harness: CoopAuthorityV2Shadow;
  private disposed = false;

  constructor(harness: CoopAuthorityV2Shadow) {
    this.harness = harness;
  }

  /** The authenticated frame context the harness stamps on every entry (exposed for the host commit site). */
  get authenticatedFrameContext(): CoopFrameContextV2 {
    return this.harness.authenticatedFrameContext;
  }

  /**
   * HOST: commit the resolved turn as the SOLE authority. Delegates to the harness turn tap - which, in
   * cutover mode, is the authoritative commit: it builds the TURN_COMMIT via the frozen adapter builder,
   * commits it to the ONE retained authority log, delivers it over the v2 frame channel, and drives the
   * guest's replica apply + receipts + retirement. Returns the committed entry, or `null` when the mutation
   * barrier bars it / a fault was swallowed (the caller keeps the cosmetic legacy send either way).
   */
  commitHostTurn(input: CoopV2ShadowTurnTap): CoopAuthorityEntry | null {
    if (this.disposed) {
      return null;
    }
    return this.harness.tapTurnCommit(input);
  }

  /** Teardown marker; the harness itself is disposed by the runtime that owns it. */
  dispose(): void {
    this.disposed = true;
  }
}

// ---------------------------------------------------------------------------
// Module-level ACTIVE cutover accounting (mirrors shadow.ts's activeHarness). It
// lives at this boundary so the legacy seams (coop-battle-stream / command-phase)
// can consult it WITHOUT importing coop-runtime - avoiding an import cycle. It is
// the ONLY module-level state here and is a single nullable reference set at
// runtime assembly and cleared at teardown.
// ---------------------------------------------------------------------------

let activeCutover: CoopV2TurnCutover | null = null;

/** Register the live turn cutover for the active session (runtime assembly, after negotiation). */
export function setActiveCoopV2TurnCutover(cutover: CoopV2TurnCutover): void {
  activeCutover = cutover;
}

/** Clear the active turn cutover (teardown). Only clears when `cutover` matches (or omitted). */
export function clearActiveCoopV2TurnCutover(cutover?: CoopV2TurnCutover): void {
  if (cutover == null || activeCutover === cutover) {
    activeCutover = null;
  }
}

/**
 * Whether the turn surface is CUT OVER to v2 for the live session - the single gate every legacy turn seam
 * reads. `false` (the default, and every capability-off session) => every seam takes its exact legacy path,
 * byte-identical to the pre-cutover build.
 */
export function isCoopV2TurnCutoverActive(): boolean {
  return activeCutover != null;
}

/** The live turn cutover controller, or `null` when the turn surface is on legacy. */
export function getActiveCoopV2TurnCutover(): CoopV2TurnCutover | null {
  return activeCutover;
}

/** The live turn-surface mode for the session (the module-active state resolved to an enum). */
export function activeCoopTurnAuthorityMode(): CoopTurnAuthorityMode {
  return activeCutover == null ? "legacy" : "v2";
}
