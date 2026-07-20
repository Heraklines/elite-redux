/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { isCompleteCoopOperationAuthorityState } from "#data/elite-redux/coop/coop-authority-state-validator";
import { COOP_CAP_OP_ABILITY, isCoopSurfaceCapabilityBlocked } from "#data/elite-redux/coop/coop-capabilities";
import { coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopApplyOutcome, CoopDurabilityManager } from "#data/elite-redux/coop/coop-durability";
import { COOP_ABILITY_ACTION_STRIDE } from "#data/elite-redux/coop/coop-operation-address";
import {
  type CoopAbilityPickPayload,
  type CoopAbilityPresentationPayload,
  type CoopAuthoritativeEnvelopeV1,
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
import { coopInteractionOwnerSeat } from "#data/elite-redux/coop/coop-session";
import type { CoopRole } from "#data/elite-redux/coop/coop-transport";

export { COOP_ABILITY_ACTION_STRIDE };

const DEFAULT_ENABLED = !(typeof process !== "undefined" && process.env?.COOP_ABILITY_OP === "off");

let enabled = DEFAULT_ENABLED;
let retryMs = 1_000;

interface AbilityOpState {
  epoch: number;
  revisionFloor: number;
  authorityHost: CoopOperationHost | null;
  receiverGuest: CoopOperationGuest | null;
  authorityOrdinalPin: number;
  authorityOrdinal: number;
  watcherOrdinalPin: number;
  watcherOrdinal: number;
  readonly retries: Map<string, ReturnType<typeof setTimeout>>;
  readonly pendingMaterializations: Set<string>;
  /** Exact retained results whose complete authority image has been installed on this renderer. */
  readonly stateAppliedOperations: Set<string>;
  /** Results whose exact local ability phase consumed the outcome and reached its terminal. */
  readonly settledOperations: Set<string>;
}

registerCoopOpSurfaceState(
  "ability",
  (): AbilityOpState => ({
    epoch: 1,
    revisionFloor: 0,
    authorityHost: null,
    receiverGuest: null,
    authorityOrdinalPin: -1,
    authorityOrdinal: 0,
    watcherOrdinalPin: -1,
    watcherOrdinal: 0,
    retries: new Map(),
    pendingMaterializations: new Set(),
    stateAppliedOperations: new Set(),
    settledOperations: new Set(),
  }),
);

/** Opaque runtime selectors captured by a picker before any UI or async continuation. */
export interface CoopAbilityOperationBinding {
  readonly opState: CoopRuntimeOpState;
  readonly durability: CoopDurabilityManager | null;
}

/**
 * Capture the scheduling client's stable operation state. A co-op phase without an installed runtime is a
 * programming error: fail at the scheduling boundary instead of silently adopting a process-global ledger.
 */
export function captureCoopAbilityOperationBinding(): CoopAbilityOperationBinding {
  const opState = getActiveCoopRuntimeOpState();
  if (opState == null) {
    throw new Error("[coop-op] no runtime installed for surface=ability (cannot capture continuation binding)");
  }
  return { opState, durability: getActiveCoopOperationDurability() };
}

function state(binding?: CoopAbilityOperationBinding | null): AbilityOpState {
  return binding == null
    ? requireCoopOpSurfaceState<AbilityOpState>("ability")
    : requireCoopOpSurfaceStateFor<AbilityOpState>(binding.opState, "ability");
}

function journalActive(binding?: CoopAbilityOperationBinding | null): boolean {
  return binding == null ? isCoopOperationJournalActive() : isCoopOperationJournalActiveFor(binding.durability);
}

function retainEnvelope(envelope: CoopAuthoritativeEnvelopeV1, binding?: CoopAbilityOperationBinding | null): boolean {
  return binding == null
    ? tryJournalCoopCommittedEnvelope(envelope)
    : tryJournalCoopCommittedEnvelopeFor(binding.durability, envelope);
}

function isCoopOpRuntimeError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("[coop-op]");
}

