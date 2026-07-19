/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - correlated recovery transport.
//
// This is the wire/lease owner around CoopRecoveryTransaction:
//   - replica requests are correlated, retried on the runtime scheduler, and
//     resolved only by the exact authority response;
//   - authority bundles are retained and redelivered until an exact
//     recoveryApplied proof arrives;
//   - recoveryApplied closes only the response lease. It never fabricates an
//     AuthorityReceipt and never retires AuthorityLog entries;
//   - every frame is checked against the current authenticated peer binding;
//   - duplicate bundles after completion re-emit the durable completion proof.
//
// Engine access is injected through capture/apply/projector seams. No ambient
// runtime or scene lookup occurs here.
// =============================================================================

import { isSameSessionIdentity, isValidOperationId } from "#data/elite-redux/coop/authority-v2/authority-entry";
import type { AuthorityLog, CoopAuthorityRecoverySliceV2 } from "#data/elite-redux/coop/authority-v2/authority-log";
import type {
  CoopAuthoritativeMaterial,
  CoopAuthorityEntry,
  CoopAuthorityPeerBindingV2,
  CoopControlProjector,
  CoopFrameContextV2,
  CoopRuntimeContext,
  CoopTimerOwner,
} from "#data/elite-redux/coop/authority-v2/contract";
import {
  COOP_FRAME_PROTOCOL_VERSION,
  type CoopAuthorityEntryBodyV2,
  type CoopFrameV2,
} from "#data/elite-redux/coop/authority-v2/frame-codec";
import { controlIdOf } from "#data/elite-redux/coop/authority-v2/next-control";
import { createRecoveryTransaction } from "#data/elite-redux/coop/authority-v2/recovery";
import type {
  CoopRecoveryAppliedProofV2,
  CoopRecoveryBundle,
  CoopRecoveryRequestV2,
} from "#data/elite-redux/coop/authority-v2/recovery-bundle";
import { type CoopRecoveryFence, createRecoveryFence } from "#data/elite-redux/coop/authority-v2/recovery-fence";

const RETRY_INITIAL_MS = 250;
const RETRY_MAX_MS = 5_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;
const DEFAULT_ABSOLUTE_TIMEOUT_MS = 1_200_000;
const COMPLETION_CACHE_LIMIT = 16;

interface PendingReplicaRequest {
  readonly request: CoopRecoveryRequestV2;
  readonly owner: CoopTimerOwner;
  readonly signal: AbortSignal;
  readonly resolve: (bundle: CoopRecoveryBundle) => void;
  readonly reject: (error: Error) => void;
  readonly onAbort: () => void;
  attempt: number;
  cancelRetry: (() => void) | null;
}

interface PendingAuthorityResponse {
  readonly requesterSeatId: number;
  readonly request: CoopRecoveryRequestV2;
  readonly owner: CoopTimerOwner;
  bundle: CoopRecoveryBundle;
  attempt: number;
  cancelRetry: (() => void) | null;
}

interface CompletedReplicaRecovery {
  readonly proof: CoopRecoveryAppliedProofV2;
  readonly bundleFingerprint: string;
}

interface CompletedAuthorityRecovery {
  readonly request: CoopRecoveryRequestV2;
}

export interface CoopRecoveryChannelV2Deps {
  /** Current membership-bound local frame; re-read for every send/admission. */
  readonly frame: () => CoopFrameContextV2;
  /** Current authenticated remote seats and their accepted channel generations. */
  readonly peerBindings: () => readonly CoopAuthorityPeerBindingV2[];
  /** Current explicit runtime context (may advance membership generation after hot rejoin). */
  readonly context: () => CoopRuntimeContext;
  /** The one global Authority V2 log. */
  readonly log: AuthorityLog;
  readonly projector: CoopControlProjector;
  readonly send: (frame: CoopFrameV2) => void;
  /** Authority-only: capture one immutable, digest-bound full snapshot synchronously. */
  readonly captureMaterial: (ctx: CoopRuntimeContext) => CoopAuthoritativeMaterial | null;
  /** Replica-only: atomically install and verify the full snapshot. */
  readonly applyMaterial: (ctx: CoopRuntimeContext, material: CoopAuthoritativeMaterial) => boolean | Promise<boolean>;
  /** Synchronous fail-closed integration hook. */
  readonly onTerminal: (reason: string) => void;
  readonly requestTimeoutMs?: number;
  readonly absoluteTimeoutMs?: number;
}

