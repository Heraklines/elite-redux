/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op authority-v2 Lane 3 - the REPLICA application pipeline (skeleton).
//
// A committed CoopAuthorityEntry arrives at the replica already admitted (in log
// order) by the authority log. This module is the ORDERED APPLICATION of one such
// entry: install its canonical material, then PROJECT its host-stated nextControl,
// signing a receipt at each frozen ACK stage as it goes.
//
// The stage meanings + retirement rule are frozen in contract.ts (decision 6):
//   admitted            - journaled at the replica (delivery remains live).
//   materialApplied     - canonical state installed; digest matches.
//   controlInstalled    - the stated nextControl exists locally with its exact
//                         owner/address (mechanical, not visual).
//   presentationSettled - optional local rendering; NEVER a retirement
//                         requirement for mechanical liveness -> emitted
//                         opportunistically and NEVER blocking the pipeline.
//
// Engine-free: like next-control.ts this imports ONLY types, so the whole
// pipeline is drivable in the node-pure lane with a fake projector + a recording
// receipt sink. The one genuinely engine-coupled step - project() - is injected
// as a CoopControlProjector, so the sentinel suite supplies the real (scene-
// backed) projector while unit drivers supply a scripted fake. NOTHING here reads
// globalScene / getCoopRuntime, and there is no module-global mutable state: the
// pipeline is a pure function of (ctx, entry, deps).
// =============================================================================

import type {
  CoopAckStage,
  CoopAuthorityEntry,
  CoopAuthorityReceipt,
  CoopControlInstallResult,
  CoopControlProjector,
  CoopFrameContextV2,
  CoopReplicaMechanicalStage,
  CoopRuntimeContext,
} from "#data/elite-redux/coop/authority-v2/contract";
import { controlIdOf } from "#data/elite-redux/coop/authority-v2/next-control";

/**
 * Install the entry's canonical authoritative material into the replica's engine
 * state and confirm the digest. Injected (not implemented here) because the
 * concrete apply is engine + payload specific and owned by the material/adapter
 * lanes; the pipeline only sequences it. `true` means the material applied AND
 * its digest matched. `"deferred"` means the real engine has admitted the work
 * but has not reached its exact material boundary yet; redelivery retries without
 * classifying healthy pacing as corruption. `false` (or a throw) is a structural
 * rejection and stops the pipeline before it could sign materialApplied.
 */
export type ApplyMaterialResult = boolean | "deferred";
export type ApplyMaterialFn = (ctx: CoopRuntimeContext, entry: CoopAuthorityEntry) => ApplyMaterialResult;

/**
 * The injected receipt sink. `emit` is fire-and-forget from the pipeline's point
 * of view (it must not throw back into the ordered apply); the transport/log lane
 * owns delivery + retry of the signed receipts.
 */
export interface ReplicaReceiptSink {
  emit(receipt: CoopAuthorityReceipt): void;
}

/**
 * An optional opportunistic presentation settle. Returns `true` when local
 * rendering has completed for this entry. Called best-effort AFTER control is
 * installed; a `false`/throw is swallowed (presentationSettled never blocks
 * mechanical liveness). Absent -> presentation is simply not reported here.
 */
export type PresentationProbeFn = (ctx: CoopRuntimeContext, entry: CoopAuthorityEntry) => boolean;

/** Everything the replica pipeline needs beyond (ctx, entry), all injected. */
export interface ReplicaApplyDeps {
  readonly applyMaterial: ApplyMaterialFn;
  readonly projector: CoopControlProjector;
  readonly receipts: ReplicaReceiptSink;
  /** Authenticated context of THIS receiving replica; receipts must never reuse the authority entry sender. */
  readonly receiptContext: CoopFrameContextV2;
  /** Advance local mechanical truth only after the corresponding live operation succeeded. */
  readonly recordStage: (entry: CoopAuthorityEntry, stage: CoopReplicaMechanicalStage) => boolean;
  /** Optional; when present, an opportunistic presentationSettled probe. */
  readonly presentation?: PresentationProbeFn;
}

