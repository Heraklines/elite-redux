/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - Lane 2, THE one authoritative log (authority-log).
//
// The single retained frontier (frozen decision 2). It REPLACES both retired
// retention systems (coop-durability's journal + coop-battle-stream) and imports
// from NEITHER. Engine-free: the only contract imports are TYPES, so the compiled
// module has zero Phaser / globalScene dependency; every timer rides the injected
// CoopScheduler (never raw setTimeout) and every wire egress the injected send.
//
// Two roles, one object (a node is one or the other per session, but the log
// exposes both method sets per the contract):
//
//  AUTHORITY
//   - commit(entry) assigns the next global revision, deep-freezes + retains it,
//     delivers it once, then REDELIVERS on a backoff via an explicit DeliveryLease
//     until the replica's `admitted` receipt arrives (retries STOP at admitted -
//     nothing else). Retention itself holds LONGER: until the frozen retirement
//     rule is met (admitted + materialApplied + controlInstalled-where-nextControl
//     != null); presentationSettled is NEVER required.
//   - acceptReceipt(receipt) validates per-operation stage ordering, retires the
//     entry when it reaches its required stage, and - on an `admitted` receipt -
//     retires every revision the entry explicitly subsumes (supersession by log
//     order). Every retirement / subsumption CANCELS the entry's lease timers via
//     scheduler.cancelOwner: ZERO orphan timers.
//
//  REPLICA
//   - admit(entry) classifies one delivered entry against the local frame context
//     (epoch + membershipRevision + seatMap) and the ordering cursor: admitted /
//     duplicate (never re-applied) / gap (requests the tail via send, NO local
//     retry loop - the authority's redelivery is the only retry) / staleEpoch /
//     rejected.
//
// diagnostics() exposes the live lease/timer counts so tests can prove the
// no-orphan-timer invariant directly.
// =============================================================================

import {
  freezeAuthorityEntry,
  isSameSessionIdentity,
  isValidAuthorityEntry,
  isValidFrameContext,
  isValidOperationId,
  isValidRevision,
  receiptMatchesEntry,
} from "#data/elite-redux/coop/authority-v2/authority-entry";
import { AuthorityLedger, BoundedRevisionWindow } from "#data/elite-redux/coop/authority-v2/authority-ledger";
import type {
  CoopAckStage,
  CoopAdmitResult,
  CoopAuthorityEntry,
  CoopAuthorityLog,
  CoopAuthorityReceipt,
  CoopFrameContextV2,
  CoopScheduler,
  CoopTimeClass,
  CoopTimerOwner,
} from "#data/elite-redux/coop/authority-v2/contract";

/** Monotonic index of each ACK stage. Retirement compares against these; presentationSettled is never required. */
const STAGE_ORDER: Readonly<Record<CoopAckStage, number>> = {
  admitted: 0,
  materialApplied: 1,
  controlInstalled: 2,
  presentationSettled: 3,
};

/** No receipt observed yet for a lease. */
const STAGE_NONE = -1;

function isAckStage(value: unknown): value is CoopAckStage {
  return (
    value === "admitted"
    || value === "materialApplied"
    || value === "controlInstalled"
    || value === "presentationSettled"
  );
}

/**
 * The wire frames this log emits. AUTHORITY redelivers committed entries; REPLICA asks for the tail after a
 * gap. The transport adapter maps these onto the real carrier - the log itself is engine/transport-free.
 */
export type CoopAuthorityWire =
  | { readonly kind: "deliver"; readonly entry: CoopAuthorityEntry }
  | { readonly kind: "requestTail"; readonly context: CoopFrameContextV2; readonly missingFrom: number };

/** Exponential backoff schedule for delivery redelivery (active-time; the scheduler owns the actual clock). */
export interface DeliveryBackoff {
  readonly initialMs: number;
  readonly maxMs: number;
  readonly factor: number;
}

/** Default redelivery backoff: 250ms doubling to a 5s ceiling. */
export const COOP_DEFAULT_DELIVERY_BACKOFF: DeliveryBackoff = { initialMs: 250, maxMs: 5_000, factor: 2 };

