/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op AUTHORITATIVE OPERATION RUNTIME (Wave-2 authoritative run-state migration;
// see docs/plans/2026-07-10-coop-authoritative-run-state-migration.md, §1.3-§1.6).
//
// Two small, ENGINE-FREE state machines that drive an operation through the lifecycle
// (proposed -> committed -> applied/rejected/superseded, §1.3):
//
//   - CoopOperationHost  : the sole-authority COMMIT LOG. Validates + commits each op
//                          EXACTLY ONCE (invariant 3), increments `revision` on apply
//                          (§1.5), rejects wrong-owner / illegal / cross-epoch intents,
//                          and supersedes an in-flight op when a newer op takes its slot.
//   - CoopOperationGuest : the idempotent APPLIER. Applies envelopes keyed on the triple
//                          (sessionEpoch, revision, operationId) (invariant 5, §1.6),
//                          DROPS cross-epoch + duplicate/late traffic, detects a revision
//                          GAP, FAILS CLOSED on an unknown phase/kind (invariant 8, §1.7),
//                          and re-enters an in-flight op on reconnect (invariant 7).
//
// Both are pure w.r.t. the engine: the DATA-plane adoption (applyCoopAuthoritativeBattleState)
// and the wire send/receive are the CALLER's job. These machines only own the CONTROL fields.
// That keeps the lifecycle exhaustively unit-testable headlessly (the tests in
// coop-operation-runtime.test.ts are the model's spec) and is the template every later
// surface copies.
// =============================================================================

import type {
  CoopAuthoritativeEnvelopeV1,
  CoopLogicalPhase,
  CoopOperationId,
  CoopOperationKind,
  CoopOperationStatus,
  CoopPendingOperation,
  CoopRevision,
  CoopSessionEpoch,
} from "#data/elite-redux/coop/coop-operation-envelope";
import {
  isKnownCoopLogicalPhase,
  isKnownCoopOperationKind,
  parseCoopOperationId,
} from "#data/elite-redux/coop/coop-operation-envelope";
import type { CoopAuthoritativeBattleStateV1 } from "#data/elite-redux/coop/coop-transport";

// -----------------------------------------------------------------------------
// HOST commit log (§1.3-§1.5).
// -----------------------------------------------------------------------------

/** The current authoritative snapshot the host embeds in the envelope it broadcasts on commit (§1.1, §1.2). */
export interface CoopCommitContext {
  readonly wave: number;
  readonly turn: number;
  readonly logicalPhase: CoopLogicalPhase;
  /** The existing authoritative DATA plane, embedded UNCHANGED (§1.2). */
  readonly authoritativeState: CoopAuthoritativeBattleStateV1;
}

/** The host's validation verdict for one proposed intent (owner correct, choice legal, epoch matches). */
export type CoopIntentValidation = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** A validator the host runs at the single COMMIT point (§1.3). Wrong-owner / illegal-choice -> reject. */
export type CoopIntentValidator = (intent: CoopPendingOperation) => CoopIntentValidation;

function canonicalOperationValue(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (value == null || typeof value !== "object") {
    return JSON.stringify(value) ?? "undefined";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalOperationValue).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalOperationValue(record[key])}`)
    .join(",")}}`;
}

function reackBoundaryMatches(
  intent: CoopPendingOperation,
  ctx: CoopCommitContext,
  applied: CoopPendingOperation,
  envelope: CoopAuthoritativeEnvelopeV1,
): boolean {
  return (
    intent.kind === applied.kind
    && intent.owner === applied.owner
    && ctx.wave === envelope.wave
    && ctx.turn === envelope.turn
    && ctx.logicalPhase === envelope.logicalPhase
    && canonicalOperationValue(ctx.authoritativeState) === canonicalOperationValue(envelope.authoritativeState)
  );
}

/** Outcome of submitting one proposed intent to the host commit log (§1.3). */
export type CoopHostSubmitResult =
  /** Validated + committed + applied: revision++, broadcast this envelope (invariant 4). */
  | { readonly kind: "committed"; readonly envelope: CoopAuthoritativeEnvelopeV1 }
  /** Validation REFUSED (wrong owner / illegal / cross-epoch): broadcast so the proposer surfaces a default. No revision change. */
  | { readonly kind: "rejected"; readonly envelope: CoopAuthoritativeEnvelopeV1; readonly reason: string }
  /** Duplicate of an ALREADY-APPLIED id (invariant 3): a no-op re-ACK, never a second commit. */
  | {
      readonly kind: "reack";
      readonly op: CoopPendingOperation;
      /** Original immutable envelope; a re-ACK never borrows a later global revision. */
      readonly envelope: CoopAuthoritativeEnvelopeV1;
    }
  /** Late intent for an id that is already TERMINAL rejected/superseded (invariant 6, §1.6): dropped. */
  | { readonly kind: "rejected-late"; readonly reason: string };