/** The durable stage already reached before this delivery/re-delivery entered the pipeline. */
export type ReplicaApplyResume = "admitted" | "materialApplied" | "controlInstalled";

/** The furthest stage the pipeline reached for one entry. */
export type ReplicaApplyOutcome =
  | { readonly kind: "materialDeferred"; readonly reason: string }
  | { readonly kind: "materialRejected"; readonly reason: string }
  | { readonly kind: "controlDeferred"; readonly reason: string }
  | { readonly kind: "controlRejected"; readonly reason: string }
  | { readonly kind: "applied"; readonly controlId: string; readonly presentationSettled: boolean };

/**
 * Apply one admitted authoritative entry at the replica, in stage order.
 *
 * Sequence (each successful stage signs its receipt before the next begins):
 *   1. admitted          - signed on entry (the log admitted this in order).
 *   2. materialApplied   - after applyMaterial confirms install + digest.
 *   3. controlInstalled  - after project(nextControl) reports the surface exists
 *                          (installed OR already-installed). A `deferred` control
 *                          signs NOTHING and returns - the log re-projects on its
 *                          next pace; a `rejected` control is a structural fault
 *                          surfaced to the caller, never a silent retirement.
 *   4. presentationSettled - opportunistic, NEVER blocking.
 *
 * Every entry has a successor. A phase with no executable UI installs the
 * explicit `AWAIT_SUCCESSOR` control and still proves `controlInstalled`.
 */