export function isCoopAbilityOperationEnabled(): boolean {
  return enabled && !isCoopSurfaceCapabilityBlocked(COOP_CAP_OP_ABILITY);
}

/** Whether this phase must consume an authority-owned presentation instead of deriving it locally. */
export function isCoopAbilityPresentationAuthorityActive(binding?: CoopAbilityOperationBinding | null): boolean {
  return isCoopAbilityOperationEnabled() && journalActive(binding);
}

export function setCoopAbilityOperationEnabled(value: boolean): void {
  enabled = value;
}

export function resetCoopAbilityOperationFlag(): void {
  enabled = DEFAULT_ENABLED;
}

export function setCoopAbilityOperationEpoch(value: number): void {
  const s = maybeCoopOpSurfaceState<AbilityOpState>("ability");
  if (s == null || !Number.isSafeInteger(value) || value <= 0 || value === s.epoch) {
    return;
  }
  s.epoch = value;
  resetCoopAbilityOperationState();
}

export function setCoopAbilityOutcomeRetryMs(ms: number): void {
  retryMs = Math.max(1, Math.floor(ms));
}

export function resetCoopAbilityOutcomeRetryMs(): void {
  retryMs = 1_000;
}

export function resetCoopAbilityOperationState(): void {
  const s = maybeCoopOpSurfaceState<AbilityOpState>("ability");
  if (s == null) {
    return;
  }
  resetActiveCoopRuntimeClocks();
  for (const timer of s.retries.values()) {
    clearTimeout(timer);
  }
  s.retries.clear();
  s.pendingMaterializations.clear();
  s.stateAppliedOperations.clear();
  s.settledOperations.clear();
  s.authorityHost = null;
  s.receiverGuest = null;
  s.authorityOrdinalPin = -1;
  s.authorityOrdinal = 0;
  s.watcherOrdinalPin = -1;
  s.watcherOrdinal = 0;
  s.revisionFloor = 0;
}

export function setCoopAbilityOperationRevisionFloor(highWater: number): void {
  const s = maybeCoopOpSurfaceState<AbilityOpState>("ability");
  if (s == null || !Number.isFinite(highWater) || highWater <= 0 || highWater === s.revisionFloor) {
    return;
  }
  s.revisionFloor = highWater;
  s.authorityHost = null;
  s.receiverGuest = null;
}

function host(binding?: CoopAbilityOperationBinding | null): CoopOperationHost {
  const s = state(binding);
  s.authorityHost ??=
    binding == null
      ? CoopOperationHost.forActiveRuntime({ epoch: s.epoch, initialRevision: s.revisionFloor })
      : CoopOperationHost.forRuntime(binding.opState, { epoch: s.epoch, initialRevision: s.revisionFloor });
  return s.authorityHost;
}

function guest(binding?: CoopAbilityOperationBinding | null): CoopOperationGuest {
  const s = state(binding);
  s.receiverGuest ??=
    binding == null
      ? CoopOperationGuest.forActiveRuntime({ epoch: s.epoch, initialRevision: s.revisionFloor })
      : CoopOperationGuest.forRuntime(binding.opState, { epoch: s.epoch, initialRevision: s.revisionFloor });
  return s.receiverGuest;
}

function peekAuthorityOrdinal(s: AbilityOpState, pinned: number): number {
  if (s.authorityOrdinalPin !== pinned) {
    s.authorityOrdinalPin = pinned;
    s.authorityOrdinal = 0;
  }
  return s.authorityOrdinal;
}

function peekWatcherOrdinal(s: AbilityOpState, pinned: number): number {
  if (s.watcherOrdinalPin !== pinned) {
    s.watcherOrdinalPin = pinned;
    s.watcherOrdinal = 0;
  }
  return s.watcherOrdinal;
}

function opId(s: AbilityOpState, pinned: number, ordinal: number): string {
  return makeCoopOperationId(
    s.epoch,
    coopInteractionOwnerSeat(pinned),
    pinned * COOP_ABILITY_ACTION_STRIDE + ordinal,
    "ABILITY_PICK",
  );
}

