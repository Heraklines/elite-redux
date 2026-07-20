/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { isCoopV2InteractionCutoverActive } from "#data/elite-redux/coop/authority-v2/cutover-interaction";
import { COOP_CAP_OP_LEARN_MOVE, isCoopSurfaceCapabilityBlocked } from "#data/elite-redux/coop/coop-capabilities";
import { coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopApplyOutcome, CoopDurabilityManager } from "#data/elite-redux/coop/coop-durability";
import type { CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import {
  type CoopAuthoritativeEnvelopeV1,
  type CoopLearnMoveBatchPayload,
  type CoopLearnMovePayload,
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
import {
  COOP_LEARN_MOVE_BATCH_FWD_SEQ_BASE,
  COOP_LEARN_MOVE_FWD_SEQ_BASE,
} from "#data/elite-redux/coop/coop-seq-registry";
import { coopSeatOfRole } from "#data/elite-redux/coop/coop-session";
import type { CoopRole } from "#data/elite-redux/coop/coop-transport";

type LearnPayload = CoopLearnMovePayload | CoopLearnMoveBatchPayload;
type LearnDecision =
  | Extract<CoopLearnMovePayload, { type: "decision" }>
  | Extract<CoopLearnMoveBatchPayload, { type: "decision" }>;

const DEFAULT_ENABLED = !(typeof process !== "undefined" && process.env?.COOP_LEARN_MOVE_OP === "off");
let enabled = DEFAULT_ENABLED;
let retryMs = 1_000;

/** Every mutable learn-move operation cell belongs to exactly one assembled co-op runtime. */
interface LearnMoveOpState {
  epoch: number;
  revisionFloor: number;
  authorityHost: CoopOperationHost | null;
  receiverGuest: CoopOperationGuest | null;
  ordinal: number;
  readonly retries: Map<string, ReturnType<typeof setTimeout>>;
}

registerCoopOpSurfaceState(
  "learnMove",
  (): LearnMoveOpState => ({
    epoch: 1,
    revisionFloor: 0,
    authorityHost: null,
    receiverGuest: null,
    ordinal: 0,
    retries: new Map(),
  }),
);

/** Stable runtime selectors captured before a picker callback, await, timer, or phase tail can resume. */
export interface CoopLearnMoveOperationBinding {
  readonly opState: CoopRuntimeOpState;
  readonly durability: CoopDurabilityManager | null;
}

/** Capture the scheduling client; missing or wrong-role bindings are programming errors, never fallbacks. */
export function captureCoopLearnMoveOperationBinding(expectedRole?: CoopRole): CoopLearnMoveOperationBinding {
  const opState = getActiveCoopRuntimeOpState();
  if (opState == null) {
    throw new Error("[coop-op] no runtime installed for surface=learnMove (cannot capture continuation binding)");
  }
  if (expectedRole != null && opState.localRole != null && opState.localRole !== expectedRole) {
    throw new Error(
      `[coop-op] surface=learnMove binding role=${opState.localRole} cannot execute localRole=${expectedRole}`,
    );
  }
  return { opState, durability: getActiveCoopOperationDurability() };
}

function state(binding?: CoopLearnMoveOperationBinding | null): LearnMoveOpState {
  return binding == null
    ? requireCoopOpSurfaceState<LearnMoveOpState>("learnMove")
    : requireCoopOpSurfaceStateFor<LearnMoveOpState>(binding.opState, "learnMove");
}

function retainEnvelope(
  envelope: CoopAuthoritativeEnvelopeV1,
  binding?: CoopLearnMoveOperationBinding | null,
): boolean {
  return binding == null
    ? tryJournalCoopCommittedEnvelope(envelope)
    : tryJournalCoopCommittedEnvelopeFor(binding.durability, envelope);
}

function assertBindingRole(binding: CoopLearnMoveOperationBinding | null | undefined, role: CoopRole): void {
  const opState = binding?.opState ?? getActiveCoopRuntimeOpState();
  if (opState == null) {
    throw new Error("[coop-op] no runtime installed for surface=learnMove (cannot validate local role)");
  }
  if (opState.localRole != null && opState.localRole !== role) {
    throw new Error(`[coop-op] surface=learnMove binding role=${opState.localRole} cannot execute localRole=${role}`);
  }
}

function isCoopOpRuntimeError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("[coop-op]");
}

export function isCoopLearnMoveOperationEnabled(): boolean {
  return enabled && !isCoopSurfaceCapabilityBlocked(COOP_CAP_OP_LEARN_MOVE);
}

/** Whether this exact runtime has retired the legacy learn-move result authority. */
export function isCoopLearnMoveAuthorityV2Active(binding?: CoopLearnMoveOperationBinding | null): boolean {
  return isCoopV2InteractionCutoverActive(binding?.durability);
}
export function setCoopLearnMoveOperationEnabled(value: boolean): void {
  enabled = value;
}
export function resetCoopLearnMoveOperationFlag(): void {
  enabled = DEFAULT_ENABLED;
}
export function setCoopLearnMoveRetryMs(ms: number): void {
  retryMs = Math.max(1, Math.floor(ms));
}
export function resetCoopLearnMoveRetryMs(): void {
  retryMs = 1_000;
}
export function resetCoopLearnMoveOperationState(): void {
  const s = maybeCoopOpSurfaceState<LearnMoveOpState>("learnMove");
  if (s == null) {
    return;
  }
  resetActiveCoopRuntimeClocks();
  for (const timer of s.retries.values()) {
    clearTimeout(timer);
  }
  s.retries.clear();
  s.authorityHost = null;
  s.receiverGuest = null;
  s.revisionFloor = 0;
  s.ordinal = 0;
}
export function setCoopLearnMoveOperationRevisionFloor(value: number): void {
  const s = maybeCoopOpSurfaceState<LearnMoveOpState>("learnMove");
  if (s == null || !Number.isFinite(value) || value <= 0 || value === s.revisionFloor) {
    return;
  }
  s.revisionFloor = value;
  s.ordinal = 0;
  s.authorityHost = null;
  s.receiverGuest = null;
}
export function setCoopLearnMoveOperationEpoch(value: number): void {
  const s = maybeCoopOpSurfaceState<LearnMoveOpState>("learnMove");
  if (s == null || !Number.isSafeInteger(value) || value <= 0 || value === s.epoch) {
    return;
  }
  s.epoch = value;
  resetCoopLearnMoveOperationState();
}

function host(binding?: CoopLearnMoveOperationBinding | null): CoopOperationHost {
  const s = state(binding);
  s.authorityHost ??=
    binding == null
      ? CoopOperationHost.forActiveRuntime({ epoch: s.epoch, initialRevision: s.revisionFloor })
      : CoopOperationHost.forRuntime(binding.opState, { epoch: s.epoch, initialRevision: s.revisionFloor });
  return s.authorityHost;
}
function guest(binding?: CoopLearnMoveOperationBinding | null): CoopOperationGuest {
  const s = state(binding);
  s.receiverGuest ??=
    binding == null
      ? CoopOperationGuest.forActiveRuntime({ epoch: s.epoch, initialRevision: s.revisionFloor })
      : CoopOperationGuest.forRuntime(binding.opState, { epoch: s.epoch, initialRevision: s.revisionFloor });
  return s.receiverGuest;
}
function nextAddress(s: LearnMoveOpState): number {
  return s.revisionFloor + ++s.ordinal;
}
function context(wave: number, turn: number) {
  return coopOperationCommitContext(wave, turn, "TURN_RESOLVE");
}
function kindOf(payload: LearnPayload): Extract<CoopOperationKind, "LEARN_MOVE" | "LEARN_MOVE_BATCH"> {
  return "moveId" in payload ? "LEARN_MOVE" : "LEARN_MOVE_BATCH";
}
function commit(
  params: {
    payload: LearnPayload;
    ownerRole: CoopRole;
    localRole: CoopRole;
    wave: number;
    turn: number;
    operationId?: string;
  },
  binding?: CoopLearnMoveOperationBinding | null,
): string | null {
  if (!isCoopLearnMoveOperationEnabled()) {
    return "legacy";
  }
  assertBindingRole(binding, params.localRole);
  if (params.localRole !== "host") {
    return null;
  }
  try {
    const s = state(binding);
    const owner = coopSeatOfRole(params.ownerRole);
    const operationKind = kindOf(params.payload);
    const suppliedAddress = params.operationId == null ? null : parseCoopOperationId(params.operationId);
    if (
      params.operationId != null
      && (suppliedAddress == null
        || suppliedAddress.epoch !== s.epoch
        || suppliedAddress.owner !== owner
        || suppliedAddress.kind !== operationKind
        || suppliedAddress.pinnedSeq <= s.revisionFloor)
    ) {
      return null;
    }
    if (suppliedAddress != null) {
      s.ordinal = Math.max(s.ordinal, suppliedAddress.pinnedSeq - s.revisionFloor);
    }
    const operation: CoopPendingOperation = {
      id: params.operationId ?? makeCoopOperationId(s.epoch, owner, nextAddress(s), operationKind),
      kind: operationKind,
      owner,
      status: "proposed",
      payload: structuredClone(params.payload),
    };
    const result = host(binding).submit(operation, context(params.wave, params.turn), intent =>
      intent.owner === owner ? { ok: true } : { ok: false, reason: "wrong-owner" },
    );
    if (result.kind !== "committed" && result.kind !== "reack") {
      return null;
    }
    if (!retainEnvelope(result.envelope, binding)) {
      coopWarn(
        "learnmove",
        `learn-move op could not retain rev=${result.envelope.revision} id=${operation.id}; refusing raw continuation`,
      );
      return null;
    }
    return operation.id;
  } catch (error) {
    if (isCoopOpRuntimeError(error)) {
      throw error;
    }
    coopWarn("learnmove", "learn-move op commit threw; refusing the unretained continuation", error);
    return null;
  }
}

/** A decision is the immediate exact successor to its presentation on this serialized surface. */
export function coopLearnMoveDecisionOperationId(presentationOperationId: string): string | null {
  const parsed = parseCoopOperationId(presentationOperationId);
  if (parsed == null || (parsed.kind !== "LEARN_MOVE" && parsed.kind !== "LEARN_MOVE_BATCH")) {
    return null;
  }
  return makeCoopOperationId(parsed.epoch, parsed.owner, parsed.pinnedSeq + 1, parsed.kind);
}

export function commitCoopLearnMovePrompt(
  payload: Extract<CoopLearnMovePayload, { type: "prompt" }>,
  params: { ownerRole: CoopRole; localRole: CoopRole; wave: number; turn: number },
  binding?: CoopLearnMoveOperationBinding | null,
): string | null {
  return commit({ payload, ...params }, binding);
}

export function sendCoopLearnMovePromptWithOperationId(
  relay: CoopInteractionRelay,
  payload: Extract<CoopLearnMovePayload, { type: "prompt" }>,
  params: { localRole: CoopRole; wave: number; turn: number },
  binding?: CoopLearnMoveOperationBinding | null,
): string | null {
  const operationId = commit({ payload, ownerRole: "guest", ...params }, binding);
  if (operationId == null) {
    return null;
  }
  relay.sendInteractionOutcome(COOP_LEARN_MOVE_FWD_SEQ_BASE + payload.partySlot, "learnMoveForward", {
    k: "learnMoveForward",
    ...payload,
  });
  return operationId;
}
export function sendCoopLearnMovePrompt(
  relay: CoopInteractionRelay,
  payload: Extract<CoopLearnMovePayload, { type: "prompt" }>,
  params: { localRole: CoopRole; wave: number; turn: number },
  binding?: CoopLearnMoveOperationBinding | null,
): boolean {
  return sendCoopLearnMovePromptWithOperationId(relay, payload, params, binding) != null;
}
export function sendCoopLearnMoveBatchPromptWithOperationId(
  relay: CoopInteractionRelay,
  payload: Extract<CoopLearnMoveBatchPayload, { type: "prompt" }>,
  params: { localRole: CoopRole; wave: number; turn: number },
  binding?: CoopLearnMoveOperationBinding | null,
): string | null {
  const operationId = commit({ payload, ownerRole: payload.ownerIsGuest ? "guest" : "host", ...params }, binding);
  if (operationId == null) {
    return null;
  }
  relay.sendInteractionOutcome(COOP_LEARN_MOVE_BATCH_FWD_SEQ_BASE + payload.partySlot, "learnMoveBatchForward", {
    k: "learnMoveBatchForward",
    partySlot: payload.partySlot,
    learnableIds: [...payload.learnableIds],
    ownerIsGuest: payload.ownerIsGuest,
  });
  return operationId;
}
export function sendCoopLearnMoveBatchPrompt(
  relay: CoopInteractionRelay,
  payload: Extract<CoopLearnMoveBatchPayload, { type: "prompt" }>,
  params: { localRole: CoopRole; wave: number; turn: number },
  binding?: CoopLearnMoveOperationBinding | null,
): boolean {
  return sendCoopLearnMoveBatchPromptWithOperationId(relay, payload, params, binding) != null;
}
export function commitCoopLearnMoveDecision(
  params: {
    payload: Extract<CoopLearnMovePayload, { type: "decision" }>;
    ownerRole: CoopRole;
    localRole: CoopRole;
    wave: number;
    turn: number;
    operationId?: string;
  },
  binding?: CoopLearnMoveOperationBinding | null,
): boolean {
  return commit(params, binding) != null;
}
export function commitCoopLearnMoveBatchDecision(
  params: {
    payload: Extract<CoopLearnMoveBatchPayload, { type: "decision" }>;
    ownerRole: CoopRole;
    localRole: CoopRole;
    wave: number;
    turn: number;
    operationId?: string;
  },
  binding?: CoopLearnMoveOperationBinding | null,
): boolean {
  return commit(params, binding) != null;
}

function retryKey(payload: LearnDecision): string {
  return `${kindOf(payload)}:${payload.partySlot}:${JSON.stringify(payload)}`;
}
function arm(
  payload: LearnDecision,
  _wave: number,
  _turn: number,
  resend: () => void,
  binding?: CoopLearnMoveOperationBinding | null,
): void {
  if (!isCoopLearnMoveOperationEnabled()) {
    return;
  }
  assertBindingRole(binding, "guest");
  const s = state(binding);
  const key = retryKey(payload);
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
      coopWarn("learnmove", "learn-move intent resend threw", error);
    }
    if (s.retries.has(key)) {
      s.retries.set(key, setTimeout(tick, retryMs));
    }
  };
  s.retries.set(key, setTimeout(tick, retryMs));
}
export function armCoopLearnMoveIntentResend(
  params: {
    payload: Extract<CoopLearnMovePayload, { type: "decision" }>;
    wave: number;
    turn: number;
    resend: () => void;
  },
  binding?: CoopLearnMoveOperationBinding | null,
): void {
  arm(params.payload, params.wave, params.turn, params.resend, binding);
}
export function armCoopLearnMoveBatchIntentResend(
  params: {
    payload: Extract<CoopLearnMoveBatchPayload, { type: "decision" }>;
    wave: number;
    turn: number;
    resend: () => void;
  },
  binding?: CoopLearnMoveOperationBinding | null,
): void {
  arm(params.payload, params.wave, params.turn, params.resend, binding);
}
function cancel(s: LearnMoveOpState, payload: LearnDecision, _wave: number, _turn: number): void {
  const key = retryKey(payload);
  const timer = s.retries.get(key);
  if (timer != null) {
    clearTimeout(timer);
    s.retries.delete(key);
  }
}