export function applyEntry(
  ctx: CoopRuntimeContext,
  entry: CoopAuthorityEntry,
  deps: ReplicaApplyDeps,
  resume: ReplicaApplyResume = "admitted",
): ReplicaApplyOutcome {
  if (!receiptContextMatchesEntry(ctx, deps.receiptContext, entry)) {
    return { kind: "materialRejected", reason: "receipt context is not the authenticated receiving replica" };
  }

  if (resume === "controlInstalled") {
    const controlId = expectedControlId(entry);
    emitReceipt(deps.receipts, deps.receiptContext, entry, "controlInstalled", controlId);
    return { kind: "applied", controlId, presentationSettled: false };
  }

  // --- Stage 1: admitted -------------------------------------------------
  // Signed unconditionally: reaching applyEntry IS the entry being journaled in
  // log order. It proves receipt only; authority delivery remains live until the
  // required mechanical stage so lost later receipts and failed applies retry.
  if (resume === "admitted") {
    emitReceipt(deps.receipts, deps.receiptContext, entry, "admitted");
  }

  // --- Stage 2: materialApplied -----------------------------------------
  // Install canonical state + confirm digest BEFORE any control is projected: a
  // control surface pointing at state that isn't installed yet would be a
  // continuation ahead of its own material (the P0 class, inverted).
  if (resume === "admitted") {
    let materialApplied: ApplyMaterialResult;
    try {
      materialApplied = deps.applyMaterial(ctx, entry);
    } catch (error) {
      return { kind: "materialRejected", reason: describeError(error) };
    }
    if (materialApplied === "deferred") {
      return { kind: "materialDeferred", reason: `material revision ${entry.revision} is awaiting live completion` };
    }
    if (!materialApplied) {
      return { kind: "materialRejected", reason: `material digest ${entry.material.digest} did not apply/match` };
    }
    if (!deps.recordStage(entry, "materialApplied")) {
      return { kind: "materialRejected", reason: `replica ledger refused materialApplied revision ${entry.revision}` };
    }
  }
  emitReceipt(deps.receipts, deps.receiptContext, entry, "materialApplied");

  // --- Stage 3: controlInstalled ----------------------------------------
  const nextControl = entry.nextControl;

  const projection: CoopControlInstallResult = deps.projector.project(ctx, nextControl);
  switch (projection.kind) {
    case "deferred":
      // Engine pacing. Sign nothing for control; the log re-projects on its next
      // pace. NEVER a terminal - the entry stays live, unretired, and healthy.
      return { kind: "controlDeferred", reason: projection.reason };
    case "rejected":
      // Structural impossibility. Surface it to the caller (the recovery/log lane
      // decides) - never a silent retirement or an invented local continuation.
      return { kind: "controlRejected", reason: projection.reason };
    case "installed":
    case "already-installed": {
      // The stated control exists locally with its exact owner/address.
      const expected = controlIdOf(nextControl);
      if (projection.controlId !== expected) {
        return {
          kind: "controlRejected",
          reason: `projector installed ${projection.controlId}, expected ${expected}`,
        };
      }
      if (!deps.recordStage(entry, "controlInstalled")) {
        return {
          kind: "controlRejected",
          reason: `replica ledger refused controlInstalled revision ${entry.revision}`,
        };
      }
      emitReceipt(deps.receipts, deps.receiptContext, entry, "controlInstalled", projection.controlId);
      const presentationSettled = probePresentation(ctx, entry, deps);
      return { kind: "applied", controlId: projection.controlId, presentationSettled };
    }
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Opportunistic presentationSettled: probe local rendering AFTER control is
 * installed, sign the (optional) receipt if it settled, and NEVER let a probe
 * failure block or throw back into the ordered apply. Returns whether it settled.
 */
function probePresentation(ctx: CoopRuntimeContext, entry: CoopAuthorityEntry, deps: ReplicaApplyDeps): boolean {
  if (deps.presentation == null) {
    return false;
  }
  let settled = false;
  try {
    settled = deps.presentation(ctx, entry);
  } catch {
    // presentationSettled is never a mechanical-liveness requirement; a probe
    // that throws is simply "not settled here", not a pipeline fault.
    return false;
  }
  if (settled) {
    emitReceipt(deps.receipts, deps.receiptContext, entry, "presentationSettled");
  }
  return settled;
}

/**
 * Sign + emit one receipt for an entry at a stage. `controlId` is present only at
 * `controlInstalled`. The sink must not throw back into the ordered apply; a
 * throwing sink is contained here so one bad receipt can't abort the pipeline.
 */
function emitReceipt(
  sink: ReplicaReceiptSink,
  receiptContext: CoopFrameContextV2,
  entry: CoopAuthorityEntry,
  stage: CoopAckStage,
  controlId?: string,
): void {
  const receipt: CoopAuthorityReceipt = {
    context: receiptContext,
    revision: entry.revision,
    operationId: entry.operationId,
    stage,
    ...(controlId == null ? {} : { controlId }),
  };
  try {
    sink.emit(receipt);
  } catch {
    // Receipt delivery is the transport/log lane's concern with its own retry;
    // a sink throw must never unwind the replica's ordered material/control apply.
  }
}

/** Receipts must be signed by the compatible receiving peer, never by the authority entry's sender. */
function receiptContextMatchesEntry(
  ctx: CoopRuntimeContext,
  receipt: CoopFrameContextV2,
  entry: CoopAuthorityEntry,
): boolean {
  return (
    receipt.sessionId === entry.context.sessionId
    && receipt.runId === entry.context.runId
    && receipt.sessionEpoch === entry.context.sessionEpoch
    && receipt.seatMapId === entry.context.seatMapId
    && receipt.membershipRevision === entry.context.membershipRevision
    && receipt.authoritySeatId === entry.context.authoritySeatId
    && entry.context.senderSeatId === entry.context.authoritySeatId
    && receipt.senderSeatId === ctx.localSeatId
    && receipt.senderSeatId !== receipt.authoritySeatId
    && receipt.senderSeatId !== entry.context.senderSeatId
  );
}

/**
 * The controlId the replica WOULD report for an entry's stated control. Exposed so the log/recovery lane can compare
 * a signed receipt's controlId against the entry without re-deriving the scheme.
 */
export function expectedControlId(entry: CoopAuthorityEntry): string {
  return controlIdOf(entry.nextControl);
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
