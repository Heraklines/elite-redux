/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - RECOVERY BUNDLE (Lane 4)
//
// The snapshot bundle a recovery transaction requests, validates, and applies
// atomically. It carries everything needed to fast-forward a replica to a
// proven authoritative frontier:
//
//   - material : the canonical state image to install (opaque to the log).
//   - frontier : the log high-water this image proves (frozen decision 2).
//   - context  : the exact CoopFrameContextV2 the image was cut on.
//   - membershipRevision : the membership the image is valid under.
//   - nextControl : the canonical successor control to project (decision 4).
//   - requiredTail : the contiguous entries (capturedFrontier, frontier].
//
// VALIDATION is classification, never repair. A bundle is applied ONLY when it
// both (a) matches the live CoopFrameContextV2 (epoch / membership / seatMap /
// session / run) and (b) is consistent with the frontier CAPTURED under the
// fence. A bundle that does not prove progress past the captured frontier - the
// exact "the world advanced while the snapshot was in flight" case - is
// classified `stale` and NEVER applied. A frame mismatch is classified
// `mismatch`. Only `valid` reaches the applier.
//
// ENGINE-FREE: pure data + a pure validator. No Phaser, no globalScene.
// =============================================================================

import type {
  CoopAuthoritativeMaterial,
  CoopAuthorityEntry,
  CoopFrameContextV2,
  CoopNextControl,
} from "#data/elite-redux/coop/authority-v2/contract";

/** The requested, validated-before-applied recovery snapshot. */
export interface CoopRecoveryBundle {
  /** The frame context the image was cut on (epoch / membership / seatMap). */
  readonly context: CoopFrameContextV2;
  /** The canonical state image to install. */
  readonly material: CoopAuthoritativeMaterial;
  /** The proven log high-water this image installs (adopted on apply). */
  readonly frontier: number;
  /** Membership the image is valid under (must match the live frame). */
  readonly membershipRevision: number;
  /** The canonical successor control the replica projects after material. */
  readonly nextControl: CoopNextControl;
  /** Contiguous entries covering (capturedFrontier, frontier], in revision order. */
  readonly requiredTail: readonly CoopAuthorityEntry[];
}

export type CoopRecoveryBundleValidation =
  | { readonly kind: "valid" }
  | {
      readonly kind: "stale";
      readonly reason: string;
      readonly bundleFrontier: number;
      readonly capturedFrontier: number;
    }
  | { readonly kind: "mismatch"; readonly reason: string };

/** The frame identity fields that MUST agree for a bundle to be admissible. */
function frameMismatchReason(bundle: CoopFrameContextV2, live: CoopFrameContextV2): string | undefined {
  if (bundle.sessionId !== live.sessionId) {
    return `session ${bundle.sessionId} != ${live.sessionId}`;
  }
  if (bundle.runId !== live.runId) {
    return `run ${bundle.runId} != ${live.runId}`;
  }
  if (bundle.sessionEpoch !== live.sessionEpoch) {
    return `epoch ${bundle.sessionEpoch} != ${live.sessionEpoch}`;
  }
  if (bundle.seatMapId !== live.seatMapId) {
    return `seatMap ${bundle.seatMapId} != ${live.seatMapId}`;
  }
  if (bundle.membershipRevision !== live.membershipRevision) {
    return `membership ${bundle.membershipRevision} != ${live.membershipRevision}`;
  }
  return;
}

/** The required tail must be strictly increasing and land exactly on the frontier. */
function tailInconsistencyReason(
  tail: readonly CoopAuthorityEntry[],
  capturedFrontier: number,
  frontier: number,
): string | undefined {
  if (tail.length === 0) {
    // A no-op fast-forward (frontier === captured) legitimately carries no tail.
    return frontier === capturedFrontier ? undefined : `empty tail cannot span (${capturedFrontier}, ${frontier}]`;
  }
  let previous = capturedFrontier;
  for (const entry of tail) {
    if (entry.revision <= previous) {
      return `tail revision ${entry.revision} not strictly after ${previous}`;
    }
    previous = entry.revision;
  }
  if (previous !== frontier) {
    return `tail ends at ${previous}, not frontier ${frontier}`;
  }
  return;
}

/**
 * Classify a bundle against the live frame and the fence-captured frontier.
 * Pure and side-effect-free: the transaction acts on the classification, this
 * function never applies anything.
 */
export function validateRecoveryBundle(
  bundle: CoopRecoveryBundle,
  live: CoopFrameContextV2,
  capturedFrontier: number,
): CoopRecoveryBundleValidation {
  const frameReason = frameMismatchReason(bundle.context, live);
  if (frameReason !== undefined) {
    return { kind: "mismatch", reason: `frame ${frameReason}` };
  }

  // The bundle's own membership field must agree with the frame it claims.
  if (bundle.membershipRevision !== bundle.context.membershipRevision) {
    return {
      kind: "mismatch",
      reason: `bundle membership ${bundle.membershipRevision} != context ${bundle.context.membershipRevision}`,
    };
  }

  // The load-bearing staleness gate: a snapshot that does not prove progress
  // past the frontier we captured under the fence cannot fast-forward us. This
  // is the v1 "snapshot staled while in flight" defect, refused by construction.
  if (bundle.frontier < capturedFrontier) {
    return {
      kind: "stale",
      reason: `frontier ${bundle.frontier} < captured ${capturedFrontier}`,
      bundleFrontier: bundle.frontier,
      capturedFrontier,
    };
  }

  const tailReason = tailInconsistencyReason(bundle.requiredTail, capturedFrontier, bundle.frontier);
  if (tailReason !== undefined) {
    return { kind: "mismatch", reason: `tail ${tailReason}` };
  }

  return { kind: "valid" };
}