/** Default hard cap on retained-but-unretired entries (safety valve against unbounded growth). */
export const COOP_DEFAULT_RETAIN_CAPACITY = 512;

export interface AuthorityLogOptions {
  /** Local frame identity - admit() classifies inbound entries against this (epoch / membership / seatMap). */
  readonly localContext: CoopFrameContextV2;
  /** Runtime clock/timer surface (contract). EVERY delivery timer goes through it - never raw setTimeout. */
  readonly scheduler: CoopScheduler;
  /** Wire egress: AUTHORITY redelivers entries; REPLICA requests tails on gaps. */
  readonly send: (wire: CoopAuthorityWire) => void;
  /** Owner-id prefix for this log's timers (default derived from the local session + seat). */
  readonly ownerId?: string;
  /** Hard cap on retained-but-unretired entries (default {@linkcode COOP_DEFAULT_RETAIN_CAPACITY}). */
  readonly retainCapacity?: number;
  /** Delivery-retry backoff (default {@linkcode COOP_DEFAULT_DELIVERY_BACKOFF}). */
  readonly backoff?: DeliveryBackoff;
  /** Time class the delivery retries consume (default "connected"). */
  readonly deliveryTimeClass?: CoopTimeClass;
  /**
   * Optional cap on REDELIVERY attempts before a lease goes inert (default unbounded: retries stop only at
   * `admitted` or dispose). A cap bounds a pathologically dark channel; retention is unaffected.
   */
  readonly maxDeliveryAttempts?: number;
}

/**
 * The explicit lease object backing ONE entry's redelivery retry loop. Every retry loop owns a lease so a
 * retirement / subsumption / dispose has a single place to stop it (cancel the pending timer + cancelOwner)
 * - the no-orphan-timer guarantee. The lease also carries the highest observed ACK stage, so retirement is a
 * pure comparison against the entry's required stage.
 */
interface DeliveryLease {
  readonly revision: number;
  readonly entry: CoopAuthorityEntry;
  readonly owner: CoopTimerOwner;
  /** Highest ACK-stage index observed via receipts (STAGE_NONE before any). */
  stage: number;
  attempts: number;
  /** Cancel handle for the currently pending retry timer, or null when none is scheduled. */
  cancelTimer: (() => void) | null;
  /** Whether redelivery retries are stopped (admitted reached, attempts exhausted, retired, or disposed). */
  stopped: boolean;
  /** Whether this entry's subsumption list has already been actioned (once, on first reaching admitted). */
  subsumptionDone: boolean;
}

/** Live counts for the no-orphan-timer + bounded-retention invariants (asserted directly in tests). */
export interface AuthorityLogDiagnostics {
  readonly retainedEntries: number;
  readonly deliveryLeases: number;
  readonly activeDeliveryTimers: number;
  readonly appliedThrough: number;
  readonly headRevision: number;
  readonly disposed: boolean;
}

/**
 * The concrete {@linkcode CoopAuthorityLog}. One per live session; the authority side and the replica side
 * each hold one (the same class, different methods exercised).
 */
export class AuthorityLog implements CoopAuthorityLog {
  private readonly localContext: CoopFrameContextV2;
  private readonly scheduler: CoopScheduler;
  private readonly send: (wire: CoopAuthorityWire) => void;
  private readonly ownerBase: string;
  private readonly backoff: DeliveryBackoff;
  private readonly deliveryTimeClass: CoopTimeClass;
  private readonly maxDeliveryAttempts: number | null;

  /** AUTHORITY: retained-but-unretired entries, bounded + revision-ordered, keyed by their delivery lease. */
  private readonly retainedWindow: BoundedRevisionWindow<DeliveryLease>;
  /** REPLICA: the applied-through ordering cursor. */
  private readonly ledger: AuthorityLedger;
  /** AUTHORITY: the highest revision assigned (commit assigns headRevision + 1). */
  private headRevision = 0;
  private disposed = false;

