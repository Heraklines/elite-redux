/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op BIOME-TRAVEL operation surface (Wave-2a authoritative run-state migration;
// see docs/plans/2026-07-10-coop-authoritative-run-state-migration.md, §2.5 item 1 + §5.1).
//
// This is the FIRST production wiring of the authoritative operation model
// (coop-operation-runtime.ts) onto a live control surface: biome travel - the ER
// World-Map biomePick (#15) + the crossroads Stay/Leave (#14). It is the TEMPLATE
// every later surface copies (§7).
//
// WHAT IT DOES (control plane only - adjudication (a): the DATA plane is untouched):
//   - OWNER: mints a TYPED intent (invariant 2) for the biome/crossroads pick and,
//     on the AUTHORITY (coop host), COMMITS it EXACTLY ONCE through CoopOperationHost
//     (invariant 3), advancing a surface-local revision (§1.5).
//   - WATCHER: gates its adoption of the relayed pick through CoopOperationGuest -
//     idempotent by operationId (invariant 5), late-/stale-rejecting a pick from an
//     earlier interaction or a prior epoch (invariant 6, the #861 shape).
//
// DUAL-RUN (§1.8, §5.1): this rides ALONGSIDE the legacy relay, which the phases keep
// firing unchanged. The legacy `biomePick`/`crossroads` relay + the interaction counter
// stay LIVE (removing them is FORBIDDEN until every surface is migrated); this layer is
// ADDITIVE control-plane bookkeeping + a watcher adoption gate. When the flag is OFF the
// surface behaves EXACTLY as before (pure legacy fallback).
//
// FLAG (adjudication (b), §5.4): `isCoopBiomeOperationEnabled()`. Default ON, gated by the
// #806 protocol-version handshake (COOP_PROTOCOL_VERSION bump): paired clients share the
// version, so a session is either both-envelope or both-legacy, never half-and-half. The
// legacy path stays selectable - `setCoopBiomeOperationEnabled(false)` is the one-line
// per-surface rollback (§5.4). State is per-session and reset on clearCoopRuntime.
//
// DESIGN DELTA vs the doc (recorded in §7 "how to migrate a surface"): Wave-2a rides the
// envelope's CONTROL fields over the EXISTING relay carrier (dual-run) rather than a new
// `envelope` wire message - the biome decision's DATA still travels on the existing
// per-turn checkpoint / waveEndState (§1.2 keeps the data apply as-is; the `envelope`
// message arm is declared for the journal wave, Wave-2b). And the surface-local revision
// advances +1 per biome/crossroads op (not the GLOBAL dense revision of §1.5, which lands
// only when every surface is migrated); cross-op stale ordering is enforced on the pinned
// interaction counter, which the counter advances in lockstep (§1.8).
// =============================================================================

import { isCoopV2InteractionCutoverActive } from "#data/elite-redux/coop/authority-v2/cutover-interaction";
import { isCompleteCoopOperationAuthorityState } from "#data/elite-redux/coop/coop-authority-state-validator";
import { captureCoopAuthoritativeBattleState } from "#data/elite-redux/coop/coop-battle-engine";
import { COOP_CAP_OP_BIOME, isCoopSurfaceCapabilityBlocked } from "#data/elite-redux/coop/coop-capabilities";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopApplyOutcome, CoopDurabilityManager } from "#data/elite-redux/coop/coop-durability";
import {
  type CoopAuthoritativeEnvelopeV1,
  type CoopBiomePickPayload,
  type CoopCrossroadsPickPayload,
  type CoopOperationKind,
  type CoopPendingOperation,
  makeCoopOperationId,
  parseCoopOperationId,
} from "#data/elite-redux/coop/coop-operation-envelope";
import {
  applyCoopOperationEnvelope,
  type CoopOperationEnvelopeApplyContext,
  getActiveCoopOperationDurability,
  isCoopOperationAuthorityV2Apply,
  isCoopOperationJournalActive,
  isCoopOperationJournalActiveFor,
  registerCoopOperationApplier,
  tryJournalCoopCommittedEnvelope,
  tryJournalCoopCommittedEnvelopeFor,
} from "#data/elite-redux/coop/coop-operation-journal";
import {
  type CoopCommitContext,
  type CoopIntentValidator,
  CoopOperationGuest,
  CoopOperationHost,
  type CoopRuntimeOpState,
  coopOperationCommitContext,
  getActiveCoopRuntimeOpState,
  maybeCoopOpSurfaceState,
  registerCoopOpSurfaceState,
  requireCoopOpSurfaceState,
  requireCoopOpSurfaceStateFor,
  resetActiveCoopRuntimeClocks,
} from "#data/elite-redux/coop/coop-operation-runtime";
import {
  armCoopBiomeTransitionTailPermit,
  canArmCoopBiomeTransitionTailPermit,
  clearCoopBiomeTransitionTailPermit,
  getCoopBiomeTransitionTailPermit,
} from "#data/elite-redux/coop/coop-renderer-gate";
import {
  COOP_BIOME_PICK_SEQ_BASE,
  COOP_BIOME_TRANSITION_SEQ_BASE,
  COOP_CATCH_FULL_SEQ,
  COOP_CROSSROADS_SEQ_BASE,
  COOP_MAX_REACHABLE_COUNTER,
  COOP_STORMGLASS_SEQ,
} from "#data/elite-redux/coop/coop-seq-registry";
import { coopInteractionOwnerSeat } from "#data/elite-redux/coop/coop-session";
import type { CoopAuthoritativeBattleStateV1, CoopRole } from "#data/elite-redux/coop/coop-transport";
import { BiomeId } from "#enums/biome-id";

/** The biome-travel operation kinds this surface commits (the §2 successors of biomePick / crossroads). */
export type CoopBiomeOperationKind = Extract<CoopOperationKind, "BIOME_PICK" | "CROSSROADS_PICK">;

/** The awaited relay result shape the watcher gates (a subset of CoopInteractionChoice - seq/kind/choice/data). */
export interface CoopBiomeRelayResult {
  readonly choice: number;
  readonly data?: number[] | undefined;
  readonly operationId?: string | undefined;
}

/** The watcher's adoption verdict for a relayed biome/crossroads pick. */
export type CoopBiomeAdoptDecision =
  /** Adopt the relayed pick verbatim (its choice index + biome data). */
  | {
      readonly adopt: true;
      readonly choice: number;
      readonly data: number[] | undefined;
      readonly operationId?: string;
      readonly requiresAuthorityCommit?: boolean;
      readonly authoritativeProjection?: boolean;
    }
  /** Do NOT adopt (stale / duplicate / rejected / cross-epoch / fail-closed): fall to the deterministic backstop. */
  | { readonly adopt: false; readonly reason: string };

// -----------------------------------------------------------------------------
// Flag + per-session state (reset on clearCoopRuntime).
// -----------------------------------------------------------------------------

/**
 * Default ON. Activation is HARD-GATED by the #806 protocol-version handshake (the
 * COOP_PROTOCOL_VERSION bump): a mixed-build pair refuses to pair / banners, so a live session
 * has both peers on the envelope build. The legacy path remains selectable (rollback = set false).
 */
const DEFAULT_ENABLED = !(typeof process !== "undefined" && process.env?.COOP_BIOME_OP === "off");

let enabled = DEFAULT_ENABLED;

/**
 * The session epoch (§1.4). Wave-2a keeps it constant (1) per session and resets the surface state on
 * clearCoopRuntime; the full launch/resume epoch mint is a later, cross-surface piece (§2.4). An epoch
 * change still bumps it here so a cross-epoch operationId is dropped structurally (invariant 6).
 */

/** The authority (coop host) commit log for biome-travel ops. Lazily created; null until first use / on a non-host. */

/** The watcher applier that gates adoption of a relayed pick. Lazily created; null until first use. */

/**
 * Journal-consumed operationIds whose production live sink has fed the committed choice into the real
 * biome/crossroads phase path, but whose phase has not adopted that choice yet. This bridges the intentional
 * safe-boundary handoff: the ONE ledger consumes first in the durability handler, then the phase consumes
 * this marker instead of mistaking the committed choice for an ordinary duplicate and falling into the
 * deterministic (potentially wrong-biome) fallback. The phase releases it only after its terminal mutation,
 * so a lost async UI callback can re-adopt the same operation while a post-terminal duplicate cannot.
 */

/** The exact committed envelope receipt a guest-side biome phase is parked on. */
export interface CoopBiomeCommitReceipt {
  readonly operationId: string;
  readonly kind: CoopBiomeOperationKind;
  readonly revision: number;
  readonly wave: number;
  readonly payload: CoopBiomePickPayload | CoopCrossroadsPickPayload;
}

