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
//     until the replica reaches the entry's required mechanical stage. Admission
//     alone never stops redelivery: a dropped material/control receipt or a failed
//     local apply must receive another delivery to retry. Retention holds until
//     the frozen retirement
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
//     duplicate-pending-material (retry material), duplicate-pending-control
//     (retry only control), duplicate-complete (re-publish final receipt), gap
//     (requests the tail via send, NO local retry loop), staleEpoch, or rejected.
//
// diagnostics() exposes the live lease/timer counts so tests can prove the
// no-orphan-timer invariant directly.
// =============================================================================

import {
  boundarySupersessionAllowsSuccessorEntry,
  isBoundarySupersessionCandidate,
} from "#data/elite-redux/coop/authority-v2/adapters/wave-terminal";
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
  CoopAuthorityPeerBindingV2,
  CoopAuthorityReceipt,
  CoopFrameContextV2,
  CoopNextControl,
  CoopRecoveryNextControl,
  CoopReplicaMechanicalStage,
  CoopScheduler,
  CoopTimeClass,
  CoopTimerOwner,
} from "#data/elite-redux/coop/authority-v2/contract";
import {
  controlAllowsSuccessorEntry,
  controlIdOf,
  controlsEqual,
  validateNextControl,
} from "#data/elite-redux/coop/authority-v2/next-control";

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

function validatePeerBindings(
  peers: readonly CoopAuthorityPeerBindingV2[],
  localSeatId: number,
): readonly CoopAuthorityPeerBindingV2[] {
  if (!Array.isArray(peers) || peers.length === 0) {
    throw new Error("AuthorityLog requires at least one authenticated remote peer binding");
  }
  const seen = new Set<number>();
  const validated: CoopAuthorityPeerBindingV2[] = [];
  for (const peer of peers) {
    if (
      !Number.isSafeInteger(peer?.seatId)
      || peer.seatId < 0
      || peer.seatId === localSeatId
      || seen.has(peer.seatId)
      || !Number.isSafeInteger(peer.connectionGeneration)
      || peer.connectionGeneration < 0
    ) {
      throw new Error("AuthorityLog requires unique non-local peer seats with valid connection generations");
    }
    seen.add(peer.seatId);
    validated.push(Object.freeze({ ...peer }));
  }
  return Object.freeze(validated.sort((left, right) => left.seatId - right.seatId));
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

/** A bounded log refuses a new commit rather than evicting an unresolved authoritative revision. */
export class AuthorityRetentionOverflowError extends Error {
  readonly code = "authority-retention-overflow";
  readonly capacity: number;
  readonly attemptedRevision: number;

  constructor(capacity: number, attemptedRevision: number) {
    super(`AuthorityLog retention capacity ${capacity} reached before revision ${attemptedRevision}`);
    this.name = "AuthorityRetentionOverflowError";
    this.capacity = capacity;
    this.attemptedRevision = attemptedRevision;
  }
}

/** Typed outcome for an authority commit attempt. A deferred entry already owns its future revision. */
export type AuthorityCommitDisposition =
  | { readonly kind: "committed"; readonly entry: CoopAuthorityEntry }
  | {
      readonly kind: "deferred";
      readonly entry: CoopAuthorityEntry;
      readonly reason: "predecessor-control-not-installed";
    }
  | { readonly kind: "failed"; readonly reason: string };

/** One-shot boundary notification when a bounded delivery lease can no longer redrive itself. */
export interface AuthorityDeliveryExhaustion {
  readonly kind: "delivery-exhausted";
  readonly reason: "max-delivery-attempts";
  readonly revision: number;
  readonly operationId: string;
  readonly entryKind: CoopAuthorityEntry["kind"];
  /** Number of scheduled redelivery attempts that were actually sent. */
  readonly attempts: number;
  readonly maxAttempts: number;
  /** The exact retained immutable entry; exhaustion never retires or evicts it. */
  readonly entry: CoopAuthorityEntry;
}

/** Internal compatibility error: the historical commit() API still throws, while detailed callers classify it. */
class AuthorityCommitDeferredError extends Error {
  readonly entry: CoopAuthorityEntry;

  constructor(entry: CoopAuthorityEntry) {
    super(`AuthorityLog.commit: predecessor control is not installed for revision ${entry.revision}`);
    this.name = "AuthorityCommitDeferredError";
    this.entry = entry;
  }
}

export interface AuthorityLogOptions {
  /** Local frame identity - admit() classifies inbound entries against this (epoch / membership / seatMap). */
  readonly localContext: CoopFrameContextV2;
  /** Runtime clock/timer surface (contract). EVERY delivery timer goes through it - never raw setTimeout. */
  readonly scheduler: CoopScheduler;
  /** Wire egress: AUTHORITY redelivers entries; REPLICA requests tails on gaps. */
  readonly send: (wire: CoopAuthorityWire) => void;
  /**
   * Authenticated remote seats for this exact membership/channel generation. Authority commits freeze one
   * receipt stage per peer; replicas accept entries only from the bound authority peer.
   */
  readonly peerBindings: readonly CoopAuthorityPeerBindingV2[];
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
   * mechanical retirement or dispose). A cap bounds a pathologically dark channel; retention is unaffected.
   */
  readonly maxDeliveryAttempts?: number;
  /** One-shot diagnostic/disposition hook when a capped lease becomes inert while still retained. */
  readonly onDeliveryExhausted?: (disposition: AuthorityDeliveryExhaustion) => void;
}

/**
 * The explicit lease object backing ONE entry's redelivery retry loop. Every retry loop owns a lease so a
 * retirement / subsumption / dispose has a single place to stop it (cancel the pending timer + cancelOwner)
 * - the no-orphan-timer guarantee. The lease also carries the highest observed ACK stage, so retirement is a
 * pure comparison against the entry's required stage.
 */
interface DeliveryLease {
  readonly revision: number;
  entry: CoopAuthorityEntry;
  readonly owner: CoopTimerOwner;
  /** Frozen remote receipt quorum and each seat's highest stage (STAGE_NONE before any). */
  readonly peerStages: Map<number, { readonly connectionGeneration: number; stage: number }>;
  attempts: number;
  /** Cancel handle for the currently pending retry timer, or null when none is scheduled. */
  cancelTimer: (() => void) | null;
  /** Whether redelivery retries are stopped (attempts exhausted, retired, or disposed). */
  stopped: boolean;
  /** Whether this entry's subsumption list has already been actioned (once, on first reaching admitted). */
  subsumptionDone: boolean;
  /** Whether the bounded-attempt disposition has already been emitted for this lease. */
  exhaustionNotified: boolean;
}

/** Immutable approval captured only after the full retained-frontier boundary predicate passes. */
interface AuthorityBoundaryApproval {
  readonly predecessorRevision: number;
  readonly predecessorOperationId: string;
  readonly predecessorControlId: string;
  readonly successorRevision: number;
  readonly successorOperationId: string;
  readonly successorKind: CoopAuthorityEntry["kind"];
  readonly successorMaterialDigest: string;
  readonly successorControlId: string;
  readonly subsumes: readonly number[];
  /** Exact retained source images that made the initial canonical subsumes proof succeed. */
  readonly trustedSources: readonly CoopAuthorityEntry[];
}