function presentationOpId(s: AbilityOpState, pinned: number): string {
  return makeCoopOperationId(
    s.epoch,
    coopInteractionOwnerSeat(pinned),
    pinned * COOP_ABILITY_ACTION_STRIDE,
    "ABILITY_PRESENT",
  );
}

function context(wave: number, turn: number) {
  return coopOperationCommitContext(wave, turn, "INTERACTION");
}

/**
 * Authority-owned presentation boundary. Every ability workflow states its exact phase address before input
 * opens; the randomizer additionally carries the literal authority-rolled choices so a guest owner never
 * advances RNG or derives a different menu.
 */
export function commitCoopAbilityPresentation(
  params: {
    readonly pinned: number;
    readonly partyIndex: number;
    readonly workflow: CoopAbilityPresentationPayload["workflow"];
    readonly rolledAbilityIds?: readonly number[] | undefined;
    readonly localRole: CoopRole;
    readonly wave: number;
    readonly turn: number;
  },
  binding?: CoopAbilityOperationBinding | null,
): string | null {
  if (!isCoopAbilityOperationEnabled() || params.localRole !== "host") {
    return null;
  }
  const randomizer = params.workflow === "greater-randomizer";
  if (
    !Number.isSafeInteger(params.pinned)
    || params.pinned < 0
    || !Number.isSafeInteger(params.partyIndex)
    || params.partyIndex < 0
    || (randomizer
      ? !Array.isArray(params.rolledAbilityIds)
        || params.rolledAbilityIds.length !== 4
        || !params.rolledAbilityIds.every(id => Number.isSafeInteger(id) && id > 0)
        || new Set(params.rolledAbilityIds).size !== params.rolledAbilityIds.length
      : params.rolledAbilityIds !== undefined)
  ) {
    return null;
  }
  try {
    const s = state(binding);
    const owner = coopInteractionOwnerSeat(params.pinned);
    const operationId = presentationOpId(s, params.pinned);
    const operation: CoopPendingOperation = {
      id: operationId,
      kind: "ABILITY_PRESENT",
      owner,
      status: "proposed",
      payload: {
        pinned: params.pinned,
        partyIndex: params.partyIndex,
        workflow: params.workflow,
        ...(randomizer ? { rolledAbilityIds: [...(params.rolledAbilityIds ?? [])] } : {}),
      } satisfies CoopAbilityPresentationPayload,
    };
    const result = host(binding).submit(operation, context(params.wave, params.turn), intent =>
      intent.owner === owner ? { ok: true } : { ok: false, reason: "wrong-owner" },
    );
    const acceptedOperation =
      result.kind === "committed" ? result.envelope.pendingOperation : result.kind === "reack" ? result.op : null;
    if (
      (result.kind !== "committed" && result.kind !== "reack")
      || acceptedOperation?.id !== operationId
      || JSON.stringify(acceptedOperation.payload) !== JSON.stringify(operation.payload)
      || !retainEnvelope(result.envelope, binding)
    ) {
      return null;
    }
    return operationId;
  } catch (error) {
    if (isCoopOpRuntimeError(error)) {
      throw error;
    }
    coopWarn("ability", "ability presentation commit threw", error);
    return null;
  }
}