/**
 * One SelectBiome boundary can terminate through either the interactive World-Map address or the
 * host-owned deterministic address. The renderer may not know which terminal the authority selected
 * until the retained envelope arrives (for example, its pending-node graph can be stale while a travel
 * target is active on the host), so both exact addresses belong to one bounded receipt wait.
 */
export interface CoopBiomeTransitionReceiptAddress {
  readonly sourceWave: number;
  readonly interactivePinned?: number | undefined;
}

let biomeCommitWaitMs = 60_000;
let biomeIntentRetryMs = 1_000;
interface CoopBiomeIntentRetry {
  readonly operationId: string;
  readonly wave: number;
  readonly phaseName: "SelectBiomePhase" | "ErCrossroadsPhase";
  readonly sessionGeneration: number;
  readonly isCurrent: () => boolean;
  readonly resend: () => void;
  timer: ReturnType<typeof setTimeout>;
}
/**
 * Every mutable biome-operation cursor belongs to one runtime. In particular, receipts and retry timers are
 * not process-global: the two-engine harness deliberately hosts both peers in one JS realm, while production
 * hosts one runtime per realm. Keeping these cells together gives both environments the same ownership model.
 */
interface BiomeOpState {
  epoch: number;
  revisionFloor: number;
  authorityHost: CoopOperationHost | null;
  watchGuest: CoopOperationGuest | null;
  readonly pendingJournalMaterializations: Set<string>;
  readonly committedReceipts: Map<string, CoopBiomeCommitReceipt>;
  readonly receiptWaiters: Map<string, Set<(receipt: CoopBiomeCommitReceipt | null) => void>>;
  readonly biomeIntentRetries: Map<string, CoopBiomeIntentRetry>;
  readonly preparedIntents: Map<string, PreparedBiomeIntent>;
  readonly committedResultEnvelopes: Map<string, CoopAuthoritativeEnvelopeV1>;
  lastAppliedPinned: number;
}

registerCoopOpSurfaceState(
  "biome",
  (): BiomeOpState => ({
    epoch: 1,
    revisionFloor: 0,
    authorityHost: null,
    watchGuest: null,
    pendingJournalMaterializations: new Set(),
    committedReceipts: new Map(),
    receiptWaiters: new Map(),
    biomeIntentRetries: new Map(),
    preparedIntents: new Map(),
    committedResultEnvelopes: new Map(),
    lastAppliedPinned: -1,
  }),
);

/** Stable selectors captured before a SelectBiome await or UI callback can outlive its ambient client. */
export interface CoopBiomeOperationBinding {
  readonly opState: CoopRuntimeOpState;
  readonly durability: CoopDurabilityManager | null;
}

/** Capture the scheduling runtime; a missing runtime is never permission to share a process-global ledger. */
export function captureCoopBiomeOperationBinding(): CoopBiomeOperationBinding {
  const opState = getActiveCoopRuntimeOpState();
  if (opState == null) {
    throw new Error("[coop-op] no runtime installed for surface=biome (cannot capture continuation binding)");
  }
  return { opState, durability: getActiveCoopOperationDurability() };
}

function state(binding?: CoopBiomeOperationBinding | null): BiomeOpState {
  return binding == null
    ? requireCoopOpSurfaceState<BiomeOpState>("biome")
    : requireCoopOpSurfaceStateFor<BiomeOpState>(binding.opState, "biome");
}

function journalActive(binding?: CoopBiomeOperationBinding | null): boolean {
  return binding == null ? isCoopOperationJournalActive() : isCoopOperationJournalActiveFor(binding.durability);
}

function v2InteractionActive(binding?: CoopBiomeOperationBinding | null): boolean {
  return isCoopV2InteractionCutoverActive(binding?.durability);
}

function retainEnvelope(envelope: CoopAuthoritativeEnvelopeV1, binding?: CoopBiomeOperationBinding | null): boolean {
  return binding == null
    ? tryJournalCoopCommittedEnvelope(envelope)
    : tryJournalCoopCommittedEnvelopeFor(binding.durability, envelope);
}

function isCoopOpRuntimeError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("[coop-op]");
}

function assertBindingRole(binding: CoopBiomeOperationBinding | null | undefined, role: CoopRole): void {
  if (binding?.opState.localRole != null && binding.opState.localRole !== role) {
    throw new Error(
      `[coop-op] surface=biome binding role=${binding.opState.localRole} cannot execute localRole=${role}`,
    );
  }
}
const VALID_BIOME_IDS: ReadonlySet<number> = new Set(
  Object.values(BiomeId).filter((value): value is BiomeId => typeof value === "number"),
);

function cloneBiomeCommitReceipt(receipt: CoopBiomeCommitReceipt): CoopBiomeCommitReceipt {
  return {
    ...receipt,
    payload: { ...receipt.payload },
  };
}

/** Production wait ceiling; tests may shorten it without weakening the fail-closed behavior. */
export function setCoopBiomeCommitWaitMs(ms: number): void {
  biomeCommitWaitMs = Math.max(1, Math.trunc(ms));
}

export function resetCoopBiomeCommitWaitMs(): void {
  biomeCommitWaitMs = 60_000;
}

export function setCoopBiomeIntentRetryMs(ms: number): void {
  biomeIntentRetryMs = Math.max(1, Math.trunc(ms));
}

export function resetCoopBiomeIntentRetryMs(): void {
  biomeIntentRetryMs = 1_000;
}

/** Guest owner: resend the same exact-boundary intent until commit, replacement, or session teardown. */
export function armCoopBiomeIntentResend(
  params: {
    readonly operationId: string;
    readonly wave: number;
    readonly phaseName: "SelectBiomePhase" | "ErCrossroadsPhase";
    readonly sessionGeneration: number;
    readonly isCurrent: () => boolean;
    readonly resend: () => void;
  },
  binding?: CoopBiomeOperationBinding | null,
): boolean {
  const s = state(binding);
  const parsed = parseCoopOperationId(params.operationId);
  if (
    !isCoopBiomeOperationEnabled()
    || parsed?.epoch !== s.epoch
    || !Number.isSafeInteger(params.wave)
    || params.wave < 0
    || !Number.isSafeInteger(params.sessionGeneration)
  ) {
    return false;
  }
  const existing = s.biomeIntentRetries.get(params.operationId);
  if (existing != null) {
    return (
      existing.wave === params.wave
      && existing.phaseName === params.phaseName
      && existing.sessionGeneration === params.sessionGeneration
    );
  }
  const tick = (): void => {
    const retry = s.biomeIntentRetries.get(params.operationId);
    if (retry == null) {
      return;
    }
    if (parseCoopOperationId(retry.operationId)?.epoch !== s.epoch || !retry.isCurrent()) {
      cancelCoopBiomeIntentResend(retry.operationId, binding);
      return;
    }
    try {
      retry.resend();
    } catch (e) {
      coopWarn("reward", `biome op intent resend threw id=${retry.operationId}; retry remains armed`, e);
    }
    if (s.biomeIntentRetries.has(retry.operationId)) {
      retry.timer = setTimeout(tick, biomeIntentRetryMs);
    }
  };
  const retry: CoopBiomeIntentRetry = { ...params, timer: setTimeout(tick, biomeIntentRetryMs) };
  s.biomeIntentRetries.set(params.operationId, retry);
  return true;
}

export function cancelCoopBiomeIntentResend(operationId: string, binding?: CoopBiomeOperationBinding | null): void {
  const s = state(binding);
  const retry = s.biomeIntentRetries.get(operationId);
  if (retry != null) {
    clearTimeout(retry.timer);
    s.biomeIntentRetries.delete(operationId);
  }
}

/** Stable operation identity shared by the relay and journal paths. */
export function coopBiomeOperationId(
  kind: CoopBiomeOperationKind,
  seq: number,
  pinned: number,
  binding?: CoopBiomeOperationBinding | null,
): string {
  return makeCoopOperationId(state(binding).epoch, coopInteractionOwnerSeat(pinned), seq, kind);
}

/** Stable host-owned identity for a deterministic biome transition with no human picker. */
export function coopAuthoritativeBiomeTransitionOperationId(
  sourceWave: number,
  binding?: CoopBiomeOperationBinding | null,
): string | null {
  if (!Number.isSafeInteger(sourceWave) || sourceWave < 0 || sourceWave >= COOP_MAX_REACHABLE_COUNTER) {
    return null;
  }
  return makeCoopOperationId(state(binding).epoch, 0, COOP_BIOME_TRANSITION_SEQ_BASE + sourceWave, "BIOME_PICK");
}

/** True when this guest must wait for the authority's journaled commit before mutating. */
export function coopBiomeCommitRequired(localRole: CoopRole, binding?: CoopBiomeOperationBinding | null): boolean {
  assertBindingRole(binding, localRole);
  return localRole === "guest" && isCoopBiomeOperationEnabled() && journalActive(binding);
}