function valid(value: unknown, kind: CoopOperationKind): value is LearnPayload {
  const p = value as LearnPayload | undefined;
  if (p == null || !Number.isSafeInteger(p.partySlot) || p.partySlot < 0 || p.partySlot >= 6) {
    return false;
  }
  if (kind === "LEARN_MOVE") {
    const m = p as CoopLearnMovePayload;
    return Number.isSafeInteger(m.moveId) && m.moveId > 0 && Number.isSafeInteger(m.maxMoveCount);
  }
  const b = p as CoopLearnMoveBatchPayload;
  return b.type === "prompt"
    ? Array.isArray(b.learnableIds) && b.learnableIds.every(Number.isSafeInteger) && typeof b.ownerIsGuest === "boolean"
    : Array.isArray(b.assignments)
        && b.assignments.every(pair => pair.length === 2 && pair.every(Number.isSafeInteger))
        && typeof b.fallback === "boolean";
}
function applyEnvelope(
  envelope: CoopAuthoritativeEnvelopeV1,
  applyContext?: CoopOperationEnvelopeApplyContext,
): CoopApplyOutcome {
  if (!isCoopLearnMoveOperationEnabled()) {
    return "rejected";
  }
  const op = envelope.pendingOperation;
  if ((op?.kind !== "LEARN_MOVE" && op?.kind !== "LEARN_MOVE_BATCH") || op.status !== "applied") {
    return "rejected";
  }
  if (!valid(op.payload, op.kind)) {
    return "rejected";
  }
  const s = state();
  const g = guest();
  if (!isCoopOperationAuthorityV2Apply(applyContext) && g.hasApplied(op.id)) {
    return "duplicate";
  }
  const learnMoveApply = applyCoopOperationEnvelope(g, "op:learnMove", envelope, applyContext);
  if (learnMoveApply !== "applied") {
    return learnMoveApply;
  }
  if (op.payload.type === "decision") {
    cancel(s, op.payload, envelope.wave, envelope.turn);
  }
  return "applied";
}
registerCoopOperationApplier("op:learnMove", applyEnvelope);