export interface CoopRecoveryChannelV2Diagnostics {
  readonly fenceState: CoopRecoveryFence["state"];
  readonly activeReplicaRequest: string | null;
  readonly activeAuthorityResponses: number;
  readonly completedReplicaProofs: number;
  readonly disposed: boolean;
}

/** Read-only freeze predicates wired at the four real progression chokepoints. */
export interface CoopRecoveryFencePredicatesV2 {
  readonly isCommandAdmissionFrozen: () => boolean;
  readonly isProgressionFrozen: () => boolean;
  readonly isMaterializationFrozen: () => boolean;
  readonly isAuthorityWaitCreationFrozen: () => boolean;
}

function requestEquals(left: CoopRecoveryRequestV2, right: CoopRecoveryRequestV2): boolean {
  return (
    left.requestId === right.requestId
    && left.capturedFrontier === right.capturedFrontier
    && left.reason === right.reason
  );
}

function withoutEntryContext(entry: CoopAuthorityEntry): CoopAuthorityEntryBodyV2 {
  const { context: _context, ...body } = entry;
  return body;
}

function bundleFingerprint(bundle: CoopRecoveryBundle): string {
  // Envelope/membership context is deliberately excluded: an authenticated hot
  // rejoin re-addresses the same retained response under a newer membership.
  // The correlated request, material, frontier, successor, and complete tail
  // remain byte-semantic identity; a completed replica may therefore re-prove
  // that exact apply after the carrier generation rotates.
  return JSON.stringify({
    requestId: bundle.requestId,
    frontier: bundle.frontier,
    material: bundle.material,
    nextControl: bundle.nextControl,
    tail: bundle.requiredTail.map(withoutEntryContext),
  });
}