function isValidBiomeCommitAddress(
  envelope: CoopAuthoritativeEnvelopeV1,
  binding?: CoopBiomeOperationBinding | null,
): boolean {
  const authoritativeState = envelope.authoritativeState;
  return (
    envelope.version === 1
    && envelope.logicalPhase === "BIOME_SELECT"
    && Number.isSafeInteger(envelope.revision)
    && envelope.revision > 0
    && Number.isSafeInteger(envelope.wave)
    && envelope.wave >= 0
    && Number.isSafeInteger(envelope.turn)
    && envelope.turn >= 0
    && authoritativeState != null
    && typeof authoritativeState === "object"
    && authoritativeState.version === 1
    && authoritativeState.wave === envelope.wave
    && authoritativeState.turn === envelope.turn
    && (!v2InteractionActive(binding)
      || isCompleteCoopOperationAuthorityState(authoritativeState, envelope.wave, envelope.turn))
  );
}

function isValidBiomePickPayload(payload: CoopBiomePickPayload, wave: number): boolean {
  return (
    Number.isSafeInteger(payload?.sourceBiomeId)
    && VALID_BIOME_IDS.has(payload.sourceBiomeId)
    && Number.isSafeInteger(payload?.biomeId)
    && VALID_BIOME_IDS.has(payload.biomeId)
    && Number.isSafeInteger(payload?.nodeIndex)
    && payload.nodeIndex >= -1
    && Number.isSafeInteger(payload?.nextWave)
    && payload.nextWave === wave + 1
  );
}

export interface CoopBiomeJournalMaterializationPlan {
  readonly receipt: CoopBiomeCommitReceipt;
  readonly permit: {
    readonly operationId: string;
    readonly sessionEpoch: number;
    readonly revision: number;
    readonly wave: number;
    readonly sourceBiomeId: number;
    readonly destinationBiomeId: number;
    readonly nextWave: number;
  } | null;
}

function isValidCrossroadsPickPayload(payload: CoopCrossroadsPickPayload): boolean {
  return Number.isSafeInteger(payload?.optionIndex) && (payload.optionIndex === 0 || payload.optionIndex === 1);
}

/**
 * Pure validation for the production sink. It checks the complete untouched envelope and active-permit
 * conflict without buffering a relay choice, arming a permit, publishing a receipt, or waking a waiter.
 */
export function preflightCoopBiomeJournalMaterialization(
  envelope: CoopAuthoritativeEnvelopeV1,
  binding?: CoopBiomeOperationBinding | null,
): CoopBiomeJournalMaterializationPlan | null {
  const s = state(binding);
  const op = envelope.pendingOperation;
  const parsed = op == null ? null : parseCoopOperationId(op.id);
  if (
    op == null
    || parsed == null
    || parsed.epoch !== envelope.sessionEpoch
    || parsed.epoch !== s.epoch
    || parsed.kind !== op.kind
    || parsed.owner !== op.owner
    || op.status !== "applied"
    || (op.kind !== "BIOME_PICK" && op.kind !== "CROSSROADS_PICK")
    || !isValidBiomeCommitAddress(envelope, binding)
  ) {
    return null;
  }
  let permit: CoopBiomeJournalMaterializationPlan["permit"] = null;
  if (op.kind === "BIOME_PICK") {
    const payload = op.payload as CoopBiomePickPayload;
    if (!isValidBiomePickPayload(payload, envelope.wave)) {
      return null;
    }
    const interactivePinned = parsed.pinnedSeq - COOP_BIOME_PICK_SEQ_BASE;
    const exactInteractiveAddress =
      interactivePinned >= 0
      && interactivePinned <= COOP_MAX_REACHABLE_COUNTER
      && parsed.pinnedSeq < COOP_STORMGLASS_SEQ
      && parsed.owner === coopInteractionOwnerSeat(interactivePinned)
      && payload.nodeIndex >= 0;
    const exactDeterministicAddress =
      envelope.wave >= 0
      && envelope.wave < COOP_MAX_REACHABLE_COUNTER
      && parsed.pinnedSeq === COOP_BIOME_TRANSITION_SEQ_BASE + envelope.wave
      && parsed.pinnedSeq < COOP_CATCH_FULL_SEQ
      && parsed.owner === 0
      && payload.nodeIndex === -1;
    permit = {
      operationId: op.id,
      sessionEpoch: envelope.sessionEpoch,
      revision: envelope.revision,
      wave: envelope.wave,
      sourceBiomeId: payload.sourceBiomeId,
      destinationBiomeId: payload.biomeId,
      nextWave: payload.nextWave,
    };
    if ((!exactInteractiveAddress && !exactDeterministicAddress) || !canArmCoopBiomeTransitionTailPermit(permit)) {
      return null;
    }
  } else {
    const crossroadsPinned = parsed.pinnedSeq - COOP_CROSSROADS_SEQ_BASE;
    if (
      crossroadsPinned < 0
      || crossroadsPinned > COOP_MAX_REACHABLE_COUNTER
      || parsed.pinnedSeq >= COOP_BIOME_PICK_SEQ_BASE
      || parsed.owner !== coopInteractionOwnerSeat(crossroadsPinned)
      || !isValidCrossroadsPickPayload(op.payload as CoopCrossroadsPickPayload)
    ) {
      return null;
    }
  }
  const payload =
    op.kind === "BIOME_PICK"
      ? ({ ...(op.payload as CoopBiomePickPayload) } satisfies CoopBiomePickPayload)
      : ({ ...(op.payload as CoopCrossroadsPickPayload) } satisfies CoopCrossroadsPickPayload);
  return {
    receipt: {
      operationId: op.id,
      kind: op.kind,
      revision: envelope.revision,
      wave: envelope.wave,
      payload,
    },
    permit,
  };
}

/** Publish a preflighted receipt only after the relay mutation succeeded. */
export function publishCoopBiomeJournalMaterialization(
  plan: CoopBiomeJournalMaterializationPlan,
  binding?: CoopBiomeOperationBinding | null,
): boolean {
  const s = state(binding);
  if (plan.permit != null && !armCoopBiomeTransitionTailPermit(plan.permit)) {
    return false;
  }
  const { receipt } = plan;
  s.pendingJournalMaterializations.add(receipt.operationId);
  s.committedReceipts.set(receipt.operationId, receipt);
  const waiters = s.receiptWaiters.get(receipt.operationId);
  if (waiters != null) {
    s.receiptWaiters.delete(receipt.operationId);
    for (const resolve of waiters) {
      resolve(receipt);
    }
  }
  return true;
}

/** Backward-compatible atomic helper for non-relay callers. */
export function armCoopBiomeJournalMaterialization(
  envelope: CoopAuthoritativeEnvelopeV1,
  binding?: CoopBiomeOperationBinding | null,
): boolean {
  const plan = preflightCoopBiomeJournalMaterialization(envelope, binding);
  return plan != null && publishCoopBiomeJournalMaterialization(plan, binding);
}

/** Park on one exact operation until the host-committed envelope reaches this guest. */
export async function awaitCoopBiomeCommitReceipt(
  operationId: string,
  binding?: CoopBiomeOperationBinding | null,
): Promise<CoopBiomeCommitReceipt | null> {
  const s = state(binding);
  const existing = s.committedReceipts.get(operationId);
  if (existing != null) {
    return existing;
  }
  return await new Promise(resolve => {
    const waiters = s.receiptWaiters.get(operationId) ?? new Set<(receipt: CoopBiomeCommitReceipt | null) => void>();
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const accept = (receipt: CoopBiomeCommitReceipt | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      waiters.delete(accept);
      resolve(receipt);
    };
    waiters.add(accept);
    s.receiptWaiters.set(operationId, waiters);
    timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      waiters.delete(accept);
      if (waiters.size === 0) {
        s.receiptWaiters.delete(operationId);
      }
      resolve(null);
    }, biomeCommitWaitMs);
  });
}

function biomeTransitionReceiptOperationIds(
  address: CoopBiomeTransitionReceiptAddress,
  binding?: CoopBiomeOperationBinding | null,
): string[] {
  const deterministic = coopAuthoritativeBiomeTransitionOperationId(address.sourceWave, binding);
  if (deterministic == null) {
    return [];
  }
  const ids = [deterministic];
  if (
    address.interactivePinned != null
    && Number.isSafeInteger(address.interactivePinned)
    && address.interactivePinned >= 0
    && address.interactivePinned <= COOP_MAX_REACHABLE_COUNTER
  ) {
    ids.push(
      coopBiomeOperationId(
        "BIOME_PICK",
        COOP_BIOME_PICK_SEQ_BASE + address.interactivePinned,
        address.interactivePinned,
        binding,
      ),
    );
  }
  return ids;
}

