/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op OPERATION <-> DURABILITY BRIDGE (Wave-2e authoritative run-state migration;
// see docs/plans/2026-07-10-coop-authoritative-run-state-migration.md, §4.1/§4.2/§4.6).
//
// This is the SEAM the parallel-lane merge left open (§4.6): Wave-2a/b built the
// operation envelope (coop-operation-runtime.ts) and the durability journal
// (coop-durability.ts) in parallel, with a documented plug-in point - "the durability
// manager is a wired but passive scaffold UNTIL the envelope commit path calls
// runtime.durability.commit(...)". Wave-2e closes it.
//
// WHAT IT DOES:
//   - COMMIT -> JOURNAL (committer). A migrated surface adapter, after the sole-authority
//     CoopOperationHost COMMITS an op (revision++, §1.5), calls {@linkcode journalCoopCommittedEnvelope}
//     with the authoritative envelope. That JOURNALS the committed op (so it can be resent /
//     replayed, §4.1/§4.2) and broadcasts it on the additive `envelope` wire arm (§1.1). The
//     legacy relay carrier keeps firing in dual-run (§5.1) - the journal rides ALONGSIDE it, it
//     does not replace it.
//   - REPLAY -> APPLY (receiver). {@linkcode coopOperationDurabilityHooks} hands the durability
//     manager an `extractKey`/`apply` pair. `extractKey` recognizes an inbound `envelope` frame and
//     keys it `(class, revision)`; `apply` routes the replayed committed envelope INTO the surface's
//     idempotent guest applier (invariant 5, §1.6) - NOT around it - so a journal resend / reconnect
//     tail reconstructs + re-applies the op exactly as the live relay-adopt path would, deduped by
//     operationId. The manager's own ACK (`coopAck`) + reconnect (`coopResync`) arms (§4.2/§4.4) are
//     the generic durability channel; the doc's envelope-specialized `envelopeAck`/`reconnectSync`
//     names are RETIRED in favor of them (Wave-2e wire consolidation).
//
// JOURNALED CLASS. Each migrated surface is one journaled class keyed by its SURFACE-LOCAL dense
// revision (§8.2 - the global dense revision lands only when every surface is migrated). The class is
// DERIVED from the envelope's `logicalPhase` so no new wire field is needed:
//   - BIOME_SELECT                     -> "op:biome"  (coop-biome-operation.ts)
//   - REWARD_SELECT / SHOP             -> "op:reward" (coop-reward-operation.ts - one host serves both)
//   - MYSTERY_ENCOUNTER                -> "op:me"     (coop-me-operation.ts)
// The reward shop and biome market share ONE host + ONE surface-local revision (§8.2.1), so both
// phases map to the SAME class - its revision stream stays dense across a reward-then-market run.
//
// FLAGS (§5, adjudication (b)). The plug respects EVERY flag: the manager exists only when
// {@linkcode isCoopDurabilityEnabled}; {@linkcode setCoopOperationDurability} is called with it, so
// {@linkcode journalCoopCommittedEnvelope} is a no-op when durability is OFF; and each adapter's
// commit / apply seam is itself gated by its per-surface flag, so a surface flag OFF = pure legacy
// dual-run (no journaling for it). Flag OFF anywhere = today's behavior.
//
// ENGINE-FREE. Types + the active-manager reference + a tiny applier registry; no globalScene / phases
// / Phaser. The surface adapters REGISTER their appliers at import (one-way: adapters -> this module),
// so there is no circular import.
// =============================================================================

import {
  commitCoopV2InteractionEnvelope,
  isCoopV2InteractionCutoverActive,
} from "#data/elite-redux/coop/authority-v2/cutover-interaction";
import { recordCoopCausalEvent } from "#data/elite-redux/coop/coop-causal-trace";
import type {
  CoopApplyOutcome,
  CoopDurabilityHooks,
  CoopDurabilityManager,
  CoopOperationContinuationAddress,
} from "#data/elite-redux/coop/coop-durability";
import type { CoopAuthoritativeEnvelopeV1, CoopLogicalPhase } from "#data/elite-redux/coop/coop-operation-envelope";
import { type CoopOperationGuest, getActiveCoopRuntimeOpState } from "#data/elite-redux/coop/coop-operation-runtime";
import {
  type CoopOperationSurfaceClass,
  isCoopOperationSurfaceClass,
} from "#data/elite-redux/coop/coop-operation-surface-registry";
import type { CoopOperationContinuationSurface } from "#data/elite-redux/coop/coop-transport";
import { recordCoopUiRelayCarrier } from "#data/elite-redux/coop/coop-ui-relay-trace";

/** The journaled durability class for a committed op, DERIVED from its logical phase (§4.1). */
export function coopOperationClassForPhase(phase: CoopLogicalPhase): CoopOperationSurfaceClass | null {
  switch (phase) {
    case "BIOME_SELECT":
      return "op:biome";
    case "REWARD_SELECT":
    case "SHOP":
      return "op:reward";
    case "MYSTERY_ENCOUNTER":
      return "op:me";
    case "WAVE_VICTORY":
    case "WAVE_FLEE":
    case "GAME_OVER":
      // Wave-2f KEYSTONE (§2.5 item 4): the post-battle wave-advance op. Its envelope's logicalPhase is
      // the NEXT phase the transition enters (WAVE_VICTORY / WAVE_FLEE / GAME_OVER), all one class - the
      // FIRST surface whose journal applier drives a LIVE materialization (registerCoopOperationLiveSink).
      return "op:wave";
    default:
      return null; // control-plane phases that are not (yet) a migrated operation surface
  }
}

/** Resolve classes that share the generic INTERACTION logical phase by their closed operation kind. */
export function coopOperationClassForEnvelope(envelope: CoopAuthoritativeEnvelopeV1): CoopOperationSurfaceClass | null {
  if (envelope.pendingOperation?.kind === "FAINT_SWITCH" && envelope.logicalPhase === "TURN_RESOLVE") {
    return "op:faintSwitch";
  }
  if (envelope.pendingOperation?.kind === "REVIVAL" && envelope.logicalPhase === "TURN_RESOLVE") {
    return "op:revival";
  }
  if (envelope.pendingOperation?.kind === "CATCH_FULL" && envelope.logicalPhase === "TURN_RESOLVE") {
    return "op:catchFull";
  }
  if (
    (envelope.pendingOperation?.kind === "LEARN_MOVE" || envelope.pendingOperation?.kind === "LEARN_MOVE_BATCH")
    && envelope.logicalPhase === "TURN_RESOLVE"
  ) {
    return "op:learnMove";
  }
  if (envelope.logicalPhase === "INTERACTION") {
    switch (envelope.pendingOperation?.kind) {
      case "BARGAIN_PRESENT":
      case "BARGAIN":
        return "op:bargain";
      case "COLO_PICK":
        return "op:colosseum";
      case "ABILITY_PRESENT":
      case "ABILITY_PICK":
        return "op:ability";
      case "STORMGLASS_PRESENT":
      case "STORMGLASS":
        return "op:stormglass";
      default:
        return null;
    }
  }
  return coopOperationClassForPhase(envelope.logicalPhase);
}

/**
 * A surface's guest-side applier: route a replayed committed envelope INTO the surface's idempotent
 * guest applier (invariant 5) AND its live-mutation seam. Returns a {@linkcode CoopApplyOutcome} that
 * GATES the durability manager's ACK (W2e-R P0-1): `applied` (newly consumed - ACK + advance),
 * `duplicate` (already consumed / non-applicable frame - ACK + advance so a resend cannot spin), or
 * `rejected` (a transient failure - do NOT ACK, stays retriable). Registered by each adapter at import.
 */
export interface CoopOperationAuthorityV2ApplyContext {
  readonly authority: "v2";
  /** The one global Authority V2 revision that admitted this material. */
  readonly revision: number;
  readonly operationId: string;
  readonly sessionEpoch: number;
}

export type CoopOperationEnvelopeApplyContext = CoopOperationAuthorityV2ApplyContext | undefined;

export function isCoopOperationAuthorityV2Apply(
  context: CoopOperationEnvelopeApplyContext,
): context is CoopOperationAuthorityV2ApplyContext {
  return context?.authority === "v2";
}

export type CoopOperationEnvelopeApplier = (
  envelope: CoopAuthoritativeEnvelopeV1,
  context?: CoopOperationEnvelopeApplyContext,
) => CoopApplyOutcome;

/**
 * A surface's LIVE-MUTATION SINK (W2e-R P0-1): the ONE seam a journal-delivered committed op routes INTO to
 * perform the REAL shared-run mutation on the receiver (biome switch / reward apply / ME control-flow),
 * instead of only recording sidecar history. Invoked by the surface applier when it NEWLY consumes a
 * journal-delivered op. Returns true iff the live mutation was materialized. A missing, false, or throwing
 * sink MUST leave the envelope unconsumed and unacknowledged so the committer retains it for retry. Delivery
 * is not complete until the receiver's production mutation seam has accepted the operation.
 */
export type CoopOperationLiveSink = (envelope: CoopAuthoritativeEnvelopeV1) => boolean;

/** The active session's durability manager, or null when durability is OFF / no session (set at assembly). */
let activeDurability: CoopDurabilityManager | null = null;

/** Per-class guest appliers (adapters register at import; keyed by {@linkcode coopOperationClassForPhase}). */
const appliers = new Map<string, CoopOperationEnvelopeApplier>();

/** Per-class LIVE-MUTATION sinks (the runtime/engine layer registers at session assembly; keyed by class). */
const liveSinks = new Map<string, CoopOperationLiveSink>();

/** Legacy/unit fallback when no assembled runtime owns the materialization ledger. */
const legacyLiveMaterialized = new Set<string>();

function materializationKey(cls: string, envelope: CoopAuthoritativeEnvelopeV1): string {
  return `${cls}:${envelope.pendingOperation?.id ?? `${envelope.sessionEpoch}:${envelope.revision}`}`;
}

function liveMaterializedLedger(): Set<string> {
  return getActiveCoopRuntimeOpState()?.materializedOperationKeys ?? legacyLiveMaterialized;
}

/**
 * Observability for the failure-first proof (W2e-R T1/T3): the committed envelopes for which the
 * journal carrier INVOKED a live-mutation sink this session, in order. Distinct from
 * {@linkcode journalApplied} (which records ledger consumption): this records ROUTING INTO the mutation
 * seam. A test asserts a cut op arrives here to prove the journal path no longer only records history.
 */
const liveSinkInvoked: CoopAuthoritativeEnvelopeV1[] = [];

/**
 * Test/diagnostic observability: the committed envelopes this client has NEWLY APPLIED via the journal
 * (resend / reconnect tail), in order. The convergence proof asserts a cut op arrives here. Bounded
 * implicitly by a run's op count; reset on session boundaries via {@linkcode resetCoopOperationJournalLog}.
 */
const journalApplied: CoopAuthoritativeEnvelopeV1[] = [];

/** Operation classes committed during this session (coverage/diagnostic ledger, canonical-registry checked). */
const journalCommittedClasses = new Set<CoopOperationSurfaceClass>();

/**
 * Install (or clear) the active session's durability manager. Called from `assembleCoopRuntime` with the
 * flag-gated manager (null when durability is OFF), and cleared on `clearCoopRuntime`. When null,
 * {@linkcode journalCoopCommittedEnvelope} is a no-op (legacy dual-run only).
 */
export function setCoopOperationDurability(manager: CoopDurabilityManager | null): void {
  activeDurability = manager;
}

/**
 * The currently-installed durability manager (null when durability is OFF / idle). Exposed so a scoping
 * helper can SAVE and RESTORE it around an async reward continuation that must journal into its OWNING
 * runtime's manager rather than whatever ambient one happens to be installed at continuation time.
 */
export function getActiveCoopOperationDurability(): CoopDurabilityManager | null {
  return activeDurability;
}

/** Whether the operation commit path currently journals (durability manager installed). */
export function isCoopOperationJournalActive(): boolean {
  return activeDurability != null;
}

/** Explicit-runtime sibling for a callback that captured its owning durability manager. */
export function isCoopOperationJournalActiveFor(manager: CoopDurabilityManager | null): boolean {
  return manager != null;
}

/**
 * Publish final operation-continuation evidence from the same public-UI chokepoint as battle authority.
 * Material application alone never reaches this function and therefore cannot retire host retention.
 */
export function notifyCoopOperationContinuationSurface(
  surface: CoopOperationContinuationSurface,
  address: CoopOperationContinuationAddress,
): number {
  if (isCoopV2InteractionCutoverActive(activeDurability)) {
    return 0;
  }
  return activeDurability?.notifyOperationContinuationSurface(surface, address) ?? 0;
}

/**
 * Publish the host's matching real public continuation surface. This does not ACK or release authority; it
 * starts the peer-convergence stage exactly once while the guest's ordered `continuationReady` remains due.
 */
export function notifyCoopOperationAuthorityContinuationSurface(
  surface: CoopOperationContinuationSurface,
  address: CoopOperationContinuationAddress,
): number {
  if (isCoopV2InteractionCutoverActive(activeDurability)) {
    return 0;
  }
  return activeDurability?.notifyOperationAuthorityContinuationSurface(surface, address) ?? 0;
}

/**
 * COMMIT -> JOURNAL (§4.1/§4.2). Called by a migrated surface adapter immediately after its
 * CoopOperationHost COMMITS an op. Journals the committed envelope (for resend / reconnect replay) and
 * broadcasts it on the `envelope` wire arm. Returns true when durability is OFF (legacy mode) or when the
 * exact entry is concretely retained; returns false for an unmapped surface, journal failure, eviction, or
 * conflicting same-revision payload. Never throws. Terminal callers must remain closed on false.
 */
export function tryJournalCoopCommittedEnvelope(envelope: CoopAuthoritativeEnvelopeV1): boolean {
  return tryJournalCoopCommittedEnvelopeFor(activeDurability, envelope);
}

/**
 * Retain through the supplied runtime's manager instead of the ambient process selector. Async Phaser/UI
 * callbacks in the two-engine harness can resume after another client was installed; binding publication
 * explicitly prevents a host result from being committed into its peer's journal.
 */
export function tryJournalCoopCommittedEnvelopeFor(
  manager: CoopDurabilityManager | null,
  envelope: CoopAuthoritativeEnvelopeV1,
): boolean {
  const cls = coopOperationClassForEnvelope(envelope);
  if (cls == null) {
    return false;
  }
  const v2Result = commitCoopV2InteractionEnvelope(cls, envelope, manager);
  if (v2Result !== "not-cutover") {
    return v2Result === "committed";
  }
  if (manager == null) {
    return true;
  }
  let retained = false;
  try {
    retained = manager.commit("op:global", envelope.revision, { t: "envelope", envelope });
  } catch {
    retained = false;
  }
  if (!retained) {
    return false;
  }
  if (isCoopOperationSurfaceClass(cls)) {
    journalCommittedClasses.add(cls);
  }
  recordCoopUiRelayCarrier(
    "operation",
    `class=${cls} kind=${envelope.pendingOperation?.kind ?? "none"} revision=${envelope.revision}`,
    cls,
  );
  const opId = envelope.pendingOperation?.id ?? `${envelope.sessionEpoch}:revision:${envelope.revision}`;
  recordCoopCausalEvent({
    domain: "operation",
    stage: "committed",
    causalId: opId,
    role: "host",
    epoch: envelope.sessionEpoch,
    revision: envelope.revision,
    wave: envelope.wave,
    turn: envelope.turn,
    detail: `class=${cls} kind=${envelope.pendingOperation?.kind ?? "none"}`,
  });
  return true;
}

/** Compatibility wrapper for surfaces whose live migration still treats the journal as a backstop. */
export function journalCoopCommittedEnvelope(envelope: CoopAuthoritativeEnvelopeV1): void {
  tryJournalCoopCommittedEnvelope(envelope);
}

/**
 * Register a surface's guest applier (adapters call this at import; one-way dep). Keyed by the journaled
 * class ({@linkcode coopOperationClassForPhase}). Idempotent for the same class (last registration wins).
 */
export function registerCoopOperationApplier(cls: string, applier: CoopOperationEnvelopeApplier): () => void {
  const previous = appliers.get(cls);
  appliers.set(cls, applier);
  return () => {
    if (previous == null) {
      appliers.delete(cls);
    } else {
      appliers.set(cls, previous);
    }
  };
}

/**
 * Register (or clear, with `null`) the LIVE-MUTATION sink for a journaled class (W2e-R P0-1). The runtime
 * installs a real materializer here at session assembly; a test installs a recording mock. Clearing it
 * makes delivery fail closed: the op stays unacknowledged and retriable until a materializer is installed.
 * Keyed by {@linkcode coopOperationClassForPhase}.
 */
export function registerCoopOperationLiveSink(cls: string, sink: CoopOperationLiveSink | null): void {
  if (sink == null) {
    liveSinks.delete(cls);
  } else {
    liveSinks.set(cls, sink);
  }
}

export interface CoopOperationRegistrationStatus {
  readonly surfaceClass: CoopOperationSurfaceClass;
  readonly applierRegistered: boolean;
  readonly liveSinkRegistered: boolean;
}

/** Read-only cutover preflight: a mechanical V2 surface needs both its validator/applier and live materializer. */
export function coopOperationRegistrationStatus(
  surfaceClass: CoopOperationSurfaceClass,
): CoopOperationRegistrationStatus {
  return {
    surfaceClass,
    applierRegistered: appliers.has(surfaceClass),
    liveSinkRegistered: liveSinks.has(surfaceClass),
  };
}

/**
 * Route a NEWLY-consumed journal-delivered committed op INTO its class's live-mutation sink (W2e-R P0-1).
 * Called by a surface applier the moment it newly consumes a journal op. Records the routing for the proof
 * observability and returns whether the live mutation was materialized (false when no sink is registered).
 * Successful routing is remembered so a retry after a later sidecar-ledger failure cannot mutate twice.
 * Never throws: a sink failure is converted to `false`, which makes the adapter reject without ACKing.
 */
export function routeCoopOperationToLiveSink(cls: string, envelope: CoopAuthoritativeEnvelopeV1): boolean {
  const key = materializationKey(cls, envelope);
  const materializedLedger = liveMaterializedLedger();
  if (materializedLedger.has(key)) {
    return true;
  }
  liveSinkInvoked.push(envelope);
  const sink = liveSinks.get(cls);
  if (sink == null) {
    return false;
  }
  try {
    const materialized = sink(envelope);
    if (materialized) {
      materializedLedger.add(key);
      recordCoopCausalEvent({
        domain: "operation",
        stage: "materialized",
        causalId: envelope.pendingOperation?.id ?? key,
        role: "guest",
        epoch: envelope.sessionEpoch,
        revision: envelope.revision,
        wave: envelope.wave,
        turn: envelope.turn,
        detail: `class=${cls}`,
      });
    }
    return materialized;
  } catch {
    // The operation remains unacknowledged and retriable.
    return false;
  }
}

/**
 * Validate the untouched authoritative identity before any engine mutation, then route and atomically
 * advance the shared guest cursor. A stale epoch, global gap, unknown kind, or duplicate can never reach a
 * live sink. Sink failure leaves the cursor unchanged so durability can retry honestly.
 */
export function applyCoopOperationEnvelope(
  guest: CoopOperationGuest,
  cls: string,
  envelope: CoopAuthoritativeEnvelopeV1,
  context?: CoopOperationEnvelopeApplyContext,
): CoopApplyOutcome {
  const operation = envelope.pendingOperation;
  if (
    isCoopOperationAuthorityV2Apply(context)
    && (context.revision < 1
      || context.sessionEpoch !== envelope.sessionEpoch
      || operation?.id !== context.operationId
      || operation.status !== "applied")
  ) {
    return "rejected";
  }

  // V2 has already ordered and deduplicated this result in the one authority log. Only immutable envelope
  // identity remains relevant here; reading or advancing envelope.revision would recreate a second clock.
  const inspected = isCoopOperationAuthorityV2Apply(context)
    ? guest.inspectEnvelopeIdentity(envelope)
    : guest.inspectEnvelope(envelope);
  if (inspected.kind === "duplicate") {
    return "duplicate";
  }
  if (inspected.kind !== "applied") {
    return "rejected";
  }
  if (!routeCoopOperationToLiveSink(cls, envelope)) {
    // Valid and in-order, but the live materializer is not ready yet (the destination surface/picker
    // has not opened, or no sink is installed yet). That is engine pacing, not stream corruption:
    // defer (parked local retry + deferred-deadline backstop) instead of burning bounded recovery,
    // whose exhaustion escalates a transient ordering race into a shared session terminal.
    return "deferred";
  }
  if (isCoopOperationAuthorityV2Apply(context)) {
    return "applied";
  }
  return guest.applyEnvelope(envelope).kind === "applied" ? "applied" : "rejected";
}

/**
 * The `extractKey`/`apply` hooks the durability manager needs to carry the operation envelope as one
 * journaled class per surface (§4.6). `extractKey` recognizes the `envelope` frame + keys it
 * `(class, revision)`; `apply` routes the replayed envelope into the surface's idempotent guest applier
 * (invariant 5) and records a NEWLY-applied op for the convergence proof. A phase with no migrated class,
 * or an envelope for a surface with no registered applier, is ignored (the manager treats it as not-a-op).
 */
export interface CoopOperationDurabilityHookOptions {
  /** V2 owns ordering/material/control; the legacy journal becomes an inert compatibility carrier. */
  readonly suppressLegacyAuthority?: () => boolean;
}

export function coopOperationDurabilityHooks(options: CoopOperationDurabilityHookOptions = {}): CoopDurabilityHooks {
  const suppressed = (): boolean => options.suppressLegacyAuthority?.() === true;
  return {
    extractKey: msg => {
      if (suppressed()) {
        return null;
      }
      if (msg.t === "envelope") {
        const cls = coopOperationClassForEnvelope(msg.envelope);
        return cls == null ? null : { cls: "op:global", seq: msg.envelope.revision };
      }
      return null;
    },
    apply: entry => {
      if (suppressed()) {
        // A frame already parked before atomic cutover is drained without mutation, continuation release, or
        // legacy revision inspection. New frames are excluded by extractKey above.
        return "duplicate";
      }
      if (entry.msg.t !== "envelope") {
        // Not an operation frame: nothing to apply, but ACK it so the committer's resend loop terminates.
        return "duplicate";
      }
      const envelope = entry.msg.envelope;
      const surfaceClass = coopOperationClassForEnvelope(envelope);
      if (surfaceClass == null) {
        return "rejected";
      }
      const applier = appliers.get(surfaceClass);
      if (applier == null) {
        // Unknown classes fail closed. ACK-dropping would permanently discard a committed mutation.
        return "rejected";
      }
      const outcome = applier(envelope);
      if (outcome === "applied") {
        journalApplied.push(envelope);
        recordCoopCausalEvent({
          domain: "operation",
          stage: "applied",
          causalId: envelope.pendingOperation?.id ?? `${envelope.sessionEpoch}:revision:${envelope.revision}`,
          role: "guest",
          epoch: envelope.sessionEpoch,
          revision: envelope.revision,
          wave: envelope.wave,
          turn: envelope.turn,
          detail: `class=${surfaceClass}`,
        });
      }
      return outcome;
    },
  };
}

/**
 * Authority V2 replica bridge: route a decoded, authenticated interaction envelope through the exact
 * surface applier the old durability carrier used. This owns no transport/ACK behavior; V2 sequences and
 * receipts the result. Unknown classes fail closed.
 */
export function applyCoopOperationEnvelopeThroughRegisteredApplier(
  surfaceClass: CoopOperationSurfaceClass,
  envelope: CoopAuthoritativeEnvelopeV1,
  context: CoopOperationAuthorityV2ApplyContext,
): CoopApplyOutcome {
  const applier = appliers.get(surfaceClass);
  return applier == null ? "rejected" : applier(envelope, context);
}

/** The committed envelopes NEWLY applied via the journal this session (proof observability). */
export function getCoopOperationJournalApplied(): readonly CoopAuthoritativeEnvelopeV1[] {
  return journalApplied;
}

/** The committed envelopes the journal carrier ROUTED INTO a live-mutation sink this session (W2e-R proof). */
export function getCoopOperationLiveSinkInvoked(): readonly CoopAuthoritativeEnvelopeV1[] {
  return liveSinkInvoked;
}

/** Migrated authoritative operation classes committed in this session, sorted for stable diagnostics. */
export function getCoopOperationJournalCommittedClasses(): readonly CoopOperationSurfaceClass[] {
  return [...journalCommittedClasses].sort();
}

/** Drop the journal-applied + live-sink logs (session boundary / test hygiene). Keeps the applier registry. */
export function resetCoopOperationJournalLog(): void {
  journalApplied.length = 0;
  liveSinkInvoked.length = 0;
  legacyLiveMaterialized.clear();
  getActiveCoopRuntimeOpState()?.materializedOperationKeys.clear();
  journalCommittedClasses.clear();
}