  constructor(options: AuthorityLogOptions) {
    if (!isValidFrameContext(options.localContext)) {
      throw new Error("AuthorityLog requires a valid CoopFrameContextV2 as localContext");
    }
    this.localContext = options.localContext;
    this.scheduler = options.scheduler;
    this.send = options.send;
    this.ownerBase =
      options.ownerId ?? `authority-v2:${options.localContext.sessionId}:seat${options.localContext.senderSeatId}`;
    this.backoff = options.backoff ?? COOP_DEFAULT_DELIVERY_BACKOFF;
    this.deliveryTimeClass = options.deliveryTimeClass ?? "connected";
    this.maxDeliveryAttempts =
      options.maxDeliveryAttempts != null && Number.isSafeInteger(options.maxDeliveryAttempts)
        ? options.maxDeliveryAttempts
        : null;
    this.retainedWindow = new BoundedRevisionWindow<DeliveryLease>(
      options.retainCapacity ?? COOP_DEFAULT_RETAIN_CAPACITY,
    );
    this.ledger = new AuthorityLedger();
    if (
      !Number.isSafeInteger(this.backoff.initialMs)
      || this.backoff.initialMs <= 0
      || !Number.isSafeInteger(this.backoff.maxMs)
      || this.backoff.maxMs < this.backoff.initialMs
      || !(this.backoff.factor >= 1)
    ) {
      throw new Error("AuthorityLog requires a valid delivery backoff (0 < initialMs <= maxMs, factor >= 1)");
    }
  }

  // ---------------------------------------------------------------------------
  // AUTHORITY side
  // ---------------------------------------------------------------------------

  /** Commit the next entry: assign the next global revision, freeze + retain it, deliver + start redelivery. */
  commit(entry: Omit<CoopAuthorityEntry, "revision">): CoopAuthorityEntry {
    if (this.disposed) {
      throw new Error("AuthorityLog.commit after dispose");
    }
    if (!isValidOperationId(entry.operationId)) {
      throw new Error(`AuthorityLog.commit: invalid operationId ${String(entry.operationId)}`);
    }
    if (!isValidFrameContext(entry.context)) {
      throw new Error("AuthorityLog.commit: invalid entry frame context");
    }
    const revision = this.headRevision + 1;
    // Own an immutable, caller-independent copy so a caller reusing/mutating its source object can never
    // rewrite what a later redelivery transmits (the retention immutability boundary).
    const committed = freezeAuthorityEntry(cloneEntry({ ...entry, revision }));
    this.headRevision = revision;

    const lease: DeliveryLease = {
      revision,
      entry: committed,
      owner: {
        ownerId: `${this.ownerBase}:deliver:${revision}`,
        address: `authority-v2/deliver/${revision}`,
        reason: `redeliver revision ${revision} until admitted`,
      },
      stage: STAGE_NONE,
      attempts: 0,
      cancelTimer: null,
      stopped: false,
      subsumptionDone: false,
    };
    const evicted = this.retainedWindow.set(revision, lease);
    if (evicted != null) {
      this.stopLease(evicted.value);
    }

    // Deliver once immediately, then redeliver on the backoff until admitted.
    this.send({ kind: "deliver", entry: committed });
    this.scheduleRedelivery(lease);
    return committed;
  }

  /** Receipt intake: validate stage ordering, retire on required stage, action subsumption on admitted. */
  acceptReceipt(receipt: CoopAuthorityReceipt): boolean {
    if (this.disposed) {
      return false;
    }
    if (!isValidRevision(receipt.revision) || !isValidOperationId(receipt.operationId) || !isAckStage(receipt.stage)) {
      return false;
    }
    if (!isValidFrameContext(receipt.context)) {
      return false;
    }
    // A receipt from a different session identity or epoch can never advance a retained entry's stage.
    if (
      !isSameSessionIdentity(receipt.context, this.localContext)
      || receipt.context.sessionEpoch !== this.localContext.sessionEpoch
    ) {
      return false;
    }
    const lease = this.retainedWindow.get(receipt.revision);
    if (lease == null || !receiptMatchesEntry(receipt, lease.entry)) {
      // Unknown, already-retired, or identity-mismatched revision: nothing to advance.
      return false;
    }
    const stageIdx = STAGE_ORDER[receipt.stage];
    // Per-operation stage ordering: stages are monotonic. A same/older stage is a duplicate receipt - a safe
    // no-op that never re-advances or re-retires.
    if (stageIdx <= lease.stage) {
      return false;
    }
    lease.stage = stageIdx;

    // Delivery retries STOP at admitted (nothing else). Retention holds until the retirement rule.
    if (stageIdx >= STAGE_ORDER.admitted) {
      this.stopLeaseDelivery(lease);
    }
    // Supersession by log order: when this entry is admitted, retire every revision it explicitly subsumes.
    if (!lease.subsumptionDone) {
      lease.subsumptionDone = true;
      for (const subsumed of lease.entry.subsumes) {
        this.retire(subsumed);
      }
    }
    // Retirement rule: admitted + materialApplied + (controlInstalled where nextControl != null). Never
    // presentationSettled.
    const required = lease.entry.nextControl == null ? STAGE_ORDER.materialApplied : STAGE_ORDER.controlInstalled;
    if (lease.stage >= required) {
      return this.retire(receipt.revision);
    }
    return false;
  }