function existingBiomeTransitionReceipts(
  operationIds: readonly string[],
  binding?: CoopBiomeOperationBinding | null,
): CoopBiomeCommitReceipt[] {
  const s = state(binding);
  return operationIds.flatMap(operationId => {
    const receipt = s.committedReceipts.get(operationId);
    return receipt == null ? [] : [receipt];
  });
}

/**
 * Synchronous retained-receipt read for a phase that starts after the journal delivery. Keeping this path
 * synchronous matters for both real browser re-entry and the two-engine harness: an already-applied exact
 * terminal should be projected under the currently installed scene/runtime, without another ambient-global
 * async hop. Two receipts at the same boundary are a protocol conflict and therefore fail closed.
 */
export function getCoopBiomeTransitionCommitReceipt(
  address: CoopBiomeTransitionReceiptAddress,
  binding?: CoopBiomeOperationBinding | null,
): CoopBiomeCommitReceipt | null {
  const operationIds = biomeTransitionReceiptOperationIds(address, binding);
  const receipts = existingBiomeTransitionReceipts(operationIds, binding);
  if (receipts.length > 1) {
    coopWarn(
      "reward",
      `biome transition has conflicting retained terminals wave=${address.sourceWave} ids=${receipts.map(r => r.operationId).join(",")}`,
    );
    return null;
  }
  return receipts.length === 1 ? cloneBiomeCommitReceipt(receipts[0]) : null;
}

/**
 * Await whichever exact terminal the authority retained for one SelectBiome boundary. A chained renderer
 * can therefore recover when its local route graph classified the surface differently from the host, while
 * still accepting no unaddressed relay, local RNG fallback, or interaction-counter-only orphan.
 */
export function awaitCoopBiomeTransitionCommitReceipt(
  address: CoopBiomeTransitionReceiptAddress,
  binding?: CoopBiomeOperationBinding | null,
): Promise<CoopBiomeCommitReceipt | null> {
  const s = state(binding);
  const operationIds = biomeTransitionReceiptOperationIds(address, binding);
  if (operationIds.length === 0) {
    return Promise.resolve(null);
  }
  const existing = existingBiomeTransitionReceipts(operationIds, binding);
  if (existing.length > 1) {
    coopWarn(
      "reward",
      `biome transition refused conflicting retained terminals wave=${address.sourceWave} ids=${existing.map(r => r.operationId).join(",")}`,
    );
    return Promise.resolve(null);
  }
  if (existing.length === 1) {
    return Promise.resolve(cloneBiomeCommitReceipt(existing[0]));
  }
  return new Promise(resolve => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const listeners = new Map<string, (receipt: CoopBiomeCommitReceipt | null) => void>();
    const finish = (receipt: CoopBiomeCommitReceipt | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      for (const [operationId, listener] of listeners) {
        const waiters = s.receiptWaiters.get(operationId);
        waiters?.delete(listener);
        if (waiters?.size === 0) {
          s.receiptWaiters.delete(operationId);
        }
      }
      resolve(receipt == null ? null : cloneBiomeCommitReceipt(receipt));
    };
    for (const operationId of operationIds) {
      const listener = (receipt: CoopBiomeCommitReceipt | null): void => {
        if (receipt == null) {
          finish(null);
          return;
        }
        const now = existingBiomeTransitionReceipts(operationIds, binding);
        if (now.length !== 1 || now[0].operationId !== receipt.operationId) {
          coopWarn(
            "reward",
            `biome transition receipt race conflicted wave=${address.sourceWave} ids=${now.map(r => r.operationId).join(",")}`,
          );
          finish(null);
          return;
        }
        finish(receipt);
      };
      listeners.set(operationId, listener);
      const waiters = s.receiptWaiters.get(operationId) ?? new Set<(receipt: CoopBiomeCommitReceipt | null) => void>();
      waiters.add(listener);
      s.receiptWaiters.set(operationId, waiters);
    }
    timer = setTimeout(() => finish(null), biomeCommitWaitMs);
  });
}

/** Release receipt/marker bookkeeping after the phase has consumed its committed result. */
export function releaseCoopBiomeCommitReceipt(operationId: string, binding?: CoopBiomeOperationBinding | null): void {
  const s = state(binding);
  cancelCoopBiomeIntentResend(operationId, binding);
  s.committedReceipts.delete(operationId);
  s.pendingJournalMaterializations.delete(operationId);
}

/**
 * The highest interaction-counter (pinned) value the local client has already ADOPTED a biome-travel op at
 * AS A WATCHER. Cross-op stale ordering runs on this (a pick pinned strictly BELOW it is a stale leftover
 * from an earlier interaction, §1.6). Advanced ONLY by a watcher adoption - never by the owner's own commit,
 * so the owner-commit + watcher-adopt of the SAME interaction never contaminate each other. -1 = none yet.
 */

/**
 * The surface-local revision FLOOR (W2e-R P0-3). On a COLD resume the durability receiver ledger is restored
 * to the persisted per-class high-water N (coop-runtime.ts applyCoopControlPlaneSaveData), but the surface's
 * CoopOperationHost + guest appliers are recreated at revision 0 - so the producer would emit revision 1 and
 * the restored receiver would drop it as a stale duplicate (isDuplicate: 1 <= N). Flooring the host + guests
 * to N makes the producer continue at N+1 and the guests accept it, keeping the committed-op revision stream
 * MONOTONIC across the save boundary (§4.6 - the same monotonic-continue contract the counter/high-water use;
 * the epoch is unchanged, so the restored receiver marks stay valid). 0 = fresh session (no resume).
 */

/**
 * True iff the migrated (envelope-gated) biome-travel path is active; else pure legacy fallback (§5.1).
 * The local rollback flag (`enabled`) is the OUTER gate; the NEGOTIATED capability set is the inner one
 * (#896 W2e-R2): if the peer did not advertise "opSurface.biome", it is not in the intersection and the
 * surface stays OFF on BOTH peers - so a flag-flip / mixed build can never activate it one-sided. Pre-
 * handshake (no negotiated set yet) the capability gate is inert, so the local flag stands alone.
 */
export function isCoopBiomeOperationEnabled(): boolean {
  return enabled && !isCoopSurfaceCapabilityBlocked(COOP_CAP_OP_BIOME);
}

/** Select the migrated path (true) or the legacy relay fallback (false). The one-line per-surface rollback (§5.4). */
export function setCoopBiomeOperationEnabled(value: boolean): void {
  enabled = value;
}

/** Restore the flag to its version-gated default (test hygiene). */
export function resetCoopBiomeOperationFlag(): void {
  enabled = DEFAULT_ENABLED;
}

/** The current biome-travel operation epoch (§1.4). */
export function getCoopBiomeOperationEpoch(): number {
  return maybeCoopOpSurfaceState<BiomeOpState>("biome")?.epoch ?? 1;
}

/**
 * Set the operation epoch (§1.4). A CHANGE resets the per-session op state so a leftover operationId from a
 * prior epoch can never satisfy a live op (invariant 6). Idempotent for the same epoch.
 */
export function setCoopBiomeOperationEpoch(next: number): void {
  const s = maybeCoopOpSurfaceState<BiomeOpState>("biome");
  if (s == null || !Number.isSafeInteger(next) || next <= 0 || next === s.epoch) {
    return;
  }
  s.epoch = next;
  resetCoopBiomeOperationState();
}

/** Tear down all per-session operation state (called from clearCoopRuntime + tests). Keeps the flag. */
export function resetCoopBiomeOperationState(): void {
  const s = maybeCoopOpSurfaceState<BiomeOpState>("biome");
  if (s == null) {
    return;
  }
  resetActiveCoopRuntimeClocks();
  for (const retry of s.biomeIntentRetries.values()) {
    clearTimeout(retry.timer);
  }
  s.biomeIntentRetries.clear();
  s.preparedIntents.clear();
  s.committedResultEnvelopes.clear();
  s.authorityHost = null;
  s.watchGuest = null;
  s.pendingJournalMaterializations.clear();
  s.committedReceipts.clear();
  for (const waiters of s.receiptWaiters.values()) {
    for (const resolve of waiters) {
      resolve(null);
    }
  }
  s.receiptWaiters.clear();
  clearCoopBiomeTransitionTailPermit();
  s.lastAppliedPinned = -1;
  s.revisionFloor = 0;
}

/**
 * Seed the surface-local revision FLOOR from the persisted per-class high-water on a COLD resume (W2e-R
 * P0-3). Called from `applyCoopControlPlaneSaveData` with `journalHighWater["op:biome"]`. Recreates the
 * host + guests so the producer continues at floor+1 and the guests accept it (see {@linkcode revisionFloor}).
 * A no-op for a fresh session (floor 0). Idempotent for the same value.
 */