export interface CoopOperationHostConfig {
  readonly epoch: CoopSessionEpoch;
  /** Revision the log starts at; the first committed op lands at initialRevision + 1. Default 0. */
  readonly initialRevision?: CoopRevision;
  /** Shared session-wide clock. Production surfaces pass the same clock to form one commit order. */
  readonly revisionClock?: CoopOperationRevisionClock;
  /**
   * §1.8 dual-run: advance the legacy interaction counter in LOCKSTEP with `revision` on every applied
   * commit, so any still-legacy surface downstream sees the counter it expects. Removing the counter is
   * FORBIDDEN until every surface is migrated. Optional (a headless lifecycle test passes nothing).
   */
  readonly onApplied?: (op: CoopPendingOperation, revision: CoopRevision) => void;
}

/** Mutable revision cell shared by all authoritative operation surfaces on one peer/session. */
export interface CoopOperationRevisionClock {
  readonly epoch: CoopSessionEpoch;
  revision: CoopRevision;
}

let globalHostClock: CoopOperationRevisionClock | null = null;
let globalGuestClock: CoopOperationRevisionClock | null = null;

function globalClock(
  side: "host" | "guest",
  epoch: CoopSessionEpoch,
  initialRevision: CoopRevision,
): CoopOperationRevisionClock {
  let clock = side === "host" ? globalHostClock : globalGuestClock;
  if (clock == null || clock.epoch !== epoch) {
    clock = { epoch, revision: initialRevision };
    if (side === "host") {
      globalHostClock = clock;
    } else {
      globalGuestClock = clock;
    }
  } else if (initialRevision > clock.revision) {
    clock.revision = initialRevision;
  }
  return clock;
}

export function getCoopGlobalHostRevisionClock(
  epoch: CoopSessionEpoch,
  initialRevision: CoopRevision = 0,
): CoopOperationRevisionClock {
  return globalClock("host", epoch, initialRevision);
}

export function getCoopGlobalGuestRevisionClock(
  epoch: CoopSessionEpoch,
  initialRevision: CoopRevision = 0,
): CoopOperationRevisionClock {
  return globalClock("guest", epoch, initialRevision);
}

/** Seed both sides from a persisted global high-water before any resumed surface is constructed. */
export function setCoopGlobalOperationRevisionFloor(epoch: CoopSessionEpoch, revision: CoopRevision): void {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    return;
  }
  globalClock("host", epoch, revision);
  globalClock("guest", epoch, revision);
}

/** A full authoritative snapshot subsumes every global commit through this revision. */
export function adoptCoopGlobalGuestRevision(epoch: CoopSessionEpoch, revision: CoopRevision): void {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    return;
  }
  globalClock("guest", epoch, revision);
}

/** Clear session-wide ordering state at a real session boundary (and in isolated tests). */
export function resetCoopGlobalOperationOrder(): void {
  globalHostClock = null;
  globalGuestClock = null;
}

// =============================================================================
// PER-RUNTIME operation state (harness-fidelity, per the layer-B decision). In production there is exactly
// ONE runtime per process, so relocating each surface's module-global apply state (guest/host cursors, the
// shared revision clock, and per-surface aux tracking) onto the ACTIVE runtime is semantically identical to
// today. In the single-process two-engine harness there are TWO runtimes, and the module globals bled
// between them (a host applyEnvelope marked appliedIds that the guest then short-circuited on). Per-runtime
// state gives each client its own cursor - exactly like two production processes.
//
// Lifecycle: the record for a surface is CONSTRUCTED at assembly (initCoopRuntimeOpState calls each surface's
// registered factory onto the runtime being built). The apply-path accessor {@linkcode requireCoopOpSurfaceState}
// is FAIL-LOUD: no active runtime = throw (never lazily create a global, which would reintroduce the bleed).
// The reset/init entrypoints use {@linkcode maybeCoopOpSurfaceState} and are SAFE NO-OPS when idle.
// =============================================================================

/** One runtime's authoritative-operation state: the shared clocks + every surface's per-client record. */
export interface CoopRuntimeOpState {
  /** Shared host commit clock for THIS runtime (re-keyed on an epoch change, mirroring the old global clock). */
  hostClock: CoopOperationRevisionClock | null;
  /** Shared guest receive clock for THIS runtime. */
  guestClock: CoopOperationRevisionClock | null;
  /** surfaceKey -> that surface's opaque state record (each surface owns + casts its own type). */
  readonly surfaces: Map<string, unknown>;
}

/** Registered per-surface factories, run by {@linkcode initCoopRuntimeOpState} to populate a fresh runtime. */
const opSurfaceFactories = new Map<string, () => unknown>();

/**
 * Register a surface's fresh-state factory (called once at module import, next to registerCoopOperationApplier).
 * A surface with NO factory simply has no per-runtime record; its {@linkcode requireCoopOpSurfaceState} then
 * throws - so a newly-added surface that forgets to register fails LOUDLY instead of silently sharing a global.
 */
