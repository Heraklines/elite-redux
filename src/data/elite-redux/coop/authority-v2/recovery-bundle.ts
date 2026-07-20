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
//   - frontierOperationId : the exact operation at that high-water.
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

import { isSameSessionIdentity, isValidAuthorityEntry } from "#data/elite-redux/coop/authority-v2/authority-entry";
import type {
  CoopAuthoritativeMaterial,
  CoopAuthorityEntry,
  CoopFrameContextV2,
  CoopRecoveryNextControl,
} from "#data/elite-redux/coop/authority-v2/contract";
import { controlsEqual, validateNextControl } from "#data/elite-redux/coop/authority-v2/next-control";

/** One exact, correlated request minted by the recovering replica after its fence is held. */
export interface CoopRecoveryRequestV2 {
  readonly requestId: string;
  readonly capturedFrontier: number;
  readonly reason: string;
}

/**
 * Mechanical completion proof for a recovery request. This closes bundle retransmission only; it never
 * retires AuthorityLog entries. Ordinary exact-operation receipts still retire the sole retained log.
 */
export interface CoopRecoveryAppliedProofV2 {
  readonly requestId: string;
  readonly frontier: number;
  readonly materialDigest: string;
  readonly controlId?: string;
}

/** The requested, validated-before-applied recovery snapshot. */
export interface CoopRecoveryBundle {
  /** Exact request this response answers; delayed bundles cannot satisfy a later transaction. */
  readonly requestId: string;
  /** The frame context the image was cut on (epoch / membership / seatMap). */
  readonly context: CoopFrameContextV2;
  /** The canonical state image to install. */
  readonly material: CoopAuthoritativeMaterial;
  /** The proven log high-water this image installs (adopted on apply). */
  readonly frontier: number;
  /** Exact operation at `frontier`; null only when the log frontier is zero. */
  readonly frontierOperationId: string | null;
  /** Membership the image is valid under (must match the live frame). */
  readonly membershipRevision: number;
  /** The canonical successor control the replica projects after material. */
  readonly nextControl: CoopRecoveryNextControl;
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
  if (bundle.authoritySeatId !== live.authoritySeatId) {
    return `authority seat ${bundle.authoritySeatId} != ${live.authoritySeatId}`;
  }
  if (bundle.senderSeatId !== bundle.authoritySeatId) {
    return `sender seat ${bundle.senderSeatId} is not authority ${bundle.authoritySeatId}`;
  }
  return;
}

/** The required tail must be strictly increasing and land exactly on the frontier. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: this is the one atomic validator for every tail identity, ordering, and successor invariant
function tailInconsistencyReason(
  tail: readonly CoopAuthorityEntry[],
  bundleContext: CoopFrameContextV2,
  frontierOperationId: string | null,
  nextControl: CoopRecoveryNextControl,
  capturedFrontier: number,
  frontier: number,
): string | undefined {
  if (tail.length === 0) {
    // A no-op fast-forward (frontier === captured) legitimately carries no tail.
    return frontier === capturedFrontier ? undefined : `empty tail cannot span (${capturedFrontier}, ${frontier}]`;
  }
  let previous = capturedFrontier;
  const operationIds = new Set<string>();
  for (const entry of tail) {
    if (!isValidAuthorityEntry(entry)) {
      return "tail entry is malformed";
    }
    if (
      !isSameSessionIdentity(entry.context, bundleContext)
      || entry.context.sessionEpoch !== bundleContext.sessionEpoch
      || entry.context.membershipRevision !== bundleContext.membershipRevision
      || entry.context.senderSeatId !== bundleContext.senderSeatId
      || entry.context.authoritySeatId !== bundleContext.authoritySeatId
      || entry.context.connectionGeneration !== bundleContext.connectionGeneration
    ) {
      return `tail revision ${entry.revision} has a different authority frame context`;
    }
    if (entry.revision !== previous + 1) {
      return `tail revision ${entry.revision} is not contiguous after ${previous}`;
    }
    if (operationIds.has(entry.operationId)) {
      return `tail operation ${entry.operationId} is duplicated`;
    }
    operationIds.add(entry.operationId);
    previous = entry.revision;
  }
  if (previous !== frontier) {
    return `tail ends at ${previous}, not frontier ${frontier}`;
  }
  const finalEntry = tail.at(-1);
  if (finalEntry == null || !controlsEqual(finalEntry.nextControl, nextControl)) {
    return "tail final nextControl does not match the recovery successor";
  }
  if (finalEntry.operationId !== frontierOperationId) {
    return `tail final operation ${finalEntry.operationId} != frontier operation ${String(frontierOperationId)}`;
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
  expectedRequestId: string,
): CoopRecoveryBundleValidation {
  if (bundle.requestId !== expectedRequestId || expectedRequestId.length === 0) {
    return { kind: "mismatch", reason: `request ${bundle.requestId} != ${expectedRequestId}` };
  }
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
  if (
    !Number.isSafeInteger(bundle.frontier)
    || bundle.frontier < 0
    || (bundle.frontier === 0
      ? bundle.frontierOperationId !== null || bundle.nextControl !== null
      : typeof bundle.frontierOperationId !== "string"
        || bundle.frontierOperationId.length === 0
        || bundle.nextControl == null
        || !validateNextControl(bundle.nextControl).ok)
    || typeof bundle.material?.digest !== "string"
    || bundle.material.digest.length === 0
  ) {
    return { kind: "mismatch", reason: "bundle frontier, material, or nextControl is malformed" };
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

  const tailReason = tailInconsistencyReason(
    bundle.requiredTail,
    bundle.context,
    bundle.frontierOperationId,
    bundle.nextControl,
    capturedFrontier,
    bundle.frontier,
  );
  if (tailReason !== undefined) {
    return { kind: "mismatch", reason: `tail ${tailReason}` };
  }

  return { kind: "valid" };
}