export function setCoopBiomeOperationRevisionFloor(hw: number): void {
  const s = maybeCoopOpSurfaceState<BiomeOpState>("biome");
  if (s == null || !Number.isFinite(hw) || hw <= 0 || hw === s.revisionFloor) {
    return;
  }
  s.revisionFloor = hw;
  // Recreate the host + guests so the new floor takes effect on next use (they were created at the old floor).
  s.authorityHost = null;
  s.watchGuest = null;
}

// -----------------------------------------------------------------------------
// Internals.
// -----------------------------------------------------------------------------

function host(binding?: CoopBiomeOperationBinding | null): CoopOperationHost {
  const s = state(binding);
  s.authorityHost ??=
    binding == null
      ? CoopOperationHost.forActiveRuntime({ epoch: s.epoch, initialRevision: s.revisionFloor })
      : CoopOperationHost.forRuntime(binding.opState, { epoch: s.epoch, initialRevision: s.revisionFloor });
  return s.authorityHost;
}

function guest(binding?: CoopBiomeOperationBinding | null): CoopOperationGuest {
  const s = state(binding);
  s.watchGuest ??=
    binding == null
      ? CoopOperationGuest.forActiveRuntime({ epoch: s.epoch, initialRevision: s.revisionFloor })
      : CoopOperationGuest.forRuntime(binding.opState, { epoch: s.epoch, initialRevision: s.revisionFloor });
  return s.watchGuest;
}

/**
 * A minimal control-plane commit context. Wave-2a's biome decision carries no NEW data-plane payload over
 * the wire (the mon/field state travels on the existing checkpoint, dual-run), so the embedded
 * authoritativeState is a lightweight placeholder the applier never reads (it classifies on the CONTROL
 * fields only). The real adopt-by-id state apply is UNCHANGED (adjudication (a), §1.2).
 */
function controlContext(wave: number, turn: number): CoopCommitContext {
  return coopOperationCommitContext(wave, turn, "BIOME_SELECT");
}

// -----------------------------------------------------------------------------
// Owner seam (§1.3 propose -> commit).
// -----------------------------------------------------------------------------

export interface CoopBiomeOwnerCommitParams {
  readonly kind: CoopBiomeOperationKind;
  /** The relay address (BASE + pinned) - the globally-unique interaction address, the operationId suffix (§2.2). */
  readonly seq: number;
  /** The interaction counter this op is pinned at (§2.2). */
  readonly pinned: number;
  /** The chosen option/route index (the biome node index, or Stay=0 / Leave=1). */
  readonly choice: number;
  /** The typed payload (§1.1 discriminated per kind). */
  readonly payload: CoopBiomePickPayload | CoopCrossroadsPickPayload;
  /** The local client's coop role - determines whether it is the authority that COMMITS. */
  readonly localRole: CoopRole;
  readonly wave: number;
  readonly turn: number;
  readonly boundarySourceBiomeId: number;
  readonly boundaryNextWave: number;
  /** Host-local revealed route order at this exact boundary; never sourced from the remote intent. */
  readonly allowedRoutes: readonly number[];
  /** The sole host-derived deterministic destination allowed to use nodeIndex=-1, or null for a real picker. */
  readonly deterministicDestination: number | null;
  /** Deterministic transition control belongs to the host, independent of interaction-owner parity. */
  readonly authorityOwned?: boolean;
  /** Live authoritative phase path: arm the host-local exact tail after the commit succeeds. */
  readonly armLocalTail?: boolean;
}

interface PreparedBiomeIntent {
  readonly intent: CoopPendingOperation;
  readonly params: CoopBiomeOwnerCommitParams;
}

export interface CoopBiomeOwnerCommitResult {
  readonly operationId: string;
  readonly payload: CoopBiomePickPayload | CoopCrossroadsPickPayload;
  readonly revision: number;
  readonly wave: number;
}

function retainPreparedBiomeIntent(state: BiomeOpState, prepared: PreparedBiomeIntent): boolean {
  const prior = state.preparedIntents.get(prepared.intent.id);
  if (prior != null) {
    return JSON.stringify(prior) === JSON.stringify(prepared);
  }
  state.preparedIntents.set(prepared.intent.id, {
    intent: structuredClone(prepared.intent),
    params: {
      ...prepared.params,
      payload: structuredClone(prepared.params.payload),
      allowedRoutes: [...prepared.params.allowedRoutes],
    },
  });
  return true;
}

function biomeBoundaryValidator(params: {
  readonly pinned: number;
  readonly seq: number;
  readonly kind: CoopBiomeOperationKind;
  readonly wave: number;
  readonly sourceBiomeId: number;
  readonly nextWave: number;
  readonly allowedRoutes: readonly number[];
  readonly deterministicDestination: number | null;
  readonly expectedOwner: number;
  readonly authorityOwned: boolean;
}): CoopIntentValidator {
  return intent => {
    if (intent.owner !== params.expectedOwner) {
      return { ok: false, reason: `wrong-owner:${intent.owner}!=${params.expectedOwner}` };
    }
    if (intent.kind !== params.kind) {
      return { ok: false, reason: "wrong-kind" };
    }
    if (params.kind === "CROSSROADS_PICK") {
      return params.seq === COOP_CROSSROADS_SEQ_BASE + params.pinned
        && params.expectedOwner === coopInteractionOwnerSeat(params.pinned)
        && isValidCrossroadsPickPayload(intent.payload as CoopCrossroadsPickPayload)
        ? { ok: true }
        : { ok: false, reason: "invalid-crossroads-address-or-choice" };
    }
    const payload = intent.payload as CoopBiomePickPayload;
    const exactAddress = params.authorityOwned
      ? params.seq === COOP_BIOME_TRANSITION_SEQ_BASE + params.wave
        && params.wave >= 0
        && params.wave < COOP_MAX_REACHABLE_COUNTER
        && params.expectedOwner === 0
        && payload.nodeIndex === -1
      : params.seq === COOP_BIOME_PICK_SEQ_BASE + params.pinned
        && params.pinned >= 0
        && params.pinned <= COOP_MAX_REACHABLE_COUNTER
        && params.expectedOwner === coopInteractionOwnerSeat(params.pinned)
        && payload.nodeIndex >= 0;
    if (
      !exactAddress
      || !isValidBiomePickPayload(payload, params.wave)
      || !VALID_BIOME_IDS.has(params.sourceBiomeId)
      || params.nextWave !== params.wave + 1
      || payload.sourceBiomeId !== params.sourceBiomeId
      || payload.nextWave !== params.nextWave
    ) {
      return { ok: false, reason: "wrong-biome-boundary" };
    }
    if (payload.nodeIndex === -1) {
      return params.deterministicDestination === payload.biomeId
        ? { ok: true }
        : { ok: false, reason: "unpermitted-deterministic-biome" };
    }
    return payload.nodeIndex < params.allowedRoutes.length
      && params.allowedRoutes[payload.nodeIndex] === payload.biomeId
      && VALID_BIOME_IDS.has(payload.biomeId)
      ? { ok: true }
      : { ok: false, reason: "biome-not-in-revealed-routes" };
  };
}

/** A live host cannot open a second biome-tail slot while another exact transition is unfinished. */
function hostBiomeTailSlotAvailable(operationId: string, payload: CoopBiomePickPayload, wave: number): boolean {
  const active = getCoopBiomeTransitionTailPermit();
  return (
    active == null
    || (active.operationId === operationId
      && active.wave === wave
      && active.sourceBiomeId === payload.sourceBiomeId
      && active.destinationBiomeId === payload.biomeId
      && active.nextWave === payload.nextWave)
  );
}

function armPreparedBiomeTail(
  state: BiomeOpState,
  prepared: PreparedBiomeIntent,
  envelope: CoopAuthoritativeEnvelopeV1,
): boolean {
  if (prepared.params.kind !== "BIOME_PICK" || prepared.params.armLocalTail !== true) {
    return true;
  }
  const payload = envelope.pendingOperation?.payload as CoopBiomePickPayload;
  return armCoopBiomeTransitionTailPermit({
    operationId: envelope.pendingOperation?.id ?? prepared.intent.id,
    sessionEpoch: state.epoch,
    revision: envelope.revision,
    wave: envelope.wave,
    sourceBiomeId: payload.sourceBiomeId,
    destinationBiomeId: payload.biomeId,
    nextWave: payload.nextWave,
  });
}

/**
 * OWNER TERMINAL: mint + (on the authority) COMMIT the typed biome-travel intent through the operation
 * primitive (§1.3). ADDITIVE + dual-run: the phase still fires the legacy relay send; this records the
 * authoritative operation. No-op when the flag is OFF. Gameplay validation failures retain the legacy
 * fallback; a missing/mismatched runtime binding throws fail-loud so the shared surface cannot advance.
 */