export function registerCoopOpSurfaceState(surface: string, factory: () => unknown): void {
  opSurfaceFactories.set(surface, factory);
}

/** Build a fresh op-state container for a runtime under construction (clocks lazily keyed on first use). */
export function createCoopRuntimeOpState(): CoopRuntimeOpState {
  const surfaces = new Map<string, unknown>();
  for (const [surface, factory] of opSurfaceFactories) {
    surfaces.set(surface, factory());
  }
  return { hostClock: null, guestClock: null, surfaces };
}

/** The op-state of the currently-installed runtime, set by setCoopRuntime; null when no run is active. */
let activeOpState: CoopRuntimeOpState | null = null;

/** Install/clear the active runtime's op-state (called by setCoopRuntime / clearCoopRuntime). */
export function setActiveCoopRuntimeOpState(state: CoopRuntimeOpState | null): void {
  activeOpState = state;
}

/**
 * Capture the currently installed runtime state for a later callback. The returned object is the runtime's
 * stable state container, not a view of the mutable ambient selector, so an async continuation can bind to
 * the client that scheduled it even after the two-engine harness has installed the other client.
 */
export function getActiveCoopRuntimeOpState(): CoopRuntimeOpState | null {
  return activeOpState;
}

/**
 * Run `fn` with `state` installed as the active op-state, restoring the previous one after. Used to scope a
 * durability-delivered op APPLY to the RECEIVING runtime's op-state: an in-process transport (the two-engine
 * harness loopback) delivers a peer's envelope synchronously during whichever client happens to be draining -
 * or between `withClient` swaps with NO client installed - so the ACTIVE op-state at delivery is NOT reliably
 * the receiver's. Scoping the apply to the receiver's own op-state makes a migrated surface's cursor/aux
 * writes land on the receiver's record (the record its later watcher-adopt reads), instead of the sender's
 * record or a fail-loud throw when nothing is installed. In production (one runtime per process) the active
 * op-state IS already the receiver's, so this is a no-op there - pure harness-fidelity scoping.
 */
export function withActiveCoopRuntimeOpState<T>(state: CoopRuntimeOpState, fn: () => T): T {
  const prev = activeOpState;
  activeOpState = state;
  try {
    return fn();
  } finally {
    activeOpState = prev;
  }
}

/**
 * FAIL-LOUD apply-path accessor for a surface's per-runtime record. Throws (with the surface key) when no
 * runtime is installed or the surface has no record - never lazily constructs a global (that IS the bleed).
 */
export function requireCoopOpSurfaceState<T>(surface: string): T {
  if (activeOpState == null) {
    throw new Error(
      `[coop-op] no runtime installed for surface=${surface} (apply-path access requires an active runtime)`,
    );
  }
  return requireCoopOpSurfaceStateFor<T>(activeOpState, surface);
}

/** Explicit-runtime sibling used by callbacks that captured their owning runtime before an async boundary. */
export function requireCoopOpSurfaceStateFor<T>(state: CoopRuntimeOpState, surface: string): T {
  const record = state.surfaces.get(surface);
  if (record === undefined) {
    throw new Error(
      `[coop-op] surface=${surface} has no per-runtime record (missing registerCoopOpSurfaceState / init)`,
    );
  }
  return record as T;
}

/** SAFE reset/init-path accessor: returns null when idle (nothing to reset) instead of throwing. */
export function maybeCoopOpSurfaceState<T>(surface: string): T | null {
  return (activeOpState?.surfaces.get(surface) as T | undefined) ?? null;
}

/** Per-runtime equivalent of the old shared globalClock: re-keys the active runtime's clock on an epoch change. */
function activeRuntimeClock(
  side: "host" | "guest",
  epoch: CoopSessionEpoch,
  initialRevision: CoopRevision,
): CoopOperationRevisionClock {
  if (activeOpState == null) {
    throw new Error(`[coop-op] no runtime installed (${side} clock)`);
  }
  return runtimeClock(activeOpState, side, epoch, initialRevision);
}

function runtimeClock(
  state: CoopRuntimeOpState,
  side: "host" | "guest",
  epoch: CoopSessionEpoch,
  initialRevision: CoopRevision,
): CoopOperationRevisionClock {
  let clock = side === "host" ? state.hostClock : state.guestClock;
  if (clock == null || clock.epoch !== epoch) {
    clock = { epoch, revision: initialRevision };
    if (side === "host") {
      state.hostClock = clock;
    } else {
      state.guestClock = clock;
    }
  } else if (initialRevision > clock.revision) {
    clock.revision = initialRevision;
  }
  return clock;
}

export function activeRuntimeHostClock(
  epoch: CoopSessionEpoch,
  initialRevision: CoopRevision = 0,
): CoopOperationRevisionClock {
  return activeRuntimeClock("host", epoch, initialRevision);
}