function commit(
  pinned: number,
  data: number[],
  wave: number,
  turn: number,
  binding?: CoopAbilityOperationBinding | null,
  expectedOperationId?: string,
): boolean {
  const s = state(binding);
  const owner = coopInteractionOwnerSeat(pinned);
  const ordinal = peekAuthorityOrdinal(s, pinned);
  const operation: CoopPendingOperation = {
    id: opId(s, pinned, ordinal),
    kind: "ABILITY_PICK",
    owner,
    status: "proposed",
    payload: { data: [...data] } satisfies CoopAbilityPickPayload,
  };
  if (expectedOperationId != null && operation.id !== expectedOperationId) {
    return false;
  }
  const result = host(binding).submit(operation, context(wave, turn), intent =>
    intent.owner === owner ? { ok: true } : { ok: false, reason: "wrong-owner" },
  );
  if (result.kind === "committed") {
    if (!retainEnvelope(result.envelope, binding)) {
      return false;
    }
    s.authorityOrdinal = ordinal + 1;
    return true;
  }
  if (
    result.kind === "reack"
    && result.op.id === operation.id
    && JSON.stringify(result.op.payload) === JSON.stringify(operation.payload)
  ) {
    s.authorityOrdinal = ordinal + 1;
    return true;
  }
  return false;
}

export function commitAbilityOwnerOutcome(
  params: {
    pinned: number;
    data: number[];
    localRole: CoopRole;
    wave: number;
    turn?: number;
  },
  binding?: CoopAbilityOperationBinding | null,
): boolean {
  if (!isCoopAbilityOperationEnabled() || params.localRole !== "host" || params.pinned < 0) {
    return true;
  }
  try {
    if (!commit(params.pinned, params.data, params.wave, params.turn ?? 0, binding)) {
      coopWarn("ability", "ability owner result could not be retained");
      return false;
    }
    return true;
  } catch (error) {
    if (isCoopOpRuntimeError(error)) {
      throw error;
    }
    coopWarn("ability", "ability op commit threw; legacy carrier remains active", error);
    return false;
  }
}

export type CoopAbilityWatcherAdoption =
  | {
      readonly accepted: true;
      /** Complete host image already installed; close/continue the UI but do not execute the ability mutation. */
      readonly projectionApplied: boolean;
      /** Host watcher must execute once, then retain the resulting complete image through the named operation. */
      readonly requiresAuthorityCommit: boolean;
      readonly operationId: string;
    }
  | {
      readonly accepted: false;
      readonly projectionApplied: false;
      readonly requiresAuthorityCommit: false;
      readonly operationId: null;
    };

const REJECTED_ABILITY_ADOPTION: CoopAbilityWatcherAdoption = {
  accepted: false,
  projectionApplied: false,
  requiresAuthorityCommit: false,
  operationId: null,
};

export function adoptAbilityWatcherOutcome(
  params: {
    pinned: number;
    data: number[] | null;
    localRole: CoopRole;
    wave: number;
    turn?: number;
  },
  binding?: CoopAbilityOperationBinding | null,
): CoopAbilityWatcherAdoption {
  if (!isCoopAbilityOperationEnabled()) {
    return params.data == null
      ? REJECTED_ABILITY_ADOPTION
      : {
          accepted: true,
          projectionApplied: false,
          requiresAuthorityCommit: false,
          operationId: "",
        };
  }
  if (params.data == null || params.pinned < 0) {
    return REJECTED_ABILITY_ADOPTION;
  }
  const s = state(binding);
  if (params.localRole === "host") {
    const id = opId(s, params.pinned, peekAuthorityOrdinal(s, params.pinned));
    if (journalActive(binding)) {
      // The raw guest carrier is a proposal only. The host phase executes it exactly once and calls
      // commitAbilityWatcherOutcome afterwards, so the retained image is post-action rather than pre-action.
      return {
        accepted: true,
        projectionApplied: false,
        requiresAuthorityCommit: true,
        operationId: id,
      };
    }
    return commit(params.pinned, params.data, params.wave, params.turn ?? 0, binding, id)
      ? {
          accepted: true,
          projectionApplied: false,
          requiresAuthorityCommit: false,
          operationId: id,
        }
      : REJECTED_ABILITY_ADOPTION;
  }
  const ordinal = peekWatcherOrdinal(s, params.pinned);
  const id = opId(s, params.pinned, ordinal);
  const g = guest(binding);
  // V2 never advances the legacy guest applied-id cursor. This runtime-owned proof is armed only after
  // the complete host image applied, so consume it before consulting legacy deduplication.
  if (s.pendingMaterializations.delete(id)) {
    s.watcherOrdinal++;
    return {
      accepted: true,
      projectionApplied: s.stateAppliedOperations.has(id),
      requiresAuthorityCommit: false,
      operationId: id,
    };
  }
  if (g.hasApplied(id)) {
    return REJECTED_ABILITY_ADOPTION;
  }
  if (journalActive(binding)) {
    return REJECTED_ABILITY_ADOPTION;
  }
  const operation: CoopPendingOperation = {
    id,
    kind: "ABILITY_PICK",
    owner: coopInteractionOwnerSeat(params.pinned),
    status: "applied",
    payload: { data: [...params.data] } satisfies CoopAbilityPickPayload,
  };
  const result = g.applyEnvelope({
    version: 1,
    sessionEpoch: s.epoch,
    revision: g.getLastAppliedRevision() + 1,
    ...context(params.wave, params.turn ?? 0),
    pendingOperation: operation,
  });
  if (result.kind === "applied") {
    s.watcherOrdinal++;
    return {
      accepted: true,
      projectionApplied: false,
      requiresAuthorityCommit: false,
      operationId: id,
    };
  }
  return REJECTED_ABILITY_ADOPTION;
}