function deepFreeze<T>(value: T): T {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

function cloneFrozen<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function retryDelay(attempt: number): number {
  return Math.min(RETRY_INITIAL_MS * 2 ** Math.min(attempt, 8), RETRY_MAX_MS);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class CoopRecoveryChannelV2 {
  private readonly deps: CoopRecoveryChannelV2Deps;
  private readonly fence = createRecoveryFence();
  private readonly authorityResponses = new Map<number, PendingAuthorityResponse>();
  private readonly completedReplica = new Map<string, CompletedReplicaRecovery>();
  private readonly completedAuthority = new Map<string, CompletedAuthorityRecovery>();
  private readonly resolvedBundleFingerprints = new Map<string, string>();
  private pendingReplica: PendingReplicaRequest | null = null;
  private activeTransaction: ReturnType<typeof createRecoveryTransaction> | null = null;
  private activeOutcome: Promise<"recovered" | "terminalized"> | null = null;
  private requestSequence = 0;
  private disposed = false;
  private terminalized = false;

  constructor(deps: CoopRecoveryChannelV2Deps) {
    this.deps = deps;
  }

  /**
   * Replica: run one idempotent recovery transaction. A repeated caller joins the
   * in-flight outcome instead of opening a second fence/request.
   */
  recover(reason: string): Promise<"recovered" | "terminalized"> {
    if (this.disposed || this.terminalized || this.isLocalAuthority()) {
      return Promise.resolve("terminalized");
    }
    if (this.activeOutcome != null) {
      return this.activeOutcome;
    }
    if (!isValidOperationId(reason)) {
      this.failClosed("Authority V2 recovery requires a bounded, wire-safe reason.");
      return Promise.resolve("terminalized");
    }
    const context = this.deps.context();
    const frame = this.deps.frame();
    const requestId =
      `REC/e${frame.sessionEpoch}/m${frame.membershipRevision}/s${context.localSeatId}`
      + `/g${frame.connectionGeneration}/q${++this.requestSequence}`;
    const transaction = createRecoveryTransaction(context, {
      log: this.deps.log,
      // Context membership is a hot-rejoin axis. The transaction owns the
      // original cancellation/scheduler scope, while every engine verb receives
      // the live context so a request rebound before its bundle arrives can
      // safely complete on the accepted membership.
      projector: {
        project: (_ctx, control) => this.deps.projector.project(this.deps.context(), control),
      },
      fence: this.fence,
      frame: this.deps.frame,
      requestId,
      reason,
      request: (_ctx, request, signal) => this.openReplicaRequest(request, signal),
      applyMaterial: (_ctx, material) => this.deps.applyMaterial(this.deps.context(), material),
      acknowledge: (_ctx, proof) => this.completeReplicaRecovery(proof),
      requestTimeoutMs: this.deps.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    });
    this.activeTransaction = transaction;
    const outcome = transaction.run().finally(() => {
      if (this.activeTransaction === transaction) {
        this.activeTransaction = null;
        this.activeOutcome = null;
      }
    });
    this.activeOutcome = outcome;
    return outcome;
  }

  /** Route one already structurally-validated recovery frame. */
  handleFrame(frame: CoopFrameV2): boolean {
    if (this.disposed) {
      return false;
    }
    switch (frame.t) {
      case "recoveryRequest":
        this.handleRecoveryRequest(frame.ctx, frame.body);
        return true;
      case "recoveryBundle":
        this.handleRecoveryBundle(frame.ctx, frame.body);
        return true;
      case "recoveryApplied":
        this.handleRecoveryApplied(frame.ctx, frame.body);
        return true;
      default:
        return false;
    }
  }

  /**
   * Re-address retained response leases after the AuthorityLog accepted an authenticated hot rejoin.
   * Request retries read the live frame on every send and need no stored-frame rewrite.
   */
  rebind(): void {
    if (this.disposed) {
      return;
    }
    const frame = this.deps.frame();
    for (const response of this.authorityResponses.values()) {
      response.bundle = Object.freeze({
        ...response.bundle,
        context: frame,
        membershipRevision: frame.membershipRevision,
        requiredTail: Object.freeze(
          response.bundle.requiredTail.map(entry => Object.freeze({ ...entry, context: frame })),
        ),
      });
      response.cancelRetry?.();
      response.cancelRetry = null;
      this.sendAuthorityResponse(response);
      this.armAuthorityResponseRetry(response);
    }
    if (this.pendingReplica != null) {
      this.pendingReplica.cancelRetry?.();
      this.pendingReplica.cancelRetry = null;
      this.sendReplicaRequest(this.pendingReplica);
      this.armReplicaRequestRetry(this.pendingReplica);
    }
  }

  abort(reason: string): void {
    this.activeTransaction?.abort(reason);
  }

  dispose(reason = "authority-v2-recovery-channel-dispose"): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.activeTransaction?.abort(reason);
    this.activeTransaction = null;
    this.activeOutcome = null;
    const pending = this.pendingReplica;
    if (pending != null) {
      this.releaseReplicaRequest(pending);
      pending.reject(new Error(reason));
    }
    for (const response of this.authorityResponses.values()) {
      this.releaseAuthorityResponse(response);
    }
    this.authorityResponses.clear();
    this.completedReplica.clear();
    this.completedAuthority.clear();
    this.resolvedBundleFingerprints.clear();
  }

  diagnostics(): CoopRecoveryChannelV2Diagnostics {
    return {
      fenceState: this.fence.state,
      activeReplicaRequest: this.pendingReplica?.request.requestId ?? null,
      activeAuthorityResponses: this.authorityResponses.size,
      completedReplicaProofs: this.completedReplica.size,
      disposed: this.disposed,
    };
  }

  fencePredicates(): CoopRecoveryFencePredicatesV2 {
    return {
      isCommandAdmissionFrozen: () => this.fence.isCommandAdmissionFrozen(),
      isProgressionFrozen: () => this.fence.isProgressionFrozen(),
      isMaterializationFrozen: () => this.fence.isMaterializationFrozen(),
      isAuthorityWaitCreationFrozen: () => this.fence.isAuthorityWaitCreationFrozen(),
    };
  }

  // -------------------------------------------------------------------------
  // Replica request lease
  // -------------------------------------------------------------------------

  private openReplicaRequest(request: CoopRecoveryRequestV2, signal: AbortSignal): Promise<CoopRecoveryBundle> {
    if (this.pendingReplica != null) {
      return Promise.reject(new Error("Authority V2 recovery already has an active replica request"));
    }
    if (signal.aborted) {
      return Promise.reject(new Error("Authority V2 recovery request already aborted"));
    }
    return new Promise<CoopRecoveryBundle>((resolve, reject) => {
      const owner: CoopTimerOwner = {
        ownerId: `authority-v2:recovery-request:${request.requestId}`,
        address: `authority-v2/recovery/request/${request.requestId}`,
        reason: "retry correlated recovery request until its authority bundle arrives",
      };
      const pending: PendingReplicaRequest = {
        request,
        owner,
        signal,
        resolve,
        reject,
        onAbort: () => {
          if (this.pendingReplica !== pending) {
            return;
          }
          this.releaseReplicaRequest(pending);
          reject(new Error("Authority V2 recovery request aborted"));
        },
        attempt: 0,
        cancelRetry: null,
      };
      this.pendingReplica = pending;
      signal.addEventListener("abort", pending.onAbort, { once: true });
      this.sendReplicaRequest(pending);
      this.armReplicaRequestRetry(pending);
      this.deps
        .context()
        .scheduler.schedule(owner, this.deps.absoluteTimeoutMs ?? DEFAULT_ABSOLUTE_TIMEOUT_MS, "absolute", () =>
          this.failClosed(`Authority V2 recovery request ${request.requestId} exceeded its absolute ceiling.`),
        );
    });
  }

  private sendReplicaRequest(pending: PendingReplicaRequest): void {
    if (this.pendingReplica !== pending || pending.signal.aborted) {
      return;
    }
    try {
      this.deps.send({
        v: COOP_FRAME_PROTOCOL_VERSION,
        t: "recoveryRequest",
        ctx: this.deps.frame(),
        body: pending.request,
      });
    } catch {
      // The scheduler-owned retry remains authoritative; a carrier throw cannot discard the request.
    }
  }

  private armReplicaRequestRetry(pending: PendingReplicaRequest): void {
    if (this.pendingReplica !== pending || pending.signal.aborted || pending.cancelRetry != null) {
      return;
    }
    pending.cancelRetry = this.deps
      .context()
      .scheduler.schedule(pending.owner, retryDelay(pending.attempt++), "recovery", () => {
        pending.cancelRetry = null;
        this.sendReplicaRequest(pending);
        this.armReplicaRequestRetry(pending);
      });
  }

  private releaseReplicaRequest(pending: PendingReplicaRequest): void {
    pending.cancelRetry?.();
    pending.cancelRetry = null;
    this.deps.context().scheduler.cancelOwner(pending.owner.ownerId);
    pending.signal.removeEventListener("abort", pending.onAbort);
    if (this.pendingReplica === pending) {
      this.pendingReplica = null;
    }
  }

  // -------------------------------------------------------------------------
  // Authority response lease
  // -------------------------------------------------------------------------

  private handleRecoveryRequest(ctx: CoopFrameContextV2, request: CoopRecoveryRequestV2): void {
    const contextIssue = this.peerFrameIssue(ctx);
    if (!this.isLocalAuthority() || ctx.senderSeatId === ctx.authoritySeatId || contextIssue != null) {
      this.failClosed(`Invalid Authority V2 recovery request frame: ${contextIssue ?? "wrong sender role"}.`);
      return;
    }
    const completionKey = `${ctx.senderSeatId}:${request.requestId}`;
    const completed = this.completedAuthority.get(completionKey);
    if (completed != null) {
      if (!requestEquals(completed.request, request)) {
        this.failClosed(`Peer seat ${ctx.senderSeatId} reused a completed Authority V2 recovery identity.`);
      }
      // This request was already proven applied. A delayed carrier duplicate is inert.
      return;
    }
    const prior = this.authorityResponses.get(ctx.senderSeatId);
    if (prior != null) {
      if (!requestEquals(prior.request, request)) {
        this.failClosed(`Peer seat ${ctx.senderSeatId} opened a conflicting Authority V2 recovery request.`);
        return;
      }
      this.sendAuthorityResponse(prior);
      return;
    }
    const slice = this.deps.log.recoverySlice(request.capturedFrontier);
    if (slice == null) {
      this.failClosed(
        `Authority V2 recovery request ${request.requestId} cannot prove a contiguous log tail from `
          + `${request.capturedFrontier}.`,
      );
      return;
    }
    let material: CoopAuthoritativeMaterial | null;
    try {
      material = this.deps.captureMaterial(this.deps.context());
    } catch (error) {
      this.failClosed(`Authority V2 recovery capture threw: ${describeError(error)}.`);
      return;
    }
    if (material == null) {
      // Capture is permitted only at an engine-declared safe boundary. Keeping
      // the request unanswered makes the replica's retained request lease retry
      // without publishing a partial/mid-mutation image.
      return;
    }
    if (material.digest.length === 0) {
      this.failClosed(`Authority V2 recovery request ${request.requestId} captured malformed material.`);
      return;
    }
    const frame = this.deps.frame();
    let bundle: CoopRecoveryBundle;
    try {
      bundle = this.buildBundle(request, frame, material, slice);
    } catch (error) {
      this.failClosed(`Authority V2 recovery bundle construction failed: ${describeError(error)}.`);
      return;
    }
    const response: PendingAuthorityResponse = {
      requesterSeatId: ctx.senderSeatId,
      request,
      owner: {
        ownerId: `authority-v2:recovery-response:${ctx.senderSeatId}:${request.requestId}`,
        address: `authority-v2/recovery/response/seat${ctx.senderSeatId}/${request.requestId}`,
        reason: "redeliver correlated recovery bundle until recoveryApplied proof",
      },
      bundle,
      attempt: 0,
      cancelRetry: null,
    };
    this.authorityResponses.set(ctx.senderSeatId, response);
    this.sendAuthorityResponse(response);
    this.armAuthorityResponseRetry(response);
    this.deps
      .context()
      .scheduler.schedule(response.owner, this.deps.absoluteTimeoutMs ?? DEFAULT_ABSOLUTE_TIMEOUT_MS, "absolute", () =>
        this.failClosed(`Authority V2 recovery response ${request.requestId} exceeded its absolute ceiling.`),
      );
  }

  private buildBundle(
    request: CoopRecoveryRequestV2,
    frame: CoopFrameContextV2,
    material: CoopAuthoritativeMaterial,
    slice: CoopAuthorityRecoverySliceV2,
  ): CoopRecoveryBundle {
    return deepFreeze({
      requestId: request.requestId,
      context: cloneFrozen(frame),
      material: cloneFrozen(material),
      frontier: slice.frontier,
      membershipRevision: frame.membershipRevision,
      nextControl: cloneFrozen(slice.nextControl),
      requiredTail: slice.requiredTail.map(entry => cloneFrozen({ ...entry, context: frame })),
    });
  }

  private sendAuthorityResponse(response: PendingAuthorityResponse): void {
    if (this.authorityResponses.get(response.requesterSeatId) !== response) {
      return;
    }
    const bundle = response.bundle;
    try {
      this.deps.send({
        v: COOP_FRAME_PROTOCOL_VERSION,
        t: "recoveryBundle",
        ctx: bundle.context,
        body: {
          requestId: bundle.requestId,
          material: bundle.material,
          frontier: bundle.frontier,
          membershipRevision: bundle.membershipRevision,
          nextControl: bundle.nextControl,
          requiredTail: bundle.requiredTail.map(withoutEntryContext),
        },
      });
    } catch {
      // Retained response lease retries through the scheduler.
    }
  }

  private armAuthorityResponseRetry(response: PendingAuthorityResponse): void {
    if (this.authorityResponses.get(response.requesterSeatId) !== response || response.cancelRetry != null) {
      return;
    }
    response.cancelRetry = this.deps
      .context()
      .scheduler.schedule(response.owner, retryDelay(response.attempt++), "recovery", () => {
        response.cancelRetry = null;
        this.sendAuthorityResponse(response);
        this.armAuthorityResponseRetry(response);
      });
  }

  private releaseAuthorityResponse(response: PendingAuthorityResponse): void {
    response.cancelRetry?.();
    response.cancelRetry = null;
    this.deps.context().scheduler.cancelOwner(response.owner.ownerId);
    if (this.authorityResponses.get(response.requesterSeatId) === response) {
      this.authorityResponses.delete(response.requesterSeatId);
    }
  }

  // -------------------------------------------------------------------------
  // Response/proof intake
  // -------------------------------------------------------------------------

  private handleRecoveryBundle(
    ctx: CoopFrameContextV2,
    body: Extract<CoopFrameV2, { t: "recoveryBundle" }>["body"],
  ): void {
    const contextIssue = this.peerFrameIssue(ctx);
    if (this.isLocalAuthority() || ctx.senderSeatId !== ctx.authoritySeatId || contextIssue != null) {
      this.failClosed(`Invalid Authority V2 recovery bundle frame: ${contextIssue ?? "wrong sender role"}.`);
      return;
    }
    const bundle: CoopRecoveryBundle = {
      requestId: body.requestId,
      context: ctx,
      material: body.material,
      frontier: body.frontier,
      membershipRevision: body.membershipRevision,
      nextControl: body.nextControl,
      requiredTail: body.requiredTail.map(entry => ({ context: ctx, ...entry })),
    };
    const pending = this.pendingReplica;
    if (pending != null && pending.request.requestId === body.requestId) {
      this.resolvedBundleFingerprints.set(body.requestId, bundleFingerprint(bundle));
      this.releaseReplicaRequest(pending);
      pending.resolve(bundle);
      return;
    }
    const completed = this.completedReplica.get(body.requestId);
    if (completed != null && completed.bundleFingerprint === bundleFingerprint(bundle)) {
      this.sendRecoveryApplied(completed.proof);
    }
    // Otherwise this is a delayed response from a superseded request. Correlation makes it inert.
  }

  private completeReplicaRecovery(proof: CoopRecoveryAppliedProofV2): void {
    if (this.activeTransaction == null) {
      throw new Error("Authority V2 recovery completion has no active transaction");
    }
    const controlId = proof.controlId;
    const completed: CompletedReplicaRecovery = {
      proof: Object.freeze({ ...proof }),
      // The exact bundle fingerprint is installed when the response resolves below. A completion that reached
      // this point necessarily came from the active response, which is retained transiently on the transaction.
      bundleFingerprint: this.lastResolvedBundleFingerprint(proof.requestId),
    };
    this.rememberCompletedReplica(proof.requestId, completed);
    this.sendRecoveryApplied({
      ...proof,
      ...(controlId === undefined ? {} : { controlId }),
    });
  }

  private lastResolvedBundleFingerprint(requestId: string): string {
    const fingerprint = this.resolvedBundleFingerprints.get(requestId);
    if (fingerprint == null) {
      throw new Error(`Authority V2 recovery ${requestId} lost its resolved bundle fingerprint`);
    }
    this.resolvedBundleFingerprints.delete(requestId);
    return fingerprint;
  }

  private rememberCompletedReplica(requestId: string, completed: CompletedReplicaRecovery): void {
    this.completedReplica.set(requestId, completed);
    while (this.completedReplica.size > COMPLETION_CACHE_LIMIT) {
      const oldest = this.completedReplica.keys().next().value;
      if (typeof oldest !== "string") {
        break;
      }
      this.completedReplica.delete(oldest);
    }
  }

  private sendRecoveryApplied(proof: CoopRecoveryAppliedProofV2): void {
    try {
      this.deps.send({
        v: COOP_FRAME_PROTOCOL_VERSION,
        t: "recoveryApplied",
        ctx: this.deps.frame(),
        body: proof,
      });
    } catch {
      // The authority retains and redelivers the bundle; its duplicate drives this proof again.
    }
  }

  private handleRecoveryApplied(ctx: CoopFrameContextV2, proof: CoopRecoveryAppliedProofV2): void {
    const contextIssue = this.peerFrameIssue(ctx);
    if (!this.isLocalAuthority() || ctx.senderSeatId === ctx.authoritySeatId || contextIssue != null) {
      this.failClosed(`Invalid Authority V2 recoveryApplied frame: ${contextIssue ?? "wrong sender role"}.`);
      return;
    }
    const completionKey = `${ctx.senderSeatId}:${proof.requestId}`;
    if (this.completedAuthority.has(completionKey)) {
      return;
    }
    const response = this.authorityResponses.get(ctx.senderSeatId);
    if (response == null || response.request.requestId !== proof.requestId) {
      return; // delayed proof for an already-superseded response
    }
    const expectedControlId =
      response.bundle.nextControl == null ? undefined : controlIdOf(response.bundle.nextControl);
    if (
      proof.frontier !== response.bundle.frontier
      || proof.materialDigest !== response.bundle.material.digest
      || proof.controlId !== expectedControlId
    ) {
      this.failClosed(`Authority V2 recoveryApplied ${proof.requestId} does not match its retained bundle.`);
      return;
    }
    this.releaseAuthorityResponse(response);
    this.completedAuthority.set(completionKey, { request: response.request });
    while (this.completedAuthority.size > COMPLETION_CACHE_LIMIT) {
      const oldest = this.completedAuthority.keys().next().value;
      if (typeof oldest !== "string") {
        break;
      }
      this.completedAuthority.delete(oldest);
    }
  }

  // -------------------------------------------------------------------------
  // Authentication / failure
  // -------------------------------------------------------------------------

  private isLocalAuthority(): boolean {
    const frame = this.deps.frame();
    return frame.senderSeatId === frame.authoritySeatId;
  }

  private peerFrameIssue(remote: CoopFrameContextV2): string | null {
    const local = this.deps.frame();
    if (!isSameSessionIdentity(remote, local)) {
      return "session identity mismatch";
    }
    if (
      remote.sessionEpoch !== local.sessionEpoch
      || remote.membershipRevision !== local.membershipRevision
      || remote.authoritySeatId !== local.authoritySeatId
      || remote.senderSeatId === local.senderSeatId
    ) {
      return "epoch, membership, authority, or sender mismatch";
    }
    const peer = this.deps.peerBindings().find(binding => binding.seatId === remote.senderSeatId);
    return peer == null || peer.connectionGeneration !== remote.connectionGeneration
      ? "unbound peer connection generation"
      : null;
  }

  private failClosed(reason: string): void {
    if (this.terminalized || this.disposed) {
      return;
    }
    this.terminalized = true;
    this.activeTransaction?.abort(reason);
    this.fence.terminalize(reason);
    const pending = this.pendingReplica;
    if (pending != null) {
      this.releaseReplicaRequest(pending);
      pending.reject(new Error(reason));
    }
    for (const response of [...this.authorityResponses.values()]) {
      this.releaseAuthorityResponse(response);
    }
    this.deps.onTerminal(reason);
  }
}