export function activeRuntimeGuestClock(
  epoch: CoopSessionEpoch,
  initialRevision: CoopRevision = 0,
): CoopOperationRevisionClock {
  return activeRuntimeClock("guest", epoch, initialRevision);
}

export function runtimeHostClock(
  state: CoopRuntimeOpState,
  epoch: CoopSessionEpoch,
  initialRevision: CoopRevision = 0,
): CoopOperationRevisionClock {
  return runtimeClock(state, "host", epoch, initialRevision);
}

export function runtimeGuestClock(
  state: CoopRuntimeOpState,
  epoch: CoopSessionEpoch,
  initialRevision: CoopRevision = 0,
): CoopOperationRevisionClock {
  return runtimeClock(state, "guest", epoch, initialRevision);
}

/** Reset the ACTIVE runtime's shared clocks (the per-runtime equivalent of CoopOperationHost.resetGlobalOrder). */
export function resetActiveCoopRuntimeClocks(): void {
  if (activeOpState == null) {
    return;
  }
  activeOpState.hostClock = null;
  activeOpState.guestClock = null;
}

/**
 * The sole-authority commit log. The host receives proposed intents (its own or the guest's relayed one),
 * validates + commits each EXACTLY ONCE, applies (revision++), and produces the envelope to broadcast.
 */
export class CoopOperationHost {
  private readonly epoch: CoopSessionEpoch;
  private readonly revisionClock: CoopOperationRevisionClock;
  private readonly onApplied: ((op: CoopPendingOperation, revision: CoopRevision) => void) | undefined;
  /** The ONE in-flight op the host is driving/awaiting (status proposed/committed), or null when quiescent. */
  private pending: CoopPendingOperation | null = null;
  /** Terminal (and applied) status per id, so a repeated/late message for a completed op is caught (§1.6). */
  private readonly statusById = new Map<CoopOperationId, CoopOperationStatus>();
  /** The last applied op per id, returned on an idempotent re-ACK (§1.3). */
  private readonly appliedById = new Map<CoopOperationId, CoopPendingOperation>();
  private readonly appliedEnvelopeById = new Map<CoopOperationId, CoopAuthoritativeEnvelopeV1>();

  /** Construct a production surface host on the one session-wide authoritative commit clock. */
  public static global(config: Omit<CoopOperationHostConfig, "revisionClock">): CoopOperationHost {
    return new CoopOperationHost({
      ...config,
      revisionClock: getCoopGlobalHostRevisionClock(config.epoch, config.initialRevision ?? 0),
    });
  }

  /** Per-runtime sibling of {@linkcode global}: binds to the ACTIVE runtime's host clock (fail-loud if idle). */
  public static forActiveRuntime(config: Omit<CoopOperationHostConfig, "revisionClock">): CoopOperationHost {
    return new CoopOperationHost({
      ...config,
      revisionClock: activeRuntimeHostClock(config.epoch, config.initialRevision ?? 0),
    });
  }

  /** Bind directly to a captured runtime; safe across async client-context swaps. */
  public static forRuntime(
    state: CoopRuntimeOpState,
    config: Omit<CoopOperationHostConfig, "revisionClock">,
  ): CoopOperationHost {
    return new CoopOperationHost({
      ...config,
      revisionClock: runtimeHostClock(state, config.epoch, config.initialRevision ?? 0),
    });
  }

  /** Test/session teardown hook kept on the imported class so surface modules need no extra dependency. */
  public static resetGlobalOrder(): void {
    resetCoopGlobalOperationOrder();
  }

  public constructor(config: CoopOperationHostConfig) {
    this.epoch = config.epoch;
    this.revisionClock = config.revisionClock ?? { epoch: config.epoch, revision: config.initialRevision ?? 0 };
    if (this.revisionClock.epoch !== config.epoch) {
      throw new Error("CoopOperationHost revision clock epoch mismatch");
    }
    if ((config.initialRevision ?? 0) > this.revisionClock.revision) {
      this.revisionClock.revision = config.initialRevision ?? 0;
    }
    this.onApplied = config.onApplied;
  }

  public getEpoch(): CoopSessionEpoch {
    return this.epoch;
  }

  public getRevision(): CoopRevision {
    return this.revisionClock.revision;
  }

  public getPendingOperation(): CoopPendingOperation | null {
    return this.pending;
  }

  public statusOf(id: CoopOperationId): CoopOperationStatus | undefined {
    return this.statusById.get(id);
  }

  /**
   * Register an in-flight op the host is AWAITING (e.g. a guest-owned intent relayed later, or the host's
   * own op mid-drive). Sets it as the pending slot in status "committed" so a NEWER op that takes the slot
   * before it lands SUPERSEDES it (§1.3), and its late arrival is then late-rejected (§1.6). Idempotent.
   */
  public expect(intent: CoopPendingOperation): void {
    if (this.statusById.has(intent.id)) {
      return; // already terminal / applied - do not re-open an in-flight slot for it.
    }
    this.pending = { ...intent, status: "committed" };
  }