/**
 * Exact proof scope exposed only while an AuthorityLog-authenticated entry is synchronously handed to the
 * live control ledger. The retained set bounds archive lifetime; boundarySources preserves an initially
 * approved deferred boundary even if an unrelated retained lease retires before retry.
 */
export type AuthorityEntryProofScope =
  | {
      readonly kind: "authority-retained";
      readonly retainedSources: readonly CoopAuthorityEntry[];
      readonly boundarySources: readonly CoopAuthorityEntry[] | null;
    }
  | {
      readonly kind: "replica-dense-frontier";
      readonly source: CoopAuthorityEntry;
      /** Every positive revision at or below this cursor was authenticated and mechanically completed. */
      readonly authenticatedThrough: number;
      /** Prevent a retained object reference from reusing this privilege after its log frontier moved. */
      readonly isActive: () => boolean;
    };

const authorityEntryProofScopes = new WeakMap<CoopAuthorityEntry, AuthorityEntryProofScope>();

/** Internal live-ledger seam: an unrecognized object identity never inherits another entry's proof. */
export function authorityEntryProofScopeOf(entry: CoopAuthorityEntry): AuthorityEntryProofScope | null {
  return authorityEntryProofScopes.get(entry) ?? null;
}

/** Consume the replica's one-shot handoff after the intended live ledger registers the admitted entry. */
export function consumeReplicaEntryProofScope(entry: CoopAuthorityEntry, scope: AuthorityEntryProofScope): void {
  if (scope.kind === "replica-dense-frontier" && authorityEntryProofScopes.get(entry) === scope) {
    authorityEntryProofScopes.delete(entry);
  }
}

function withAuthorityEntryProofScope<T>(
  entry: CoopAuthorityEntry,
  scope: AuthorityEntryProofScope,
  callback: () => T,
): T {
  const prior = authorityEntryProofScopes.get(entry);
  authorityEntryProofScopes.set(entry, scope);
  try {
    return callback();
  } finally {
    if (prior == null) {
      authorityEntryProofScopes.delete(entry);
    } else {
      authorityEntryProofScopes.set(entry, prior);
    }
  }
}

function allPeersReached(lease: DeliveryLease, requiredStage: number): boolean {
  return [...lease.peerStages.values()].every(peer => peer.stage >= requiredStage);
}

/** Live counts for the no-orphan-timer + bounded-retention invariants (asserted directly in tests). */
export interface AuthorityLogDiagnostics {
  readonly retainedEntries: number;
  readonly deliveryLeases: number;
  readonly activeDeliveryTimers: number;
  readonly receivedThrough: number;
  readonly appliedThrough: number;
  readonly controlInstalledThrough: number;
  readonly headRevision: number;
  readonly retentionCapacity: number;
  readonly retentionRefusals: number;
  readonly wireSendFailures: number;
  readonly deliveryExhaustions: number;
  readonly deliveryExhaustionCallbackFailures: number;
  readonly exhaustedRevisions: readonly number[];
  readonly disposed: boolean;
}

/**
 * Exact log proof an authority may attach to one recovery snapshot.
 *
 * `requiredTail` is complete for `(capturedFrontier, frontier]`. When the frontiers are equal and nonzero,
 * it contains the exact frontier entry as a one-entry reconstruction proof; recovery destroys the old phase
 * generation and therefore needs the immutable body even though no revision is missing.
 */
export interface CoopAuthorityRecoverySliceV2 {
  readonly frontier: number;
  /** Exact operation at `frontier`; null only for the empty revision-zero log. */
  readonly frontierOperationId: string | null;
  readonly nextControl: CoopRecoveryNextControl;
  readonly requiredTail: readonly CoopAuthorityEntry[];
}

/** Exact classification of one authority-side receipt intake attempt. */
export type AuthorityReceiptVerdict =
  | {
      readonly kind: "rejected";
      readonly reason:
        | "disposed"
        | "malformed-receipt"
        | "malformed-context"
        | "session-mismatch"
        | "epoch-mismatch"
        | "unknown-revision"
        | "operation-mismatch"
        | "authority-mismatch"
        | "entry-authority-mismatch"
        | "self-signed"
        | "authority-signed"
        | "membership-mismatch"
        | "unbound-peer"
        | "connection-generation-mismatch"
        | "control-id-mismatch"
        | "unexpected-control-id"
        | "presentation-before-mechanical";
    }
  | { readonly kind: "duplicate"; readonly highestStage: number }
  | {
      readonly kind: "advanced";
      readonly retired: boolean;
      readonly waitingForSeatIds: readonly number[];
    };

/**
 * The concrete {@linkcode CoopAuthorityLog}. One per live session; the authority side and the replica side
 * each hold one (the same class, different methods exercised).
 */
export class AuthorityLog implements CoopAuthorityLog {
  private localContext: CoopFrameContextV2;
  private readonly scheduler: CoopScheduler;
  private readonly send: (wire: CoopAuthorityWire) => void;
  private readonly ownerBase: string;
  private readonly backoff: DeliveryBackoff;
  private readonly deliveryTimeClass: CoopTimeClass;
  private readonly maxDeliveryAttempts: number | null;
  private readonly onDeliveryExhausted: ((disposition: AuthorityDeliveryExhaustion) => void) | undefined;
  private readonly retentionCapacity: number;
  private peerBindings: readonly CoopAuthorityPeerBindingV2[];