  /** Retained-but-unretired entries in revision order (contract). */
  retained(): readonly CoopAuthorityEntry[] {
    return this.retainedWindow.values().map(lease => lease.entry);
  }

  // ---------------------------------------------------------------------------
  // REPLICA side
  // ---------------------------------------------------------------------------

  /** Classify + admit one delivered entry against the local frame context + ordering cursor. */
  admit(entry: CoopAuthorityEntry): CoopAdmitResult {
    if (this.disposed) {
      return { kind: "rejected", reason: "disposed" };
    }
    if (!isValidAuthorityEntry(entry)) {
      return { kind: "rejected", reason: "malformed-entry" };
    }
    // Session identity (sessionId / runId / seatMap) must match exactly - a frame from a different run or
    // seat map is a hard reject, not a stale epoch.
    if (!isSameSessionIdentity(entry.context, this.localContext)) {
      return { kind: "rejected", reason: "session-mismatch" };
    }
    // Same session, different epoch generation: stale (a superseded epoch's frame must not be applied).
    if (entry.context.sessionEpoch !== this.localContext.sessionEpoch) {
      return { kind: "staleEpoch" };
    }
    // Membership must match (seat roster generation): a frame from a stale membership is rejected.
    if (entry.context.membershipRevision !== this.localContext.membershipRevision) {
      return { kind: "rejected", reason: "membership-mismatch" };
    }
    switch (this.ledger.classify(entry.revision)) {
      case "duplicate":
        // Already applied (a safe redelivery): the caller must NOT re-apply material.
        return { kind: "duplicate" };
      case "gap": {
        // Request the missing tail via the injected send. No local retry loop - the authority's redelivery
        // is the ONLY retry, so a replica can never spin an orphan request loop (the exact prior hazard).
        const missingFrom = this.ledger.missingFrom();
        this.send({ kind: "requestTail", context: this.localContext, missingFrom });
        return { kind: "gap", missingFrom };
      }
      default:
        // Exactly the next revision: advance the cursor. The caller applies material after this returns.
        this.ledger.markApplied(entry.revision);
        return { kind: "admitted" };
    }
  }

  /** The applied-through revision frontier (replica cursor). */
  appliedThrough(): number {
    return this.ledger.appliedThrough();
  }

  // ---------------------------------------------------------------------------
  // BOTH
  // ---------------------------------------------------------------------------

  /** Adopt a proven snapshot high-water (recovery): fast-forward the cursor; retire entries it has proven. */
  adoptFrontier(revision: number): void {
    if (this.disposed || !Number.isSafeInteger(revision) || revision <= 0) {
      return;
    }
    // Replica: fast-forward the applied cursor past any gap the snapshot filled.
    this.ledger.adoptFrontier(revision);
    // Authority: keep the assignment head at/above the frontier so no revision is ever reused.
    if (revision > this.headRevision) {
      this.headRevision = revision;
    }
    // Authority: any retained entry at/below the proven frontier is now redundant - retire it (+ cancel its
    // lease). A snapshot is a proof the replica applied through `revision`.
    for (const rev of this.retainedWindow.revisions()) {
      if (rev <= revision) {
        this.retire(rev);
      }
    }
  }