  /**
   * Submit ONE proposed intent to the commit log. This is the single point where invariant 3 (exactly
   * once) is enforced (§1.3). Runs, in order: cross-epoch rejection (§1.4), duplicate/late detection
   * (§1.6), slot supersession (§1.3), validation, then commit+apply (revision++, §1.5).
   */
  public submit(
    intent: CoopPendingOperation,
    ctx: CoopCommitContext,
    validate: CoopIntentValidator,
  ): CoopHostSubmitResult {
    // 1. Epoch guard (§1.4): an id from another epoch can never satisfy a live op. Rejected as cross-epoch.
    const parsed = parseCoopOperationId(intent.id);
    if (parsed == null || parsed.epoch !== this.epoch || parsed.kind !== intent.kind || parsed.owner !== intent.owner) {
      return { kind: "rejected-late", reason: "epoch-mismatch" };
    }

    // 2. Dedupe / late-rejection (§1.6): a message for an id that already reached a terminal state.
    const prior = this.statusById.get(intent.id);
    if (prior === "applied") {
      // Idempotent re-ACK (invariant 3): never a second commit, no revision change.
      const op = this.appliedById.get(intent.id) ?? { ...intent, status: "applied" };
      const envelope =
        this.appliedEnvelopeById.get(intent.id) ?? this.buildEnvelope(ctx, op, this.revisionClock.revision);
      // The deterministic id is the slot's first-writer-wins key. A timeout default and the human's late
      // value can legitimately differ; re-ACK the immutable ORIGINAL envelope so every peer adopts that
      // canonical result, never the retry payload. A different boundary is not a retry and stays rejected.
      if (!reackBoundaryMatches(intent, ctx, op, envelope)) {
        return { kind: "rejected-late", reason: "conflicting-retry" };
      }
      return { kind: "reack", op, envelope };
    }
    if (prior === "rejected" || prior === "superseded") {
      return { kind: "rejected-late", reason: `already-${prior}` };
    }

    // 3. Supersession (§1.3): a newer op takes the slot while the previous in-flight op is still open.
    if (this.pending != null && this.pending.id !== intent.id) {
      this.statusById.set(this.pending.id, "superseded");
      this.pending = null;
    }

    // 4. Validation at the single commit point (owner correct for phase / choice legal / etc.).
    const verdict = validate(intent);
    if (!verdict.ok) {
      // Rejected: broadcast so the proposer surfaces a safe default. NO revision change (§1.3).
      this.statusById.set(intent.id, "rejected");
      this.pending = null;
      const rejectedOp: CoopPendingOperation = { ...intent, status: "rejected", rejectReason: verdict.reason };
      return {
        kind: "rejected",
        reason: verdict.reason,
        envelope: this.buildEnvelope(ctx, rejectedOp, this.revisionClock.revision),
      };
    }

    // 5. Commit + apply (committed -> applied, §1.5): revision++, broadcast, mark terminal-applied.
    this.revisionClock.revision += 1;
    const appliedOp: CoopPendingOperation = { ...intent, status: "applied" };
    this.statusById.set(intent.id, "applied");
    this.appliedById.set(intent.id, appliedOp);
    this.pending = null;
    this.onApplied?.(appliedOp, this.revisionClock.revision); // §1.8 dual-run: advance the legacy counter in lockstep.
    const envelope = this.buildEnvelope(ctx, appliedOp, this.revisionClock.revision);
    this.appliedEnvelopeById.set(intent.id, envelope);
    return { kind: "committed", envelope };
  }

  private buildEnvelope(
    ctx: CoopCommitContext,
    op: CoopPendingOperation,
    revision: CoopRevision,
  ): CoopAuthoritativeEnvelopeV1 {
    return {
      version: 1,
      sessionEpoch: this.epoch,
      revision,
      wave: ctx.wave,
      turn: ctx.turn,
      logicalPhase: ctx.logicalPhase,
      pendingOperation: op,
      authoritativeState: ctx.authoritativeState,
    };
  }
}

// -----------------------------------------------------------------------------
// GUEST applier (§1.6, §1.7).
// -----------------------------------------------------------------------------