/** Host watcher post-action seam: retain the exact immutable result only after the local mutation succeeded. */
export function commitAbilityWatcherOutcome(
  operationId: string,
  params: {
    readonly pinned: number;
    readonly data: number[];
    readonly wave: number;
    readonly turn?: number;
  },
  binding?: CoopAbilityOperationBinding | null,
): boolean {
  if (!isCoopAbilityOperationEnabled() || operationId.length === 0 || params.pinned < 0) {
    return false;
  }
  try {
    return commit(params.pinned, params.data, params.wave, params.turn ?? 0, binding, operationId);
  } catch (error) {
    if (isCoopOpRuntimeError(error)) {
      throw error;
    }
    coopWarn("ability", `ability watcher result commit threw id=${operationId}`, error);
    return false;
  }
}

function retryKey(pinned: number, data: number[]): string {
  return `${pinned}:${JSON.stringify(data)}`;
}

export function armCoopAbilityOutcomeResend(
  pinned: number,
  data: number[],
  resend: () => void,
  binding?: CoopAbilityOperationBinding | null,
): void {
  if (!isCoopAbilityOperationEnabled()) {
    return;
  }
  const s = state(binding);
  const key = retryKey(pinned, data);
  if (s.retries.has(key)) {
    return;
  }
  const tick = () => {
    if (!s.retries.has(key)) {
      return;
    }
    try {
      resend();
    } catch (error) {
      coopWarn("ability", "ability outcome resend threw; retry remains armed", error);
    }
    if (s.retries.has(key)) {
      s.retries.set(key, setTimeout(tick, retryMs));
    }
  };
  s.retries.set(key, setTimeout(tick, retryMs));
}

function cancelRetry(s: AbilityOpState, pinned: number, data: number[]): void {
  const key = retryKey(pinned, data);
  const timer = s.retries.get(key);
  if (timer != null) {
    clearTimeout(timer);
    s.retries.delete(key);
  }
}

export function armCoopAbilityJournalMaterialization(id: string, binding?: CoopAbilityOperationBinding | null): void {
  state(binding).pendingMaterializations.add(id);
}

/** Prove the exact ability result phase ended after consuming the authoritative outcome. */
export function settleCoopAbilityOperation(operationId: string, binding?: CoopAbilityOperationBinding | null): boolean {
  if (operationId.length === 0) {
    return false;
  }
  state(binding).settledOperations.add(operationId);
  return true;
}

/** A guest owner closes before the host commits its proposal; retain that deterministic result address. */
export function settleCoopAbilityOwnerProposal(
  pinned: number,
  binding?: CoopAbilityOperationBinding | null,
): string | null {
  if (pinned < 0) {
    return null;
  }
  const s = state(binding);
  const operationId = opId(s, pinned, peekWatcherOrdinal(s, pinned));
  s.settledOperations.add(operationId);
  return operationId;
}