  /** AUTHORITY: retained-but-unretired entries, bounded + revision-ordered, keyed by their delivery lease. */
  private readonly retainedWindow: BoundedRevisionWindow<DeliveryLease>;
  /** REPLICA: separate received, material-applied, and control-installed ordering frontiers. */
  private readonly ledger: AuthorityLedger;
  /** REPLICA: the one admitted revision that has not yet mechanically completed. */
  private pendingReplicaEntry: CoopAuthorityEntry | null = null;
  /**
   * REPLICA: one outstanding gap request. A tail response can contain the
   * missing entry followed by later retained entries. Until the missing entry
   * reaches its required mechanical stage those later entries are still gaps;
   * re-requesting the same tail from each one creates a synchronous
   * request/redelivery feedback loop on loopback and a packet storm on WebRTC.
   * The authority already owns a retry lease for the missing revision, so one
   * request remains sufficient until this frontier advances.
   */
  private pendingTailRequestFrom: number | null = null;
  /** AUTHORITY: the highest revision assigned (commit assigns headRevision + 1). */
  private headRevision = 0;
  /** AUTHORITY: constant-size successor metadata for a snapshot taken after the head entry retired. */
  private latestNextControl: CoopNextControl | null = null;
  private latestCommittedOperationId: string | null = null;
  /** AUTHORITY: one immutable frontier body retained after delivery retirement for exact recovery rebuild. */
  private latestCommittedEntry: CoopAuthorityEntry | null = null;
  /** AUTHORITY: one exact, not-yet-published successor retained after a local predecessor-control deferral. */
  private pendingAuthorityCommit: {
    readonly entry: CoopAuthorityEntry;
    readonly prepare?: (entry: CoopAuthorityEntry) => (() => void) | null;
    /** Null for an ordinary successor; non-null only after full initial boundary authorization. */
    readonly boundaryApproval: AuthorityBoundaryApproval | null;
  } | null = null;
  private pendingReplicaSuccessorControl: {
    readonly revision: number;
    readonly operationId: string;
    readonly control: CoopNextControl;
  } | null = null;
  /** Bounded quorum-stage tombstones so a waiter registered after synchronous loopback retirement is sound. */
  private readonly retiredOperationStages = new Map<string, number>();
  private readonly exhaustedRevisionSet = new Set<number>();
  private retentionRefusals = 0;
  private wireSendFailures = 0;
  private deliveryExhaustions = 0;
  private deliveryExhaustionCallbackFailures = 0;
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
    if (
      options.maxDeliveryAttempts != null
      && (!Number.isSafeInteger(options.maxDeliveryAttempts) || options.maxDeliveryAttempts < 0)
    ) {
      throw new Error("AuthorityLog requires maxDeliveryAttempts to be a non-negative safe integer");
    }
    this.maxDeliveryAttempts = options.maxDeliveryAttempts ?? null;
    this.onDeliveryExhausted = options.onDeliveryExhausted;
    this.peerBindings = validatePeerBindings(options.peerBindings, options.localContext.senderSeatId);
    this.retentionCapacity = options.retainCapacity ?? COOP_DEFAULT_RETAIN_CAPACITY;
    this.retainedWindow = new BoundedRevisionWindow<DeliveryLease>(this.retentionCapacity);
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