/** Outcome of applying one envelope on the guest (§1.6). The caller adopts the DATA plane iff `kind === "applied"`. */
export type CoopGuestApplyResult =
  /** Applied at revision `env.revision`: the caller now adopts the embedded authoritativeState + marks the op applied. */
  | {
      readonly kind: "applied";
      readonly envelope: CoopAuthoritativeEnvelopeV1;
      readonly op: CoopPendingOperation | null;
    }
  /** An in-flight (proposed/committed) op arrived (reconnect tail, §4.4): re-enter the interaction; no state advance. */
  | { readonly kind: "pending"; readonly op: CoopPendingOperation }
  /** The host REJECTED the proposer's intent (§1.3): surface a safe default. No state advance. */
  | { readonly kind: "rejected"; readonly op: CoopPendingOperation }
  /** The op was SUPERSEDED by a newer op for the slot (§1.3). No state advance. */
  | { readonly kind: "superseded"; readonly op: CoopPendingOperation }
  /** Cross-epoch (§1.4) - dropped. */
  | { readonly kind: "dropped-epoch" }
  /** Duplicate / late applied envelope (revision <= last, or id already applied) - idempotent no-op (§1.6). */
  | { readonly kind: "duplicate" }
  /** Revision GAP (> last + 1): the guest missed a commit; request the journal tail (§4.4) rather than apply out of order. */
  | { readonly kind: "gap"; readonly missingFrom: CoopRevision }
  /** Unknown logicalPhase / operation kind (§1.7): FAIL CLOSED - render nothing, hold at last good, request resync. */
  | { readonly kind: "fail-closed"; readonly reason: "unknown-phase" | "unknown-kind" };

export interface CoopOperationGuestConfig {
  readonly epoch: CoopSessionEpoch;
  /** The revision the guest has already applied through (0 = nothing yet; on reconnect, the resync's lastAppliedRevision). Default 0. */
  readonly initialRevision?: CoopRevision;
  /** Shared session-wide receive cursor. Production surfaces use one cursor to reject cross-class reordering. */
  readonly revisionClock?: CoopOperationRevisionClock;
  /** Recognizer for the closed logical-phase union; default the envelope module's guard. Injectable for tests. */
  readonly isKnownPhase?: (phase: string) => boolean;
  /** Recognizer for the closed operation-kind union; default the envelope module's guard. Injectable for tests. */
  readonly isKnownKind?: (kind: string) => boolean;
}

/**
 * The two ORDERING-vs-APPLICATION buckets an inbound op falls into, chosen EXPLICITLY from `op.kind` (never
 * inferred from which applier/call-site delivered the envelope):
 *  - `"applyAtDelivery"`: a terminal whose DATA materializes the instant the journal delivers it. The guest
 *    advances the ordering cursor AND `appliedIds` in ONE step ({@linkcode CoopOperationGuest.applyEnvelope}).
 *    Every reward-class terminal (REWARD / SHOP_BUY / ME_* / FAINT_SWITCH / ...) is this bucket.
 *  - `"deferApplicationToBoundary"`: a RETAINED transaction whose ordering cursor advances at delivery (via
 *    {@linkcode CoopOperationGuest.advanceRevisionOrdering}, so a later same-boundary op at rev+1 is not a
 *    spurious gap) but whose immutable DATA image + `appliedIds` land only at a LATER engine boundary (a
 *    WAVE_ADVANCE whose DATA applies at the host's BattleEndPhase), recorded then via
 *    {@linkcode CoopOperationGuest.markOperationApplied}.
 * EXHAUSTIVE over {@linkcode CoopOperationKind}: the `Record` below MUST name every kind, so a newly-added
 * kind fails to COMPILE here (a missing key is a tsc error) - a new operation class can NEVER silently
 * inherit either behavior; it must be bucketed deliberately in exactly one entry.
 */
export type CoopOperationOrderingClass = "applyAtDelivery" | "deferApplicationToBoundary";

/**
 * The single explicit classification source of truth, keyed by {@linkcode CoopOperationKind}. `WAVE_ADVANCE`
 * is the ONLY `deferApplicationToBoundary` bucket (the between-wave transition retained at staging, DATA
 * applied at the host's BattleEndPhase); every reward-class / interaction terminal is `applyAtDelivery`
 * (cursor + appliedIds together). tsc requires a value for EVERY kind, so a new kind cannot compile until it
 * is bucketed here.
 */
const COOP_OPERATION_ORDERING_CLASS: Record<CoopOperationKind, CoopOperationOrderingClass> = {
  WAVE_ADVANCE: "deferApplicationToBoundary",
  BIOME_PICK: "applyAtDelivery",
  CROSSROADS_PICK: "applyAtDelivery",
  REWARD: "applyAtDelivery",
  SHOP_BUY: "applyAtDelivery",
  FAINT_SWITCH: "applyAtDelivery",
  REVIVAL: "applyAtDelivery",
  ABILITY_PICK: "applyAtDelivery",
  BARGAIN: "applyAtDelivery",
  COLO_PICK: "applyAtDelivery",
  ME_PRESENT: "applyAtDelivery",
  ME_PICK: "applyAtDelivery",
  ME_SUB: "applyAtDelivery",
  ME_BUTTON: "applyAtDelivery",
  ME_TERMINAL: "applyAtDelivery",
  QUIZ_ANSWER: "applyAtDelivery",
  LEARN_MOVE: "applyAtDelivery",
  LEARN_MOVE_BATCH: "applyAtDelivery",
  STORMGLASS: "applyAtDelivery",
  CATCH_FULL: "applyAtDelivery",
};