  /** Dispose every timer/lease this log owns (teardown): zero orphan timers, zero leases. */
  dispose(_reason: string): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const lease of this.retainedWindow.values()) {
      this.stopLease(lease);
    }
    this.retainedWindow.clear();
  }

  /** Live counts for the no-orphan-timer + bounded-retention invariants (tests assert these directly). */
  diagnostics(): AuthorityLogDiagnostics {
    const leases = this.retainedWindow.values();
    return {
      retainedEntries: leases.length,
      deliveryLeases: leases.length,
      activeDeliveryTimers: leases.filter(l => l.cancelTimer != null && !l.stopped).length,
      appliedThrough: this.ledger.appliedThrough(),
      headRevision: this.headRevision,
      disposed: this.disposed,
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Retire one revision: stop its lease (cancel timers) and drop it from retention. Returns true iff present. */
  private retire(revision: number): boolean {
    const lease = this.retainedWindow.get(revision);
    if (lease == null) {
      return false;
    }
    this.stopLease(lease);
    this.retainedWindow.delete(revision);
    return true;
  }

  /** Stop a lease's redelivery loop AND cancel every timer it owns (retirement / subsumption / dispose). */
  private stopLease(lease: DeliveryLease): void {
    this.stopLeaseDelivery(lease);
    // Belt-and-braces: cancel by owner so any timer the scheduler still holds for this lease is gone.
    this.scheduler.cancelOwner(lease.owner.ownerId);
  }

  /** Stop a lease's redelivery loop (admitted reached): cancel the pending timer + mark it stopped. */
  private stopLeaseDelivery(lease: DeliveryLease): void {
    lease.stopped = true;
    if (lease.cancelTimer != null) {
      lease.cancelTimer();
      lease.cancelTimer = null;
    }
  }

  /** Schedule the next redelivery for a lease (unless stopped / disposed / attempt cap reached). */
  private scheduleRedelivery(lease: DeliveryLease): void {
    if (this.disposed || lease.stopped) {
      return;
    }
    if (this.maxDeliveryAttempts != null && lease.attempts >= this.maxDeliveryAttempts) {
      // Attempt cap reached: the loop goes inert (retention still holds until retirement / dispose).
      lease.stopped = true;
      return;
    }
    const delay = this.backoffDelay(lease.attempts);
    lease.cancelTimer = this.scheduler.schedule(lease.owner, delay, this.deliveryTimeClass, () =>
      this.onRedeliveryTick(lease),
    );
  }

  /** Fire one redelivery, then re-arm the loop. */
  private onRedeliveryTick(lease: DeliveryLease): void {
    lease.cancelTimer = null;
    if (this.disposed || lease.stopped || !this.retainedWindow.has(lease.revision)) {
      return;
    }
    lease.attempts += 1;
    this.send({ kind: "deliver", entry: lease.entry });
    this.scheduleRedelivery(lease);
  }

  /** Exponential backoff for the Nth attempt, capped at maxMs. */
  private backoffDelay(attempt: number): number {
    const raw = this.backoff.initialMs * this.backoff.factor ** Math.max(0, attempt);
    return Math.min(this.backoff.maxMs, Math.round(raw));
  }
}

/** Shallow-to-deep structural clone of an entry (plain JSON-shaped wire value; no engine refs). */
function cloneEntry(entry: CoopAuthorityEntry): CoopAuthorityEntry {
  return {
    context: { ...entry.context },
    revision: entry.revision,
    operationId: entry.operationId,
    kind: entry.kind,
    material: { digest: entry.material.digest, payload: clonePayload(entry.material.payload) },
    nextControl: entry.nextControl == null ? null : { ...entry.nextControl },
    subsumes: [...entry.subsumes],
  };
}

/** Structurally clone an opaque JSON payload so retention is independent of the caller's object. */
function clonePayload(payload: unknown): unknown {
  if (payload == null || typeof payload !== "object") {
    return payload;
  }
  // structuredClone is available in Node >= 17 and every supported browser; the payload is a wire value.
  return structuredClone(payload);
}