/**
 * A host-owned picker has already reached its real phase terminal before the authority result is
 * published. Address that result from the authority ordinal (the guest-owner proposal path above uses the
 * watcher ordinal) so Authority V2 can require the exact terminal proof without guessing in the phase.
 */
export function settleCoopAbilityAuthorityResult(
  pinned: number,
  binding?: CoopAbilityOperationBinding | null,
): string | null {
  if (pinned < 0) {
    return null;
  }
  const s = state(binding);
  const operationId = opId(s, pinned, peekAuthorityOrdinal(s, pinned));
  s.settledOperations.add(operationId);
  return operationId;
}

/** Live materializer proof: queue injection alone is not material completion. */
export function isCoopAbilityOperationSettled(
  operationId: string,
  binding?: CoopAbilityOperationBinding | null,
): boolean {
  return state(binding).settledOperations.has(operationId);
}

function applyJournaledAbilityEnvelope(
  envelope: CoopAuthoritativeEnvelopeV1,
  applyContext?: CoopOperationEnvelopeApplyContext,
): CoopApplyOutcome {
  if (!isCoopAbilityOperationEnabled()) {
    return "rejected";
  }
  const operation = envelope.pendingOperation;
  if ((operation?.kind !== "ABILITY_PICK" && operation?.kind !== "ABILITY_PRESENT") || operation.status !== "applied") {
    return "rejected";
  }
  if (operation.kind === "ABILITY_PICK") {
    const payload = operation.payload as CoopAbilityPickPayload | undefined;
    if (payload == null || !Array.isArray(payload.data) || !payload.data.every(Number.isFinite)) {
      return "rejected";
    }
  } else {
    const payload = operation.payload as CoopAbilityPresentationPayload | undefined;
    const randomizer = payload?.workflow === "greater-randomizer";
    if (
      payload == null
      || !Number.isSafeInteger(payload.pinned)
      || payload.pinned < 0
      || !Number.isSafeInteger(payload.partyIndex)
      || payload.partyIndex < 0
      || (payload.workflow !== "capsule"
        && payload.workflow !== "greater-capsule"
        && payload.workflow !== "greater-randomizer")
      || (randomizer
        ? !Array.isArray(payload.rolledAbilityIds)
          || payload.rolledAbilityIds.length !== 4
          || !payload.rolledAbilityIds.every(id => Number.isSafeInteger(id) && id > 0)
          || new Set(payload.rolledAbilityIds).size !== payload.rolledAbilityIds.length
        : payload.rolledAbilityIds !== undefined)
    ) {
      return "rejected";
    }
  }
  const s = state();
  const g = guest();
  if (!isCoopOperationAuthorityV2Apply(applyContext) && g.hasApplied(operation.id)) {
    return "duplicate";
  }
  if (isCoopOperationAuthorityV2Apply(applyContext)) {
    if (!isCompleteCoopOperationAuthorityState(envelope.authoritativeState, envelope.wave, envelope.turn)) {
      return "rejected";
    }
    // The V2 replica applies the immutable state once, centrally, before entering a surface applier. This
    // surface record is projection evidence for the UI adopter; it must not run a second state apply.
    s.stateAppliedOperations.add(operation.id);
  }
  const result = applyCoopOperationEnvelope(g, "op:ability", envelope, applyContext);
  if (result !== "applied") {
    return result;
  }
  const parsed = parseCoopOperationId(operation.id);
  if (operation.kind === "ABILITY_PICK" && parsed != null) {
    const payload = operation.payload as CoopAbilityPickPayload;
    const pinned = Math.floor(parsed.pinnedSeq / COOP_ABILITY_ACTION_STRIDE);
    cancelRetry(s, pinned, payload.data);
  }
  return "applied";
}

registerCoopOperationApplier("op:ability", applyJournaledAbilityEnvelope);