export function coopOperationOrderingClass(kind: CoopOperationKind): CoopOperationOrderingClass {
  const cls = COOP_OPERATION_ORDERING_CLASS[kind];
  if (cls === undefined) {
    // Unreachable while the map stays exhaustive (tsc enforces an entry for every CoopOperationKind); a
    // forged/off-type kind that slips past the type system fails LOUDLY rather than silently deferring.
    throw new Error(`coop op kind not classified for ordering: ${String(kind)}`);
  }
  return cls;
}

/**
 * The idempotent guest applier. Never mutates shared state itself (invariant 1); it CLASSIFIES each
 * inbound envelope (§1.6) and tells the caller whether to adopt it. Application is a pure function of
 * (sessionEpoch, revision, operationId) (invariant 5).
 */
export class CoopOperationGuest {
  private readonly epoch: CoopSessionEpoch;
  private readonly revisionClock: CoopOperationRevisionClock;
  private readonly isKnownPhase: (phase: string) => boolean;
  private readonly isKnownKind: (kind: string) => boolean;
  /** Ids the guest has already applied, so a re-delivered applied envelope is a no-op (invariant 5, §1.6). */
  private readonly appliedIds = new Set<CoopOperationId>();
  /** The last envelope whose phase + kind the guest recognized (the fail-closed "hold at last known-good", §1.7). */
  private lastGoodEnvelope: CoopAuthoritativeEnvelopeV1 | null = null;

  /** Construct a production surface receiver on the one session-wide authoritative receive cursor. */
  public static global(config: Omit<CoopOperationGuestConfig, "revisionClock">): CoopOperationGuest {
    return new CoopOperationGuest({
      ...config,
      revisionClock: getCoopGlobalGuestRevisionClock(config.epoch, config.initialRevision ?? 0),
    });
  }

  /** Per-runtime sibling of {@linkcode global}: binds to the ACTIVE runtime's guest clock (fail-loud if idle). */
  public static forActiveRuntime(config: Omit<CoopOperationGuestConfig, "revisionClock">): CoopOperationGuest {
    return new CoopOperationGuest({
      ...config,
      revisionClock: activeRuntimeGuestClock(config.epoch, config.initialRevision ?? 0),
    });
  }

  /** Bind directly to a captured runtime; safe across async client-context swaps. */
  public static forRuntime(
    state: CoopRuntimeOpState,
    config: Omit<CoopOperationGuestConfig, "revisionClock">,
  ): CoopOperationGuest {
    return new CoopOperationGuest({
      ...config,
      revisionClock: runtimeGuestClock(state, config.epoch, config.initialRevision ?? 0),
    });
  }

  public constructor(config: CoopOperationGuestConfig) {
    this.epoch = config.epoch;
    this.revisionClock = config.revisionClock ?? { epoch: config.epoch, revision: config.initialRevision ?? 0 };
    if (this.revisionClock.epoch !== config.epoch) {
      throw new Error("CoopOperationGuest revision clock epoch mismatch");
    }
    if ((config.initialRevision ?? 0) > this.revisionClock.revision) {
      this.revisionClock.revision = config.initialRevision ?? 0;
    }
    this.isKnownPhase = config.isKnownPhase ?? isKnownCoopLogicalPhase;
    this.isKnownKind = config.isKnownKind ?? isKnownCoopOperationKind;
  }

  public getEpoch(): CoopSessionEpoch {
    return this.epoch;
  }

  public getLastAppliedRevision(): CoopRevision {
    return this.revisionClock.revision;
  }

  public hasApplied(id: CoopOperationId): boolean {
    return this.appliedIds.has(id);
  }

  public getLastGoodEnvelope(): CoopAuthoritativeEnvelopeV1 | null {
    return this.lastGoodEnvelope;
  }