  /**
   * Rebind the one live log after an authenticated hot rejoin without resetting its global revision domain.
   *
   * Connection generation and membership revision are transport axes, not mechanical operation identity.
   * A channel replacement therefore re-addresses every still-retained entry and unfinished replica entry
   * while preserving revision, material, control, accepted peer stages, and delivery leases. Old-generation
   * frames immediately fail the ordinary admission checks; retained entries are re-emitted once under the
   * new binding so a frame flushed from the dark channel cannot strand the session.
   *
   * Throws on any stable-axis change, generation rollback, membership rollback, or peer-seat change. The
   * runtime converts that fail-closed verdict into the shared terminal rather than silently starting a new
   * log or falling back to a second legacy authority.
   *
   * @returns the number of retained authority entries immediately re-emitted under the new binding.
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one transaction validates every immutable and advancing authentication axis before committing the rebind
  rebindConnection(
    nextLocalContext: CoopFrameContextV2,
    nextPeerBindings: readonly CoopAuthorityPeerBindingV2[],
  ): number {
    if (this.disposed) {
      throw new Error("AuthorityLog.rebindConnection after dispose");
    }
    if (!isValidFrameContext(nextLocalContext)) {
      throw new Error("AuthorityLog.rebindConnection requires a valid local frame context");
    }
    const current = this.localContext;
    if (
      !isSameSessionIdentity(nextLocalContext, current)
      || nextLocalContext.sessionEpoch !== current.sessionEpoch
      || nextLocalContext.senderSeatId !== current.senderSeatId
      || nextLocalContext.authoritySeatId !== current.authoritySeatId
      || nextLocalContext.membershipRevision < current.membershipRevision
      || nextLocalContext.connectionGeneration < current.connectionGeneration
    ) {
      throw new Error("AuthorityLog.rebindConnection changed or rolled back a stable authenticated axis");
    }

    const peers = validatePeerBindings(nextPeerBindings, nextLocalContext.senderSeatId);
    if (peers.length !== this.peerBindings.length) {
      throw new Error("AuthorityLog.rebindConnection changed the authenticated peer quorum");
    }
    for (let index = 0; index < peers.length; index++) {
      const prior = this.peerBindings[index];
      const next = peers[index];
      if (
        prior == null
        || next == null
        || next.seatId !== prior.seatId
        || next.connectionGeneration < prior.connectionGeneration
      ) {
        throw new Error("AuthorityLog.rebindConnection changed a peer seat or rolled back its generation");
      }
    }

    const contextUnchanged =
      nextLocalContext.membershipRevision === current.membershipRevision
      && nextLocalContext.connectionGeneration === current.connectionGeneration;
    const peersUnchanged = peers.every(
      (peer, index) => peer.connectionGeneration === this.peerBindings[index]?.connectionGeneration,
    );
    if (contextUnchanged && peersUnchanged) {
      return 0;
    }

    // Validate and prepare the complete replacement before mutating any live state. A malformed quorum must
    // leave the old binding wholly usable; the runtime may then enter its shared terminal without inheriting
    // a half-rebound log.
    const reboundLocalContext = Object.freeze({ ...nextLocalContext });
    const authority = peers.find(peer => peer.seatId === reboundLocalContext.authoritySeatId);
    if (this.pendingReplicaEntry != null && authority == null) {
      throw new Error("AuthorityLog.rebindConnection has no bound authority peer for the replica");
    }
    const reboundReplicaEntry =
      this.pendingReplicaEntry == null || authority == null
        ? this.pendingReplicaEntry
        : freezeAuthorityEntry(
            cloneEntry({
              ...this.pendingReplicaEntry,
              context: {
                ...this.pendingReplicaEntry.context,
                membershipRevision: reboundLocalContext.membershipRevision,
                connectionGeneration: authority.connectionGeneration,
              },
            }),
          );
    const reboundLatestCommittedEntry =
      this.latestCommittedEntry == null
        ? null
        : freezeAuthorityEntry(cloneEntry({ ...this.latestCommittedEntry, context: reboundLocalContext }));
    const reboundPendingAuthorityCommit =
      this.pendingAuthorityCommit == null
        ? null
        : {
            entry: freezeAuthorityEntry(
              cloneEntry({ ...this.pendingAuthorityCommit.entry, context: reboundLocalContext }),
            ),
            ...(this.pendingAuthorityCommit.prepare == null ? {} : { prepare: this.pendingAuthorityCommit.prepare }),
            boundaryApproval: this.pendingAuthorityCommit.boundaryApproval,
          };
    const reboundLeases: {
      readonly lease: DeliveryLease;
      readonly entry: CoopAuthorityEntry;
      readonly peerStages: Map<number, { connectionGeneration: number; stage: number }>;
    }[] = [];
    for (const lease of this.retainedWindow.values()) {
      const peerStages = new Map<number, { connectionGeneration: number; stage: number }>();
      for (const peer of peers) {
        const priorStage = lease.peerStages.get(peer.seatId);
        if (priorStage == null) {
          throw new Error("AuthorityLog.rebindConnection retained lease peer quorum changed");
        }
        peerStages.set(peer.seatId, {
          connectionGeneration: peer.connectionGeneration,
          stage: priorStage.stage,
        });
      }
      reboundLeases.push({
        lease,
        entry: freezeAuthorityEntry(cloneEntry({ ...lease.entry, context: reboundLocalContext })),
        peerStages,
      });
    }

    this.localContext = reboundLocalContext;
    this.peerBindings = peers;
    this.pendingTailRequestFrom = null;
    this.pendingReplicaEntry = reboundReplicaEntry;
    this.latestCommittedEntry = reboundLatestCommittedEntry;
    this.pendingAuthorityCommit = reboundPendingAuthorityCommit;
    for (const rebound of reboundLeases) {
      rebound.lease.entry = rebound.entry;
      rebound.lease.peerStages.clear();
      for (const [seatId, stage] of rebound.peerStages) {
        rebound.lease.peerStages.set(seatId, stage);
      }
    }

    // Publish only after every live lease and replica cursor observes the new binding. The send carrier may
    // be synchronous in loopback tests, so a receipt can legitimately re-enter this log before send returns.
    for (const rebound of reboundLeases) {
      this.sendGuarded({ kind: "deliver", entry: rebound.entry });
    }
    const redelivered = reboundLeases.length;
    return redelivered;
  }

  // ---------------------------------------------------------------------------
  // AUTHORITY side
  // ---------------------------------------------------------------------------

  /** Detailed commit API; commit() below remains the compatibility throwing wrapper. */
  commitDetailed(
    entry: Omit<CoopAuthorityEntry, "revision">,
    prepare?: (entry: CoopAuthorityEntry) => (() => void) | null,
  ): AuthorityCommitDisposition {
    try {
      return { kind: "committed", entry: this.commit(entry, prepare) };
    } catch (error) {
      if (error instanceof AuthorityCommitDeferredError) {
        return {
          kind: "deferred",
          entry: error.entry,
          reason: "predecessor-control-not-installed",
        };
      }
      return {
        kind: "failed",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Commit the next entry: assign the next global revision, freeze + retain it, reserve the authority-local
   * successor, then publish + start redelivery. A failed local reservation is indistinguishable from a
   * failed retention admission: it consumes no revision and emits no frame.
   */
  commit(
    entry: Omit<CoopAuthorityEntry, "revision">,
    prepare?: (entry: CoopAuthorityEntry) => (() => void) | null,
  ): CoopAuthorityEntry {
    if (this.disposed) {
      throw new Error("AuthorityLog.commit after dispose");
    }
    const pending = this.pendingAuthorityCommit;
    if (pending != null && !sameAuthorityCommitBody(pending.entry, entry)) {
      throw new Error("AuthorityLog.commit: a deferred successor is already awaiting predecessor control");
    }
    if (!isValidOperationId(entry.operationId)) {
      throw new Error(`AuthorityLog.commit: invalid operationId ${String(entry.operationId)}`);
    }
    if (!isValidFrameContext(entry.context)) {
      throw new Error("AuthorityLog.commit: invalid entry frame context");
    }
    if (
      !isSameSessionIdentity(entry.context, this.localContext)
      || entry.context.sessionEpoch !== this.localContext.sessionEpoch
      || entry.context.membershipRevision !== this.localContext.membershipRevision
      || this.localContext.senderSeatId !== this.localContext.authoritySeatId
      || entry.context.senderSeatId !== this.localContext.authoritySeatId
      || entry.context.authoritySeatId !== this.localContext.authoritySeatId
    ) {
      throw new Error("AuthorityLog.commit: entry context is not bound to the local authority");
    }
    const revision = pending?.entry.revision ?? this.headRevision + 1;
    const candidate = pending?.entry ?? { ...entry, revision };
    if (!isValidAuthorityEntry(candidate)) {
      throw new Error("AuthorityLog.commit: malformed mechanical entry or missing successor control");
    }
    if (
      (pending == null && revision !== this.headRevision + 1)
      || (pending != null && revision !== pending.entry.revision)
    ) {
      throw new Error("AuthorityLog.commit: revision is not the next dense authority revision");
    }
    if (this.latestNextControl?.kind === "TERMINAL") {
      throw new Error("AuthorityLog.commit: terminal frontier is final");
    }
    const ordinarySuccessorAllowed =
      this.latestNextControl == null
      || (this.latestCommittedOperationId != null
        && controlAllowsSuccessorEntry(this.latestNextControl, this.latestCommittedOperationId, candidate));
    const boundaryApproval = ordinarySuccessorAllowed
      ? null
      : pending == null
        ? this.captureBoundaryApproval(candidate)
        : this.deferredBoundaryApprovalAllows(pending.boundaryApproval, candidate)
          ? pending.boundaryApproval
          : null;
    if (!ordinarySuccessorAllowed && boundaryApproval == null) {
      throw new Error(
        `AuthorityLog.commit: ${candidate.kind} is not authorized by predecessor control after `
          + `${this.latestCommittedOperationId ?? "(missing predecessor)"}`,
      );
    }
    // Own an immutable, caller-independent copy so a caller reusing/mutating its source object can never
    // rewrite what a later redelivery transmits (the retention immutability boundary).
    const committed = pending?.entry ?? freezeAuthorityEntry(cloneEntry(candidate));

    const lease: DeliveryLease = {
      revision,
      entry: committed,
      owner: {
        ownerId: `${this.ownerBase}:deliver:${revision}`,
        address: `authority-v2/deliver/${revision}`,
        reason: `redeliver revision ${revision} until mechanically retired`,
      },
      peerStages: new Map(
        this.peerBindings.map(peer => [
          peer.seatId,
          { connectionGeneration: peer.connectionGeneration, stage: STAGE_NONE },
        ]),
      ),
      attempts: 0,
      cancelTimer: null,
      stopped: false,
      subsumptionDone: false,
      exhaustionNotified: false,
    };
    if (!this.retainedWindow.set(revision, lease)) {
      this.retentionRefusals += 1;
      throw new AuthorityRetentionOverflowError(this.retentionCapacity, revision);
    }
    let rollback: (() => void) | null = null;
    try {
      const reservation = prepare ?? pending?.prepare;
      rollback =
        reservation == null
          ? null
          : withAuthorityEntryProofScope(committed, this.entryProofScope(boundaryApproval), () =>
              reservation(committed),
            );
      if (reservation != null && rollback == null) {
        this.pendingAuthorityCommit = { entry: committed, prepare: reservation, boundaryApproval };
        throw new AuthorityCommitDeferredError(committed);
      }
    } catch (error) {
      // No timer or wire egress exists yet. Remove the provisional lease and ask a successful reservation
      // to restore its local ledger snapshot before propagating the clean commit failure.
      this.retainedWindow.delete(revision);
      rollback?.();
      throw error;
    }
    // A revision exists only after retention accepted it. An overflow therefore
    // never burns a number and cannot create an unfillable replica gap. The same is now true of a local
    // successor-reservation refusal above.
    this.headRevision = revision;
    this.pendingAuthorityCommit = null;
    this.latestNextControl = structuredClone(committed.nextControl);
    this.latestCommittedOperationId = committed.operationId;
    this.latestCommittedEntry = committed;

    // Deliver once immediately, then redeliver on the backoff until mechanically retired.
    this.sendGuarded({ kind: "deliver", entry: committed });
    this.scheduleRedelivery(lease);
    return committed;
  }

  /**
   * Retry the one exact authority-local deferred commit without asking a caller
   * to rebuild or re-address its body. Rebind updates the retained immutable
   * image in place, so this seam preserves operation identity and revision
   * across a hot rejoin.
   */
  retryDeferredCommit(expectedOperationId?: string): AuthorityCommitDisposition {
    const pending = this.pendingAuthorityCommit;
    if (pending == null) {
      return { kind: "failed", reason: "AuthorityLog has no deferred authority commit" };
    }
    if (expectedOperationId != null && pending.entry.operationId !== expectedOperationId) {
      return {
        kind: "failed",
        reason: `AuthorityLog deferred operation mismatch: expected ${expectedOperationId}`,
      };
    }
    const { revision: _revision, ...body } = pending.entry;
    return this.commitDetailed(body, pending.prepare);
  }

  /**
   * Receipt intake with a lossless verdict. The public contract retains its historical boolean wrapper below,
   * while the runtime uses this classification so an authenticated receipt can never be rejected silently.
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: every branch names one fail-closed authentication or ordered-stage verdict
  acceptReceiptDetailed(receipt: CoopAuthorityReceipt): AuthorityReceiptVerdict {
    if (this.disposed) {
      return { kind: "rejected", reason: "disposed" };
    }
    if (!isValidRevision(receipt.revision) || !isValidOperationId(receipt.operationId) || !isAckStage(receipt.stage)) {
      return { kind: "rejected", reason: "malformed-receipt" };
    }
    if (!isValidFrameContext(receipt.context)) {
      return { kind: "rejected", reason: "malformed-context" };
    }
    // A receipt from a different session identity or epoch can never advance a retained entry's stage.
    if (!isSameSessionIdentity(receipt.context, this.localContext)) {
      return { kind: "rejected", reason: "session-mismatch" };
    }
    if (receipt.context.sessionEpoch !== this.localContext.sessionEpoch) {
      return { kind: "rejected", reason: "epoch-mismatch" };
    }
    const lease = this.retainedWindow.get(receipt.revision);
    if (lease == null) {
      // Unknown or already-retired revision: nothing to advance.
      return { kind: "rejected", reason: "unknown-revision" };
    }
    if (!receiptMatchesEntry(receipt, lease.entry)) {
      return { kind: "rejected", reason: "operation-mismatch" };
    }
    // A receipt is evidence from the receiving replica, never a reflection of the authority's own entry
    // context. The transport/session binding performs exact peer authentication; the log still rejects a
    // self-signed/spoofed-authority receipt so copied entry context can never retire its own mutation.
    const peerStage = lease.peerStages.get(receipt.context.senderSeatId);
    if (receipt.context.authoritySeatId !== this.localContext.authoritySeatId) {
      return { kind: "rejected", reason: "authority-mismatch" };
    }
    if (lease.entry.context.senderSeatId !== this.localContext.authoritySeatId) {
      return { kind: "rejected", reason: "entry-authority-mismatch" };
    }
    if (receipt.context.senderSeatId === lease.entry.context.senderSeatId) {
      return { kind: "rejected", reason: "self-signed" };
    }
    if (receipt.context.senderSeatId === receipt.context.authoritySeatId) {
      return { kind: "rejected", reason: "authority-signed" };
    }
    if (receipt.context.membershipRevision !== lease.entry.context.membershipRevision) {
      return { kind: "rejected", reason: "membership-mismatch" };
    }
    if (peerStage == null) {
      return { kind: "rejected", reason: "unbound-peer" };
    }
    if (receipt.context.connectionGeneration !== peerStage.connectionGeneration) {
      return { kind: "rejected", reason: "connection-generation-mismatch" };
    }
    if (receipt.stage === "controlInstalled") {
      const expectedControlId = controlIdOf(lease.entry.nextControl);
      if (receipt.controlId !== expectedControlId) {
        return { kind: "rejected", reason: "control-id-mismatch" };
      }
    } else if (receipt.controlId != null) {
      return { kind: "rejected", reason: "unexpected-control-id" };
    }
    const stageIdx = STAGE_ORDER[receipt.stage];
    const required = STAGE_ORDER.controlInstalled;
    // Presentation is intentionally outside the retirement rule. It is not a substitute for the exact
    // mechanical proof below it (in particular it carries no successor controlId), so it may only be
    // observed after the required stage was already proven.
    if (receipt.stage === "presentationSettled" && peerStage.stage < required) {
      return { kind: "rejected", reason: "presentation-before-mechanical" };
    }
    // Per-operation stage ordering: stages are monotonic. A same/older stage is a duplicate receipt - a safe
    // no-op that never re-advances or re-retires.
    if (stageIdx <= peerStage.stage) {
      return { kind: "duplicate", highestStage: peerStage.stage };
    }
    peerStage.stage = stageIdx;

    // Supersession is a quorum fact. One fast peer may never discard material a slower required peer still needs.
    if (!lease.subsumptionDone && allPeersReached(lease, STAGE_ORDER.admitted)) {
      lease.subsumptionDone = true;
      for (const subsumed of lease.entry.subsumes) {
        this.retire(subsumed);
      }
    }
    // Retirement rule: admitted + materialApplied + controlInstalled. AWAIT_SUCCESSOR is a real, addressed
    // ordering control whose ledger proof is required just like an executable UI successor.
    if (allPeersReached(lease, required)) {
      const retired = this.retire(receipt.revision);
      if (retired) {
        // A later retained entry may already have reached the replica while this predecessor's control was
        // still being installed and therefore been rejected as a gap. Quorum retirement proves every peer
        // can now accept exactly N+1. Re-publish only that immediate successor now instead of waiting for
        // the generic backoff (or blasting the whole tail and manufacturing fresh gaps).
        this.redeliverImmediateSuccessor(receipt.revision);
      }
      return {
        kind: "advanced",
        retired,
        waitingForSeatIds: [],
      };
    }
    return {
      kind: "advanced",
      retired: false,
      waitingForSeatIds: [...lease.peerStages].filter(([, stage]) => stage.stage < required).map(([seatId]) => seatId),
    };
  }

  /** Receipt intake contract: true only when this receipt newly retires its retained entry. */
  acceptReceipt(receipt: CoopAuthorityReceipt): boolean {
    const verdict = this.acceptReceiptDetailed(receipt);
    return verdict.kind === "advanced" && verdict.retired;
  }

  /**
   * Whether every authenticated peer reached at least `stage` for this exact operation.
   *
   * Retired entries remain queryable through a bounded tombstone, which closes the synchronous-loopback
   * race where a phase registers its continuation barrier immediately after commit but the final receipt
   * already retired the lease in the commit stack.
   */
  peerStageQuorum(operationId: string, stage: CoopReplicaMechanicalStage): boolean {
    if (this.disposed) {
      return false;
    }
    const required = STAGE_ORDER[stage];
    const live = this.retainedWindow.values().find(lease => lease.entry.operationId === operationId);
    if (live != null) {
      return allPeersReached(live, required);
    }
    return (this.retiredOperationStages.get(operationId) ?? STAGE_NONE) >= required;
  }

  /** Retained-but-unretired entries in revision order (contract). */
  retained(): readonly CoopAuthorityEntry[] {
    return this.retainedWindow.values().map(lease => lease.entry);
  }

  /**
   * Build the exact recovery proof for a replica's captured frontier.
   *
   * A peer that is genuinely behind keeps every missing entry retained because authority retirement requires
   * that peer's own mechanical receipt. Consequently, a hole here means the request/frontier cannot be
   * reconciled with this live log and must fail closed. The head-equal case carries the constant-size latest
   * entry as reconstruction material: revision delivery is complete, but recovery intentionally destroyed
   * the old control generation and must build a new one from the exact immutable result.
   */
  recoverySlice(capturedFrontier: number): CoopAuthorityRecoverySliceV2 | null {
    if (
      this.disposed
      || !Number.isSafeInteger(capturedFrontier)
      || capturedFrontier < 0
      || capturedFrontier > this.headRevision
    ) {
      return null;
    }
    if (capturedFrontier === this.headRevision) {
      if (
        (this.headRevision === 0
          && (this.latestCommittedOperationId !== null
            || this.latestNextControl !== null
            || this.latestCommittedEntry !== null))
        || (this.headRevision > 0
          && (this.latestCommittedOperationId === null
            || this.latestNextControl === null
            || this.latestCommittedEntry == null
            || this.latestCommittedEntry.revision !== this.headRevision))
      ) {
        return null;
      }
      return Object.freeze({
        frontier: this.headRevision,
        frontierOperationId: this.latestCommittedOperationId,
        nextControl: structuredClone(this.latestNextControl),
        requiredTail: Object.freeze(this.latestCommittedEntry == null ? [] : [this.latestCommittedEntry]),
      });
    }

    const retained = new Map(this.retained().map(entry => [entry.revision, entry] as const));
    const requiredTail: CoopAuthorityEntry[] = [];
    for (let revision = capturedFrontier + 1; revision <= this.headRevision; revision++) {
      const entry = retained.get(revision);
      if (entry == null) {
        return null;
      }
      requiredTail.push(entry);
    }
    const last = requiredTail.at(-1);
    if (last == null || this.latestNextControl == null || !controlsEqual(last.nextControl, this.latestNextControl)) {
      return null;
    }
    return Object.freeze({
      frontier: this.headRevision,
      frontierOperationId: last.operationId,
      nextControl: structuredClone(this.latestNextControl),
      requiredTail: Object.freeze(requiredTail),
    });
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
    const authorityPeer = this.peerBindings.find(peer => peer.seatId === entry.context.authoritySeatId);
    if (
      entry.context.authoritySeatId !== this.localContext.authoritySeatId
      || entry.context.senderSeatId !== entry.context.authoritySeatId
      || this.localContext.senderSeatId === this.localContext.authoritySeatId
      || authorityPeer == null
      || entry.context.connectionGeneration !== authorityPeer.connectionGeneration
    ) {
      return { kind: "rejected", reason: "authority-sender-mismatch" };
    }
    switch (this.ledger.classify(entry.revision)) {
      case "duplicate-complete":
        // Mechanical state is complete. The caller republishes the terminal receipt but never re-applies.
        return { kind: "duplicate-complete" };
      case "duplicate-pending-material":
        if (!this.isPendingReplicaEntry(entry)) {
          return { kind: "rejected", reason: "revision-identity-conflict" };
        }
        return { kind: "duplicate-pending-material" };
      case "duplicate-pending-control":
        if (!this.isPendingReplicaEntry(entry)) {
          return { kind: "rejected", reason: "revision-identity-conflict" };
        }
        return { kind: "duplicate-pending-control" };
      case "gap": {
        // Request the missing tail via the injected send. No local retry loop - the authority's redelivery
        // is the ONLY retry, so a replica can never spin an orphan request loop (the exact prior hazard).
        // Suppress an identical request until that exact mechanical frontier completes. A full tail response
        // necessarily contains later entries that remain gaps while the predecessor is awaiting material or
        // control; echoing a request for each of those entries recursively replays the same tail forever.
        const missingFrom = this.ledger.missingFrom();
        this.requestTailOnce(missingFrom);
        return { kind: "gap", missingFrom };
      }
      default:
        // Exactly the next revision: journal it, but do NOT advance material/control truth yet.
        if (
          this.pendingReplicaSuccessorControl != null
          && (entry.revision !== this.pendingReplicaSuccessorControl.revision + 1
            || !controlAllowsSuccessorEntry(
              this.pendingReplicaSuccessorControl.control,
              this.pendingReplicaSuccessorControl.operationId,
              entry,
            ))
        ) {
          return { kind: "rejected", reason: "predecessor-control-mismatch" };
        }
        if (!this.ledger.markReceived(entry.revision)) {
          return { kind: "rejected", reason: "replica-ledger-refused-admission" };
        }
        this.pendingReplicaSuccessorControl = null;
        this.pendingReplicaEntry = freezeAuthorityEntry(cloneEntry(entry));
        // The live replica ledger receives this same object immediately after admit(). Its local proof need
        // is the newly admitted revision only; completed predecessors are represented by the dense log cursor.
        authorityEntryProofScopes.set(
          entry,
          Object.freeze({
            kind: "replica-dense-frontier",
            source: freezeAuthorityEntry(cloneEntry(entry)),
            authenticatedThrough: entry.revision - 1,
            isActive: () => {
              const pending = this.pendingReplicaEntry;
              return (
                !this.disposed
                && pending?.revision === entry.revision
                && pending.operationId === entry.operationId
                && pending.context.membershipRevision === entry.context.membershipRevision
                && pending.context.connectionGeneration === entry.context.connectionGeneration
              );
            },
          }),
        );
        return { kind: "admitted" };
    }
  }

  /** Record a mechanical stage only after the real replica operation succeeded. */
  recordReplicaStage(entry: CoopAuthorityEntry, stage: CoopReplicaMechanicalStage): boolean {
    if (this.disposed || !this.isPendingReplicaEntry(entry)) {
      return false;
    }
    let advanced = false;
    if (stage === "materialApplied") {
      advanced = this.ledger.markMaterialApplied(entry.revision, true);
    } else {
      advanced = this.ledger.markControlInstalled(entry.revision);
    }
    if (advanced && this.ledger.controlInstalledThrough() >= entry.revision) {
      this.pendingReplicaSuccessorControl = {
        revision: entry.revision,
        operationId: entry.operationId,
        control: structuredClone(entry.nextControl),
      };
      this.pendingReplicaEntry = null;
      if (this.pendingTailRequestFrom != null && this.ledger.controlInstalledThrough() >= this.pendingTailRequestFrom) {
        this.pendingTailRequestFrom = null;
      }
    }
    return advanced;
  }

  /** Highest validated-and-journaled revision. */
  receivedThrough(): number {
    return this.ledger.receivedThrough();
  }

  /** Highest revision whose canonical material really applied. */
  appliedThrough(): number {
    return this.ledger.appliedThrough();
  }

  /** Highest revision mechanically complete through its required successor control. */
  controlInstalledThrough(): number {
    return this.ledger.controlInstalledThrough();
  }

  // ---------------------------------------------------------------------------
  // BOTH
  // ---------------------------------------------------------------------------

  /** Adopt a proven snapshot high-water (recovery): fast-forward the cursor; retire entries it has proven. */
  adoptFrontier(
    revision: number,
    terminal?: { readonly operationId: string; readonly nextControl: CoopNextControl },
  ): void {
    if (this.disposed || !Number.isSafeInteger(revision) || revision <= 0) {
      return;
    }
    if (
      terminal !== undefined
      && (!isValidOperationId(terminal.operationId) || !validateNextControl(terminal.nextControl).ok)
    ) {
      return;
    }
    // Replica: fast-forward the applied cursor past any gap the snapshot filled.
    this.ledger.adoptFrontier(revision);
    if (terminal !== undefined) {
      this.latestCommittedOperationId = terminal.operationId;
      this.latestNextControl = structuredClone(terminal.nextControl);
      this.pendingReplicaSuccessorControl = {
        revision,
        operationId: terminal.operationId,
        control: structuredClone(terminal.nextControl),
      };
    }
    if (this.pendingTailRequestFrom != null && revision >= this.pendingTailRequestFrom) {
      this.pendingTailRequestFrom = null;
    }
    if (
      this.pendingAuthorityCommit != null
      && (this.pendingAuthorityCommit.entry.revision <= revision || terminal?.nextControl.kind === "TERMINAL")
    ) {
      // Recovery has either proven this reserved revision or installed an irrevocable terminal frontier;
      // never let the stale reservation block a later exact frontier retry.
      this.pendingAuthorityCommit = null;
    }
    if (this.pendingReplicaEntry != null && this.pendingReplicaEntry.revision <= revision) {
      this.pendingReplicaEntry = null;
    }
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

  /**
   * Recovery replica seam: the snapshot proved canonical material through this exact immutable entry, but
   * recovery replaced the phase generation, so its successor is not yet installed. Keep the final revision
   * in the ordinary pending-entry slot and leave control one behind until recordReplicaStage proves it.
   */
  stageRecoveredFrontier(entry: CoopAuthorityEntry): boolean {
    if (this.disposed || !isValidAuthorityEntry(entry) || !isSameSessionIdentity(entry.context, this.localContext)) {
      return false;
    }
    const authorityPeer = this.peerBindings.find(peer => peer.seatId === entry.context.authoritySeatId);
    if (
      entry.context.sessionEpoch !== this.localContext.sessionEpoch
      || entry.context.membershipRevision !== this.localContext.membershipRevision
      || entry.context.authoritySeatId !== this.localContext.authoritySeatId
      || entry.context.senderSeatId !== entry.context.authoritySeatId
      || this.localContext.senderSeatId === this.localContext.authoritySeatId
      || authorityPeer == null
      || entry.context.connectionGeneration !== authorityPeer.connectionGeneration
      || !this.ledger.adoptRecoveryMaterialFrontier(entry.revision)
    ) {
      return false;
    }
    this.pendingReplicaEntry = freezeAuthorityEntry(cloneEntry(entry));
    this.pendingReplicaSuccessorControl = null;
    this.latestCommittedOperationId = entry.operationId;
    this.latestNextControl = structuredClone(entry.nextControl);
    if (this.pendingTailRequestFrom != null && entry.revision >= this.pendingTailRequestFrom) {
      this.pendingTailRequestFrom = null;
    }
    if (entry.revision > this.headRevision) {
      this.headRevision = entry.revision;
    }
    return true;
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
    this.pendingTailRequestFrom = null;
    this.pendingReplicaEntry = null;
    this.pendingReplicaSuccessorControl = null;
    this.pendingAuthorityCommit = null;
    this.latestCommittedOperationId = null;
    this.latestNextControl = null;
    this.latestCommittedEntry = null;
    this.retiredOperationStages.clear();
    this.exhaustedRevisionSet.clear();
  }

  /** Live counts for the no-orphan-timer + bounded-retention invariants (tests assert these directly). */
  diagnostics(): AuthorityLogDiagnostics {
    const leases = this.retainedWindow.values();
    return {
      retainedEntries: leases.length,
      deliveryLeases: leases.length,
      activeDeliveryTimers: leases.filter(l => l.cancelTimer != null && !l.stopped).length,
      receivedThrough: this.ledger.receivedThrough(),
      appliedThrough: this.ledger.appliedThrough(),
      controlInstalledThrough: this.ledger.controlInstalledThrough(),
      headRevision: this.headRevision,
      retentionCapacity: this.retentionCapacity,
      retentionRefusals: this.retentionRefusals,
      wireSendFailures: this.wireSendFailures,
      deliveryExhaustions: this.deliveryExhaustions,
      deliveryExhaustionCallbackFailures: this.deliveryExhaustionCallbackFailures,
      exhaustedRevisions: [...this.exhaustedRevisionSet].sort((left, right) => left - right),
      disposed: this.disposed,
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Snapshot the exact currently retained proof set for one synchronous authority-local reservation. */
  private entryProofScope(boundaryApproval: AuthorityBoundaryApproval | null): AuthorityEntryProofScope {
    return Object.freeze({
      kind: "authority-retained",
      retainedSources: Object.freeze([...this.retained()]),
      boundarySources: boundaryApproval?.trustedSources ?? null,
    });
  }

  /** Capture the full retained-frontier proof once, before a boundary may enter the deferred state. */
  private captureBoundaryApproval(candidate: CoopAuthorityEntry): AuthorityBoundaryApproval | null {
    const predecessor = this.latestCommittedEntry;
    const retained = this.retained();
    if (
      predecessor == null
      || !this.retainedWindow.has(predecessor.revision)
      || !boundarySupersessionAllowsSuccessorEntry(predecessor, candidate, retained)
    ) {
      return null;
    }
    const trustedSources = candidate.subsumes.map(revision => retained.find(source => source.revision === revision));
    if (trustedSources.some(source => source == null)) {
      return null;
    }
    return Object.freeze({
      predecessorRevision: predecessor.revision,
      predecessorOperationId: predecessor.operationId,
      predecessorControlId: controlIdOf(predecessor.nextControl),
      successorRevision: candidate.revision,
      successorOperationId: candidate.operationId,
      successorKind: candidate.kind,
      successorMaterialDigest: candidate.material.digest,
      successorControlId: controlIdOf(candidate.nextControl),
      subsumes: Object.freeze([...candidate.subsumes]),
      trustedSources: Object.freeze(
        (trustedSources as CoopAuthorityEntry[]).map(source => freezeAuthorityEntry(cloneEntry(source))),
      ),
    });
  }

  /**
   * Reuse only the proof captured for this exact immutable deferred body. Older unrelated leases may have
   * retired since initial authorization, but the latest stale predecessor must still be the same retained,
   * non-terminal frontier and the structural/causal boundary predicate must still hold.
   */
  private deferredBoundaryApprovalAllows(
    approval: AuthorityBoundaryApproval | null,
    candidate: CoopAuthorityEntry,
  ): boolean {
    const predecessor = this.latestCommittedEntry;
    return (
      approval != null
      && predecessor != null
      && this.latestCommittedOperationId === approval.predecessorOperationId
      && this.latestNextControl != null
      && this.latestNextControl.kind !== "TERMINAL"
      && controlsEqual(this.latestNextControl, predecessor.nextControl)
      && this.retainedWindow.has(approval.predecessorRevision)
      && predecessor.revision === approval.predecessorRevision
      && predecessor.operationId === approval.predecessorOperationId
      && controlIdOf(predecessor.nextControl) === approval.predecessorControlId
      && candidate.revision === approval.successorRevision
      && candidate.revision === predecessor.revision + 1
      && candidate.operationId === approval.successorOperationId
      && candidate.kind === approval.successorKind
      && candidate.material.digest === approval.successorMaterialDigest
      && controlIdOf(candidate.nextControl) === approval.successorControlId
      && sameRevisionList(candidate.subsumes, approval.subsumes)
      && sameRevisionList(
        approval.trustedSources.map(source => source.revision),
        approval.subsumes,
      )
      && isBoundarySupersessionCandidate(predecessor, candidate)
    );
  }

  /** Emit at most one request for an unchanged unfinished mechanical frontier. */
  private requestTailOnce(missingFrom: number): void {
    if (this.pendingTailRequestFrom === missingFrom) {
      return;
    }
    this.pendingTailRequestFrom = missingFrom;
    this.sendGuarded({ kind: "requestTail", context: this.localContext, missingFrom });
  }

  /** Retire one revision: stop its lease (cancel timers) and drop it from retention. Returns true iff present. */
  private retire(revision: number): boolean {
    const lease = this.retainedWindow.get(revision);
    if (lease == null) {
      return false;
    }
    const quorumStage = Math.min(...[...lease.peerStages.values()].map(peer => peer.stage));
    this.retiredOperationStages.set(lease.entry.operationId, quorumStage);
    while (this.retiredOperationStages.size > this.retentionCapacity) {
      const oldest = this.retiredOperationStages.keys().next().value as string | undefined;
      if (oldest == null) {
        break;
      }
      this.retiredOperationStages.delete(oldest);
    }
    this.stopLease(lease);
    this.retainedWindow.delete(revision);
    this.exhaustedRevisionSet.delete(revision);
    return true;
  }

  /** Re-publish only the newly-unblocked contiguous successor; its existing lease/timer remains unchanged. */
  private redeliverImmediateSuccessor(retiredRevision: number): void {
    const successor = this.retainedWindow.get(retiredRevision + 1);
    if (this.disposed || successor == null || successor.stopped) {
      return;
    }
    this.sendGuarded({ kind: "deliver", entry: successor.entry });
  }

  /** Exact identity check for the one unfinished replica entry; a conflicting same-revision frame is hostile. */
  private isPendingReplicaEntry(entry: CoopAuthorityEntry): boolean {
    const pending = this.pendingReplicaEntry;
    return (
      pending != null
      && pending.revision === entry.revision
      && pending.operationId === entry.operationId
      && pending.kind === entry.kind
      && pending.material.digest === entry.material.digest
      && JSON.stringify(pending.nextControl) === JSON.stringify(entry.nextControl)
      && JSON.stringify(pending.subsumes) === JSON.stringify(entry.subsumes)
    );
  }

  /** Stop a lease's redelivery loop AND cancel every timer it owns (retirement / subsumption / dispose). */
  private stopLease(lease: DeliveryLease): void {
    this.stopLeaseDelivery(lease);
    // Belt-and-braces: cancel by owner so any timer the scheduler still holds for this lease is gone.
    this.scheduler.cancelOwner(lease.owner.ownerId);
  }

  /** Stop a lease's redelivery loop: cancel the pending timer + mark it stopped. */
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
      // Attempt cap reached: retain the exact entry, stop only this lease, and
      // publish one explicit disposition so the caller can enter the existing
      // protocol/shared-terminal path instead of inheriting a silent stall.
      this.markDeliveryExhausted(lease);
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
    this.sendGuarded({ kind: "deliver", entry: lease.entry });
    this.scheduleRedelivery(lease);
  }

  /** Stop + report a capped lease exactly once; retention remains authoritative until normal retirement. */
  private markDeliveryExhausted(lease: DeliveryLease): void {
    if (lease.exhaustionNotified || this.disposed || !this.retainedWindow.has(lease.revision)) {
      return;
    }
    lease.exhaustionNotified = true;
    lease.stopped = true;
    this.deliveryExhaustions += 1;
    this.exhaustedRevisionSet.add(lease.revision);
    while (this.exhaustedRevisionSet.size > this.retentionCapacity) {
      const oldest = [...this.exhaustedRevisionSet].sort((left, right) => left - right)[0];
      if (oldest == null) {
        break;
      }
      this.exhaustedRevisionSet.delete(oldest);
    }
    const disposition: AuthorityDeliveryExhaustion = Object.freeze({
      kind: "delivery-exhausted",
      reason: "max-delivery-attempts",
      revision: lease.revision,
      operationId: lease.entry.operationId,
      entryKind: lease.entry.kind,
      attempts: lease.attempts,
      maxAttempts: this.maxDeliveryAttempts ?? lease.attempts,
      entry: lease.entry,
    });
    if (this.onDeliveryExhausted == null) {
      return;
    }
    try {
      this.onDeliveryExhausted(disposition);
    } catch {
      this.deliveryExhaustionCallbackFailures += 1;
    }
  }

  /** A carrier throw never loses a committed entry or kills its owned redelivery loop. */
  private sendGuarded(wire: CoopAuthorityWire): void {
    try {
      this.send(wire);
    } catch {
      this.wireSendFailures += 1;
    }
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
    // Successor controls now contain nested address arrays. Clone the complete JSON value before
    // deep-freezing retention so committing an entry neither freezes nor aliases caller-owned input.
    nextControl: structuredClone(entry.nextControl),
    subsumes: [...entry.subsumes],
  };
}

/** Compare a retry request with the exact deferred body without treating revision as a new allocation. */
function sameAuthorityCommitBody(left: CoopAuthorityEntry, right: Omit<CoopAuthorityEntry, "revision">): boolean {
  return (
    JSON.stringify({
      context: left.context,
      operationId: left.operationId,
      kind: left.kind,
      material: left.material,
      nextControl: left.nextControl,
      subsumes: left.subsumes,
    })
    === JSON.stringify({
      context: right.context,
      operationId: right.operationId,
      kind: right.kind,
      material: right.material,
      nextControl: right.nextControl,
      subsumes: right.subsumes,
    })
  );
}

function sameRevisionList(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((revision, index) => revision === right[index]);
}

/** Structurally clone an opaque JSON payload so retention is independent of the caller's object. */
function clonePayload(payload: unknown): unknown {
  if (payload == null || typeof payload !== "object") {
    return payload;
  }
  // structuredClone is available in Node >= 17 and every supported browser; the payload is a wire value.
  return structuredClone(payload);
}