export function commitBiomeOwnerIntent(
  params: CoopBiomeOwnerCommitParams,
  binding?: CoopBiomeOperationBinding | null,
): CoopBiomeOwnerCommitResult | null {
  if (!isCoopBiomeOperationEnabled()) {
    return null;
  }
  const exactCallerAddress = params.authorityOwned
    ? params.kind === "BIOME_PICK"
      && Number.isSafeInteger(params.wave)
      && params.wave >= 0
      && params.wave < COOP_MAX_REACHABLE_COUNTER
      && params.seq === COOP_BIOME_TRANSITION_SEQ_BASE + params.wave
      && (params.payload as CoopBiomePickPayload).nodeIndex === -1
    : Number.isSafeInteger(params.pinned)
      && params.pinned >= 0
      && params.pinned <= COOP_MAX_REACHABLE_COUNTER
      && params.seq
        === (params.kind === "BIOME_PICK" ? COOP_BIOME_PICK_SEQ_BASE : COOP_CROSSROADS_SEQ_BASE) + params.pinned;
  if (!exactCallerAddress) {
    return null;
  }
  try {
    assertBindingRole(binding, params.localRole);
    const s = state(binding);
    const ownerSeat = params.authorityOwned ? 0 : coopInteractionOwnerSeat(params.pinned);
    const operationId = params.authorityOwned
      ? makeCoopOperationId(s.epoch, 0, params.seq, params.kind)
      : coopBiomeOperationId(params.kind, params.seq, params.pinned, binding);
    const intent: CoopPendingOperation = {
      id: operationId,
      kind: params.kind,
      owner: ownerSeat,
      status: "proposed",
      payload: params.payload,
    };
    const validate = biomeBoundaryValidator({
      pinned: params.pinned,
      seq: params.seq,
      kind: params.kind,
      wave: params.wave,
      sourceBiomeId: params.boundarySourceBiomeId,
      nextWave: params.boundaryNextWave,
      allowedRoutes: params.allowedRoutes,
      deterministicDestination: params.deterministicDestination,
      expectedOwner: ownerSeat,
      authorityOwned: params.authorityOwned === true,
    });
    if (!validate(intent).ok) {
      return null;
    }
    if (
      params.kind === "BIOME_PICK"
      && params.armLocalTail === true
      && !hostBiomeTailSlotAvailable(operationId, params.payload as CoopBiomePickPayload, params.wave)
    ) {
      return null;
    }
    if (journalActive(binding) && v2InteractionActive(binding)) {
      // Retained biome decisions are two-stage. The operation identity and validated intent are frozen
      // here; the phase must reach its real terminal/mutation seam before the authority captures and
      // commits the complete resulting state through commitBiomeAuthoritativeResult.
      if (!retainPreparedBiomeIntent(s, { intent, params })) {
        return null;
      }
      return { operationId, payload: structuredClone(params.payload), revision: 0, wave: params.wave };
    }
    // The AUTHORITY (coop host) is the sole committer (invariant 3). When the LOCAL owner is the host, it
    // commits its own intent here; when the owner is the guest, the host commits on adopt (watcher seam).
    if (params.localRole === "host") {
      const res = host(binding).submit(intent, controlContext(params.wave, params.turn), validate);
      if (res.kind === "committed") {
        // COMMIT -> JOURNAL (Wave-2e, §4.1/§4.2): register the committed op with the durability journal so
        // a resend / reconnect tail can replay it. Rides ALONGSIDE the legacy relay (dual-run); no-op when
        // durability is OFF. The DATA still travels on the existing checkpoint (§1.2).
        const committed = {
          operationId,
          payload: res.envelope.pendingOperation?.payload as CoopBiomePickPayload | CoopCrossroadsPickPayload,
          revision: res.envelope.revision,
          wave: res.envelope.wave,
        };
        if (!retainEnvelope(res.envelope, binding)) {
          return null;
        }
        if (
          params.kind === "BIOME_PICK"
          && params.armLocalTail === true
          && !armCoopBiomeTransitionTailPermit({
            operationId,
            sessionEpoch: s.epoch,
            revision: committed.revision,
            wave: committed.wave,
            sourceBiomeId: (committed.payload as CoopBiomePickPayload).sourceBiomeId,
            destinationBiomeId: (committed.payload as CoopBiomePickPayload).biomeId,
            nextWave: (committed.payload as CoopBiomePickPayload).nextWave,
          })
        ) {
          return null;
        }
        coopLog(
          "reward",
          `biome op OWNER commit kind=${params.kind} rev=${res.envelope.revision} id=${intent.id} (Wave-2a)`,
        );
        return committed;
      }
      if (res.kind === "reack") {
        const canonical = res.op;
        const verdict = validate(canonical);
        if (verdict.ok) {
          const committed = {
            operationId,
            payload: canonical.payload as CoopBiomePickPayload | CoopCrossroadsPickPayload,
            revision: res.envelope.revision,
            wave: res.envelope.wave,
          };
          if (!retainEnvelope(res.envelope, binding)) {
            return null;
          }
          if (
            params.kind === "BIOME_PICK"
            && params.armLocalTail === true
            && !armCoopBiomeTransitionTailPermit({
              operationId,
              sessionEpoch: s.epoch,
              revision: committed.revision,
              wave: committed.wave,
              sourceBiomeId: (committed.payload as CoopBiomePickPayload).sourceBiomeId,
              destinationBiomeId: (committed.payload as CoopBiomePickPayload).biomeId,
              nextWave: (committed.payload as CoopBiomePickPayload).nextWave,
            })
          ) {
            return null;
          }
          return committed;
        }
      } else {
        coopWarn(
          "reward",
          `biome op OWNER commit non-committed (${res.kind}) id=${intent.id} - legacy relay carries it (Wave-2a)`,
        );
      }
      return null;
    }
    // NOTE: the owner does NOT advance lastAppliedPinned - that is a WATCHER-only order (see its field
    // doc). The owner knows its own pick; only an adopted RELAY needs the stale-ordering guard.
    return { operationId, payload: params.payload, revision: 0, wave: params.wave };
  } catch (e) {
    if (isCoopOpRuntimeError(e)) {
      throw e;
    }
    coopWarn("reward", "biome op OWNER commit threw (handled - legacy relay is the fallback) (Wave-2a)", e);
    return null;
  }
}

/**
 * Authority terminal seam for a prepared biome/crossroads decision. The complete post-action state and
 * exact transition permit become one immutable result; a failed publication retains the same envelope for
 * retry and never re-executes the phase mutation.
 */
export function commitBiomeAuthoritativeResult(
  operationId: string,
  authoritativeState?: CoopAuthoritativeBattleStateV1 | null,
  binding?: CoopBiomeOperationBinding | null,
): CoopBiomeOwnerCommitResult | null {
  if (!isCoopBiomeOperationEnabled() || !journalActive(binding) || !v2InteractionActive(binding)) {
    return null;
  }
  const s = state(binding);
  const prepared = s.preparedIntents.get(operationId);
  if (prepared == null || prepared.params.localRole !== "host") {
    return null;
  }
  const retained = s.committedResultEnvelopes.get(operationId);
  if (retained != null) {
    if (!armPreparedBiomeTail(s, prepared, retained) || !retainEnvelope(retained, binding)) {
      return null;
    }
    return {
      operationId,
      payload: structuredClone(retained.pendingOperation?.payload) as CoopBiomePickPayload | CoopCrossroadsPickPayload,
      revision: retained.revision,
      wave: retained.wave,
    };
  }
  const resultState = authoritativeState ?? captureCoopAuthoritativeBattleState(prepared.params.turn);
  if (!isCompleteCoopOperationAuthorityState(resultState, prepared.params.wave, prepared.params.turn)) {
    return null;
  }
  const ownerSeat = prepared.params.authorityOwned ? 0 : coopInteractionOwnerSeat(prepared.params.pinned);
  const validate = biomeBoundaryValidator({
    pinned: prepared.params.pinned,
    seq: prepared.params.seq,
    kind: prepared.params.kind,
    wave: prepared.params.wave,
    sourceBiomeId: prepared.params.boundarySourceBiomeId,
    nextWave: prepared.params.boundaryNextWave,
    allowedRoutes: prepared.params.allowedRoutes,
    deterministicDestination: prepared.params.deterministicDestination,
    expectedOwner: ownerSeat,
    authorityOwned: prepared.params.authorityOwned === true,
  });
  const result = host(binding).submit(
    prepared.intent,
    {
      wave: prepared.params.wave,
      turn: prepared.params.turn,
      logicalPhase: "BIOME_SELECT",
      authoritativeState: resultState,
    },
    validate,
  );
  if (result.kind !== "committed" && result.kind !== "reack") {
    return null;
  }
  const envelope = result.envelope;
  // Freeze the exact result before any fallible publication edge. Retrying reuses this envelope and cannot
  // consume another operation/global revision. The local transition permit is installed first so a remote
  // replica can never observe a published result that the authority itself is unable to project.
  s.committedResultEnvelopes.set(operationId, envelope);
  if (!armPreparedBiomeTail(s, prepared, envelope) || !retainEnvelope(envelope, binding)) {
    return null;
  }
  const payload = envelope.pendingOperation?.payload as CoopBiomePickPayload | CoopCrossroadsPickPayload;
  return {
    operationId,
    payload: structuredClone(payload),
    revision: envelope.revision,
    wave: envelope.wave,
  };
}