  /** Classify an envelope without advancing the cursor; live sinks must pass this before mutating engine state. */
  public inspectEnvelope(env: CoopAuthoritativeEnvelopeV1): CoopGuestApplyResult {
    // 1. Epoch guard (§1.6 rule 1): an envelope from another epoch is DROPPED.
    if (env.sessionEpoch !== this.epoch) {
      return { kind: "dropped-epoch" };
    }

    // 2. Fail closed on an unknown phase/kind (§1.7, invariant 8): hold at last good, request resync - never run local.
    if (!this.isKnownPhase(env.logicalPhase)) {
      return { kind: "fail-closed", reason: "unknown-phase" };
    }
    const op = env.pendingOperation;
    if (op != null && !this.isKnownKind(op.kind)) {
      return { kind: "fail-closed", reason: "unknown-kind" };
    }
    if (op != null) {
      const parsed = parseCoopOperationId(op.id);
      if (parsed == null || parsed.epoch !== env.sessionEpoch || parsed.kind !== op.kind || parsed.owner !== op.owner) {
        return { kind: "fail-closed", reason: "unknown-kind" };
      }
    }

    // 3. Control signals that do NOT advance revision (§1.3): rejection / supersession / an in-flight (reconnect) op.
    if (op != null) {
      if (op.status === "rejected") {
        return { kind: "rejected", op };
      }
      if (op.status === "superseded") {
        return { kind: "superseded", op };
      }
      if (op.status === "proposed" || op.status === "committed") {
        return { kind: "pending", op }; // reconnect tail: re-enter the interaction, no state advance (§4.4).
      }
    }

    // 4. Revision handling for an APPLIED (or quiescent) envelope (§1.6 rules 2-3).
    if (op != null && op.status === "applied" && this.appliedIds.has(op.id)) {
      return { kind: "duplicate" }; // id-dedupe (§1.6 rule 3): applied at most once per id.
    }
    if (env.revision <= this.revisionClock.revision) {
      return { kind: "duplicate" }; // revision monotonicity (§1.6 rule 2): a late/duplicate broadcast is a no-op.
    }
    if (env.revision > this.revisionClock.revision + 1) {
      return { kind: "gap", missingFrom: this.revisionClock.revision + 1 }; // a hole: request the tail (§4.4).
    }

    return { kind: "applied", envelope: env, op };
  }

  public applyEnvelope(env: CoopAuthoritativeEnvelopeV1): CoopGuestApplyResult {
    const inspected = this.inspectEnvelope(env);
    if (inspected.kind !== "applied") {
      return inspected;
    }
    const op = inspected.op;
    // Apply only after the untouched envelope passed epoch/kind/global-revision validation.
    this.revisionClock.revision = env.revision;
    if (op != null) {
      this.appliedIds.add(op.id);
    }
    this.lastGoodEnvelope = env;
    return { kind: "applied", envelope: env, op };
  }

  /**
   * Advance ONLY the ORDERING cursor (the global revision clock) for an op that has been RECEIVED and
   * ordered but whose DATA has NOT yet been applied - a WAVE_ADVANCE whose journal cursor advances at
   * staging but whose immutable DATA image applies only at the real BattleEnd boundary. This keeps a LATER
   * same-boundary op (a reward RESULT at rev+1) from being a spurious GAP, WITHOUT recording the op in
   * `appliedIds`: "ordered" and "applied" are SEPARATE facts (mark the application via
   * {@linkcode markOperationApplied} when the DATA lands). Crucially this leaves `hasApplied(op.id)` FALSE,
   * so the relay/watcher adoption path still adopts the exact staged wave-advance instead of rejecting it as
   * a premature duplicate. Idempotent + monotonic (inspect gates it; the clock never regresses).
   */
  public advanceRevisionOrdering(env: CoopAuthoritativeEnvelopeV1): CoopGuestApplyResult {
    assertDeferApplicationToBoundary(env, "advanceRevisionOrdering");
    const inspected = this.inspectEnvelope(env);
    if (inspected.kind !== "applied") {
      return inspected;
    }
    this.revisionClock.revision = env.revision;
    this.lastGoodEnvelope = env;
    return { kind: "applied", envelope: env, op: inspected.op };
  }

  /**
   * Record that a previously ORDERED-but-deferred op has now APPLIED its DATA (the application ledger),
   * separate from the ordering cursor above. Used at the real WAVE_ADVANCE boundary once its immutable state
   * image lands, so a re-delivery of the same op AFTER application is deduped (`hasApplied`) exactly as the
   * former single-step apply did. Idempotent; never regresses the clock.
   */
  public markOperationApplied(env: CoopAuthoritativeEnvelopeV1): void {
    assertDeferApplicationToBoundary(env, "markOperationApplied");
    const op = env.pendingOperation;
    if (op != null) {
      this.appliedIds.add(op.id);
    }
    if (env.revision > this.revisionClock.revision) {
      this.revisionClock.revision = env.revision;
    }
    this.lastGoodEnvelope = env;
  }
}

/**
 * Guard the deferred-application cursor path (advanceRevisionOrdering / markOperationApplied). Its ONLY
 * legitimate caller is a `deferApplicationToBoundary`-class op (WAVE_ADVANCE); an `applyAtDelivery` op that
 * reached here would mean a caller wired a reward-class terminal into the deferred ledger by mistake - fail
 * LOUDLY (the classification is by {@linkcode coopOperationOrderingClass}(op.kind), never by call-site). A
 * quiescent envelope (no pendingOperation) is a plain ordering ACK and passes through.
 */
function assertDeferApplicationToBoundary(env: CoopAuthoritativeEnvelopeV1, site: string): void {
  const op = env.pendingOperation;
  if (op != null && coopOperationOrderingClass(op.kind) !== "deferApplicationToBoundary") {
    throw new Error(`${site}: ${op.kind} is an apply-at-delivery op; use applyEnvelope, not the deferred cursor path`);
  }
}