/**
 * Commit a host-derived biome destination for a path with no human picker. Its address is wave-scoped and
 * disjoint from interaction-counter picks, so every deterministic SelectBiome terminal still arms one exact
 * Switch/NewBiome permit without consuming or perturbing the alternation counter.
 */
export function commitAuthoritativeBiomeTransition(
  params: {
    readonly sourceWave: number;
    readonly sourceBiomeId: number;
    readonly destinationBiomeId: number;
    readonly turn: number;
    readonly localRole: CoopRole;
  },
  binding?: CoopBiomeOperationBinding | null,
): CoopBiomeOwnerCommitResult | null {
  if (
    params.localRole !== "host"
    || !Number.isSafeInteger(params.sourceWave)
    || params.sourceWave < 0
    || params.sourceWave >= COOP_MAX_REACHABLE_COUNTER
  ) {
    return null;
  }
  const seq = COOP_BIOME_TRANSITION_SEQ_BASE + params.sourceWave;
  return commitBiomeOwnerIntent(
    {
      kind: "BIOME_PICK",
      seq,
      pinned: params.sourceWave,
      choice: -1,
      payload: {
        sourceBiomeId: params.sourceBiomeId,
        biomeId: params.destinationBiomeId,
        nodeIndex: -1,
        nextWave: params.sourceWave + 1,
      },
      localRole: params.localRole,
      wave: params.sourceWave,
      turn: params.turn,
      boundarySourceBiomeId: params.sourceBiomeId,
      boundaryNextWave: params.sourceWave + 1,
      allowedRoutes: [],
      deterministicDestination: params.destinationBiomeId,
      authorityOwned: true,
      armLocalTail: true,
    },
    binding,
  );
}

// -----------------------------------------------------------------------------
// Watcher seam (invariant 5 idempotent apply + invariant 6 late-rejection).
// -----------------------------------------------------------------------------

export interface CoopBiomeWatcherAdoptParams {
  readonly kind: CoopBiomeOperationKind;
  readonly seq: number;
  readonly pinned: number;
  /** The awaited relay result (null = owner timed out / disconnected -> deterministic backstop). */
  readonly res: CoopBiomeRelayResult | null;
  readonly localRole: CoopRole;
  readonly wave: number;
  readonly turn: number;
  /** Exact transition identity for BIOME_PICK; ignored by CROSSROADS_PICK. */
  readonly sourceBiomeId: number;
  readonly nextWave: number;
  readonly allowedRoutes: readonly number[];
  readonly deterministicDestination: number | null;
  /** Live authoritative phase path: arm the host-local exact tail after validating a guest-owned pick. */
  readonly armLocalTail?: boolean;
}

/**
 * WATCHER: gate the adoption of the relayed owner pick through the operation primitive. When the flag is
 * OFF this is a pass-through (adopt iff the relay landed) - pure legacy behavior. When ON:
 *   - on the AUTHORITY watching a guest-owned pick, VALIDATE + COMMIT the guest's intent (invariant 3);
 *   - gate application idempotently by operationId + the pinned order (invariants 5, 6): a stale pick from
 *     an earlier interaction, a duplicate re-delivery, or a cross-epoch leftover is REJECTED, never applied
 *     (the #861 shape). The caller falls back to the deterministic backstop on a reject.
 * Gameplay validation failures return `adopt:false`; a missing/mismatched runtime binding throws fail-loud.
 */
export function adoptBiomeWatcherChoice(
  params: CoopBiomeWatcherAdoptParams,
  binding?: CoopBiomeOperationBinding | null,
): CoopBiomeAdoptDecision {
  // Legacy / fallback: adopt iff the relay landed, no operation gating.
  if (!isCoopBiomeOperationEnabled()) {
    return params.res == null
      ? { adopt: false, reason: "no-relay" }
      : { adopt: true, choice: params.res.choice, data: params.res.data };
  }
  if (params.res == null) {
    return { adopt: false, reason: "no-relay" };
  }
  try {
    assertBindingRole(binding, params.localRole);
    const s = state(binding);
    const ownerSeat = coopInteractionOwnerSeat(params.pinned);
    const opId = coopBiomeOperationId(params.kind, params.seq, params.pinned, binding);
    if (params.localRole === "host" && v2InteractionActive(binding) && params.res.operationId !== opId) {
      return { adopt: false, reason: "proposal-operation-id-mismatch" };
    }
    const payload: CoopBiomePickPayload | CoopCrossroadsPickPayload =
      params.kind === "BIOME_PICK"
        ? {
            sourceBiomeId: params.sourceBiomeId,
            biomeId: params.res.data?.[0] ?? -1,
            nodeIndex: params.res.choice,
            nextWave: params.nextWave,
          }
        : { optionIndex: params.res.choice };
    const intent: CoopPendingOperation = { id: opId, kind: params.kind, owner: ownerSeat, status: "proposed", payload };

    // The AUTHORITY (host) is the sole committer: if it is WATCHING a guest-owned pick, commit it now
    // (invariant 3). A rejection (wrong owner) -> do not adopt.
    if (params.localRole === "host") {
      const validate = biomeBoundaryValidator({
        pinned: params.pinned,
        seq: params.seq,
        kind: params.kind,
        wave: params.wave,
        sourceBiomeId: params.sourceBiomeId,
        nextWave: params.nextWave,
        allowedRoutes: params.allowedRoutes,
        deterministicDestination: params.deterministicDestination,
        expectedOwner: ownerSeat,
        authorityOwned: false,
      });
      if (
        params.kind === "BIOME_PICK"
        && params.armLocalTail === true
        && !hostBiomeTailSlotAvailable(opId, payload as CoopBiomePickPayload, params.wave)
      ) {
        return { adopt: false, reason: "host-permit-slot-busy" };
      }
      if (journalActive(binding) && v2InteractionActive(binding)) {
        const preparedParams: CoopBiomeOwnerCommitParams = {
          kind: params.kind,
          seq: params.seq,
          pinned: params.pinned,
          choice: params.res.choice,
          payload,
          localRole: "host",
          wave: params.wave,
          turn: params.turn,
          boundarySourceBiomeId: params.sourceBiomeId,
          boundaryNextWave: params.nextWave,
          allowedRoutes: [...params.allowedRoutes],
          deterministicDestination: params.deterministicDestination,
          ...(params.armLocalTail === undefined ? {} : { armLocalTail: params.armLocalTail }),
        };
        if (!retainPreparedBiomeIntent(s, { intent, params: preparedParams })) {
          return { adopt: false, reason: "host-intent-payload-conflict" };
        }
        return {
          adopt: true,
          choice: params.res.choice,
          data: params.res.data,
          operationId: opId,
          requiresAuthorityCommit: true,
        };
      }
      const res = host(binding).submit(intent, controlContext(params.wave, params.turn), validate);
      if (res.kind === "rejected" || res.kind === "rejected-late") {
        coopWarn("reward", `biome op WATCHER(host) commit REJECTED (${res.kind}) id=${opId} -> fallback (Wave-2a)`);
        return { adopt: false, reason: `host-${res.kind}` };
      }
      if (res.kind === "committed") {
        // COMMIT -> JOURNAL (Wave-2e): the host is the sole committer of a GUEST-owned pick; journal the
        // authoritative envelope it just produced so a cut is healed by the journal, not a bespoke self-heal.
        // The host is the authority and has just validated+committed this guest-owned intent. Its live
        // phase may apply immediately; only the remote guest must wait for the committed envelope.
        const committed = res.envelope.pendingOperation?.payload as CoopBiomePickPayload | CoopCrossroadsPickPayload;
        if (!retainEnvelope(res.envelope, binding)) {
          return { adopt: false, reason: "host-journal-not-retained" };
        }
        if (
          params.kind === "BIOME_PICK"
          && params.armLocalTail === true
          && !armCoopBiomeTransitionTailPermit({
            operationId: opId,
            sessionEpoch: s.epoch,
            revision: res.envelope.revision,
            wave: res.envelope.wave,
            sourceBiomeId: (committed as CoopBiomePickPayload).sourceBiomeId,
            destinationBiomeId: (committed as CoopBiomePickPayload).biomeId,
            nextWave: (committed as CoopBiomePickPayload).nextWave,
          })
        ) {
          return { adopt: false, reason: "host-permit-conflict" };
        }
        s.lastAppliedPinned = params.pinned;
        return params.kind === "BIOME_PICK"
          ? {
              adopt: true,
              choice: (committed as CoopBiomePickPayload).nodeIndex,
              data: [(committed as CoopBiomePickPayload).biomeId],
            }
          : { adopt: true, choice: (committed as CoopCrossroadsPickPayload).optionIndex, data: undefined };
      }
      if (res.kind === "reack") {
        // Callback/relay replay must use the ORIGINAL applied payload. submit() intentionally bypasses its
        // validator on reack, so revalidate that canonical payload against the still-live boundary here.
        const verdict = validate(res.op);
        if (!verdict.ok) {
          return { adopt: false, reason: `host-reack-${verdict.reason}` };
        }
        const canonical = res.op.payload as CoopBiomePickPayload | CoopCrossroadsPickPayload;
        if (!retainEnvelope(res.envelope, binding)) {
          return { adopt: false, reason: "host-reack-journal-not-retained" };
        }
        if (
          params.kind === "BIOME_PICK"
          && params.armLocalTail === true
          && !armCoopBiomeTransitionTailPermit({
            operationId: opId,
            sessionEpoch: s.epoch,
            revision: res.envelope.revision,
            wave: res.envelope.wave,
            sourceBiomeId: (canonical as CoopBiomePickPayload).sourceBiomeId,
            destinationBiomeId: (canonical as CoopBiomePickPayload).biomeId,
            nextWave: (canonical as CoopBiomePickPayload).nextWave,
          })
        ) {
          return { adopt: false, reason: "host-reack-permit-conflict" };
        }
        s.lastAppliedPinned = params.pinned;
        return params.kind === "BIOME_PICK"
          ? {
              adopt: true,
              choice: (canonical as CoopBiomePickPayload).nodeIndex,
              data: [(canonical as CoopBiomePickPayload).biomeId],
            }
          : { adopt: true, choice: (canonical as CoopCrossroadsPickPayload).optionIndex, data: undefined };
      }
      return { adopt: false, reason: "host-noncommitted" };
    }

    // Stale / duplicate rejection (invariant 6, the #861 shape): a pick pinned STRICTLY BELOW one we already
    // adopted (a leftover from an earlier interaction), or a re-delivery of an already-applied op (same
    // operationId), can NEVER overwrite the live decision. The pinned counter is monotonic across all
    // interactions, so a legitimate current pick is always >= the last adopted one.
    if (params.pinned < s.lastAppliedPinned) {
      coopWarn(
        "reward",
        `biome op WATCHER REJECT stale/dup id=${opId} pinned=${params.pinned} lastApplied=${s.lastAppliedPinned} (Wave-2a)`,
      );
      return { adopt: false, reason: "stale-or-duplicate" };
    }

    // ONE LEDGER + safe-boundary materialization: the journal may have consumed the operation before this
    // real phase resumed. Its live sink fed the authoritative choice into the local relay and armed this
    // marker. Keep it durable until the phase reports a successful terminal and releases the receipt; this
    // lets a lost UI/tween callback re-adopt safely. An ordinary relay duplicate after release remains a no-op.
    // Authority V2 deliberately bypasses CoopOperationGuest's legacy revision/deduplication clock. The
    // production V2 sink publishes `pendingJournalMaterializations` only after the globally ordered entry
    // has passed full envelope validation, applied through the registered surface sink, and materialized
    // this exact relay/receipt. Requiring `guest.hasApplied(opId)` as a second proof therefore makes a valid
    // V2 result impossible to consume and leaves Crossroads/World Map parked forever. The address-exact
    // materialization receipt is the sole live-consumption permit; the legacy ledger remains only a
    // duplicate detector after that permit has been released.
    if (s.pendingJournalMaterializations.has(opId)) {
      s.lastAppliedPinned = params.pinned;
      coopLog("reward", `biome op WATCHER materialize JOURNAL choice kind=${params.kind} id=${opId}`);
      return {
        adopt: true,
        choice: params.res.choice,
        data: params.res.data,
        operationId: opId,
        authoritativeProjection: true,
      };
    }
    if (guest(binding).hasApplied(opId)) {
      coopWarn(
        "reward",
        `biome op WATCHER REJECT duplicate id=${opId} pinned=${params.pinned} lastApplied=${s.lastAppliedPinned} (Wave-2a)`,
      );
      return { adopt: false, reason: "stale-or-duplicate" };
    }

    if (journalActive(binding)) {
      return { adopt: false, reason: "await-authoritative-envelope" };
    }

    // Apply through the guest applier (surface-local dense revision; classifies + records the op).
    const appliedOp: CoopPendingOperation = { ...intent, status: "applied" };
    const g = guest(binding);
    const applyRes = g.applyEnvelope({
      version: 1,
      sessionEpoch: s.epoch,
      revision: g.getLastAppliedRevision() + 1,
      wave: params.wave,
      turn: params.turn,
      logicalPhase: "BIOME_SELECT",
      pendingOperation: appliedOp,
      authoritativeState: controlContext(params.wave, params.turn).authoritativeState,
    });
    if (applyRes.kind !== "applied") {
      coopWarn("reward", `biome op WATCHER guest non-applied (${applyRes.kind}) id=${opId} -> fallback (Wave-2a)`);
      return { adopt: false, reason: `guest-${applyRes.kind}` };
    }
    s.lastAppliedPinned = params.pinned;
    coopLog("reward", `biome op WATCHER adopt kind=${params.kind} choice=${params.res.choice} id=${opId} (Wave-2a)`);
    return { adopt: true, choice: params.res.choice, data: params.res.data };
  } catch (e) {
    if (isCoopOpRuntimeError(e)) {
      throw e;
    }
    coopWarn("reward", "biome op WATCHER gate threw (handled - deterministic fallback) (Wave-2a)", e);
    return { adopt: false, reason: "threw" };
  }
}

// -----------------------------------------------------------------------------
// Journal replay seam (Wave-2e, §4.2/§4.4): route a resent / reconnect-tail committed envelope INTO the
// idempotent guest applier - NOT around it - so a cut op re-applies exactly once by operationId.
// -----------------------------------------------------------------------------

/**
 * Apply a committed biome-travel envelope delivered by the durability journal (a resend or reconnect
 * tail). Routes into the SAME {@linkcode CoopOperationGuest} the live relay-adopt path uses, so it is
 * idempotent by operationId (invariant 5): a dual-run duplicate (the live relay already adopted it) is a
 * no-op. Returns true iff the op was NEWLY applied. No-op when the surface flag is OFF (pure legacy).
 */
function applyJournaledBiomeEnvelope(
  envelope: CoopAuthoritativeEnvelopeV1,
  applyContext?: CoopOperationEnvelopeApplyContext,
): CoopApplyOutcome {
  // A consistent peer cannot send this while the surface is disabled. Refuse an incompatible/corrupt
  // frame without ACKing rather than permanently discarding an authoritative mutation.
  if (!isCoopBiomeOperationEnabled()) {
    return "rejected";
  }
  const op = envelope.pendingOperation;
  if (op == null || op.status !== "applied") {
    return "rejected";
  }
  const g = guest();
  if (!isCoopOperationAuthorityV2Apply(applyContext) && g.hasApplied(op.id)) {
    return "duplicate"; // already converged via the journal (a reconnect resend re-delivery) - ACK, no re-apply.
  }
  const biomeApply = applyCoopOperationEnvelope(g, "op:biome", envelope, applyContext);
  if (biomeApply !== "applied") {
    // A transient non-applicable result (a gap the manager already guards against, a fail-closed, or a
    // not-yet-ready live sink deferral): leave it retriable (do NOT ACK). Never a permanent condition
    // (a permanent one is a duplicate above).
    return biomeApply;
  }
  cancelCoopBiomeIntentResend(op.id);
  // Route the newly-consumed op into the production live sink. It feeds the committed choice into the
  // receiver's local interaction relay, so the existing SelectBiomePhase / ErCrossroadsPhase safe apply path
  // performs the real mutation. That production sink arms the one-shot phase handoff itself; headless
  // recording sinks can still prove routing without changing live adoption semantics.
  coopLog("reward", `biome op JOURNAL apply id=${op.id} rev=${envelope.revision} (Wave-2e/W2e-R)`);
  return "applied";
}

// Register the biome-travel guest applier so the durability manager can route a resent / reconnect-tail
// `op:biome` envelope into it (one-way dep: adapter -> journal bridge; runs at import).
registerCoopOperationApplier("op:biome", applyJournaledBiomeEnvelope);
