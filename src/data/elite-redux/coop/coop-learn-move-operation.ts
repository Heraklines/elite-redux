/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { COOP_CAP_OP_LEARN_MOVE, isCoopSurfaceCapabilityBlocked } from "#data/elite-redux/coop/coop-capabilities";
import { coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopApplyOutcome } from "#data/elite-redux/coop/coop-durability";
import type { CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import {
  type CoopAuthoritativeEnvelopeV1,
  type CoopLearnMoveBatchPayload,
  type CoopLearnMovePayload,
  type CoopOperationKind,
  type CoopPendingOperation,
  makeCoopOperationId,
} from "#data/elite-redux/coop/coop-operation-envelope";
import {
  applyCoopOperationEnvelope,
  journalCoopCommittedEnvelope,
  registerCoopOperationApplier,
} from "#data/elite-redux/coop/coop-operation-journal";
import { CoopOperationGuest, CoopOperationHost } from "#data/elite-redux/coop/coop-operation-runtime";
import {
  COOP_LEARN_MOVE_BATCH_FWD_SEQ_BASE,
  COOP_LEARN_MOVE_FWD_SEQ_BASE,
} from "#data/elite-redux/coop/coop-seq-registry";
import { coopSeatOfRole } from "#data/elite-redux/coop/coop-session";
import type { CoopAuthoritativeBattleStateV1, CoopRole } from "#data/elite-redux/coop/coop-transport";

type LearnPayload = CoopLearnMovePayload | CoopLearnMoveBatchPayload;
type LearnDecision =
  | Extract<CoopLearnMovePayload, { type: "decision" }>
  | Extract<CoopLearnMoveBatchPayload, { type: "decision" }>;

const DEFAULT_ENABLED = !(typeof process !== "undefined" && process.env?.COOP_LEARN_MOVE_OP === "off");
let enabled = DEFAULT_ENABLED;
let epoch = 1;
let revisionFloor = 0;
let authorityHost: CoopOperationHost | null = null;
let receiverGuest: CoopOperationGuest | null = null;
let ordinal = 0;
let retryMs = 1_000;
const retries = new Map<string, ReturnType<typeof setTimeout>>();

export function isCoopLearnMoveOperationEnabled(): boolean {
  return enabled && !isCoopSurfaceCapabilityBlocked(COOP_CAP_OP_LEARN_MOVE);
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
  CoopOperationHost.resetGlobalOrder();
  for (const timer of retries.values()) {
    clearTimeout(timer);
  }
  retries.clear();
  authorityHost = null;
  receiverGuest = null;
  revisionFloor = 0;
  ordinal = 0;
}
export function setCoopLearnMoveOperationRevisionFloor(value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value === revisionFloor) {
    return;
  }
  revisionFloor = value;
  authorityHost = null;
  receiverGuest = null;
}
export function setCoopLearnMoveOperationEpoch(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value === epoch) {
    return;
  }
  epoch = value;
  resetCoopLearnMoveOperationState();
}

function host(): CoopOperationHost {
  authorityHost ??= CoopOperationHost.global({ epoch, initialRevision: revisionFloor });
  return authorityHost;
}
function guest(): CoopOperationGuest {
  receiverGuest ??= CoopOperationGuest.global({ epoch, initialRevision: revisionFloor });
  return receiverGuest;
}
function nextAddress(): number {
  return revisionFloor + ++ordinal;
}
function context(wave: number, turn: number) {
  const authoritativeState: CoopAuthoritativeBattleStateV1 = {
    version: 1,
    tick: 0,
    wave,
    turn,
    playerParty: [],
    enemyParty: [],
    field: [],
    weather: 0,
    weatherTurnsLeft: 0,
    terrain: 0,
    terrainTurnsLeft: 0,
    arenaTags: [],
    money: 0,
    pokeballCounts: [],
    playerModifiers: [],
    enemyModifiers: [],
  };
  return { wave, turn, logicalPhase: "TURN_RESOLVE" as const, authoritativeState };
}
function kindOf(payload: LearnPayload): Extract<CoopOperationKind, "LEARN_MOVE" | "LEARN_MOVE_BATCH"> {
  return "moveId" in payload ? "LEARN_MOVE" : "LEARN_MOVE_BATCH";
}
function commit(params: {
  payload: LearnPayload;
  ownerRole: CoopRole;
  localRole: CoopRole;
  wave: number;
  turn: number;
}): void {
  if (!isCoopLearnMoveOperationEnabled() || params.localRole !== "host") {
    return;
  }
  try {
    const owner = coopSeatOfRole(params.ownerRole);
    const operation: CoopPendingOperation = {
      id: makeCoopOperationId(epoch, owner, nextAddress()),
      kind: kindOf(params.payload),
      owner,
      status: "proposed",
      payload: structuredClone(params.payload),
    };
    const result = host().submit(operation, context(params.wave, params.turn), intent =>
      intent.owner === owner ? { ok: true } : { ok: false, reason: "wrong-owner" },
    );
    if (result.kind === "committed") {
      journalCoopCommittedEnvelope(result.envelope);
    }
  } catch (error) {
    coopWarn("learnmove", "learn-move op commit threw; legacy carrier remains active", error);
  }
}

export function sendCoopLearnMovePrompt(
  relay: CoopInteractionRelay,
  payload: Extract<CoopLearnMovePayload, { type: "prompt" }>,
  params: { localRole: CoopRole; wave: number; turn: number },
): void {
  commit({ payload, ownerRole: "guest", ...params });
  relay.sendInteractionOutcome(COOP_LEARN_MOVE_FWD_SEQ_BASE + payload.partySlot, "learnMoveForward", {
    k: "learnMoveForward",
    ...payload,
  });
}
export function sendCoopLearnMoveBatchPrompt(
  relay: CoopInteractionRelay,
  payload: Extract<CoopLearnMoveBatchPayload, { type: "prompt" }>,
  params: { localRole: CoopRole; wave: number; turn: number },
): void {
  commit({ payload, ownerRole: payload.ownerIsGuest ? "guest" : "host", ...params });
  relay.sendInteractionOutcome(COOP_LEARN_MOVE_BATCH_FWD_SEQ_BASE + payload.partySlot, "learnMoveBatchForward", {
    k: "learnMoveBatchForward",
    partySlot: payload.partySlot,
    learnableIds: [...payload.learnableIds],
    ownerIsGuest: payload.ownerIsGuest,
  });
}
export function commitCoopLearnMoveDecision(params: {
  payload: Extract<CoopLearnMovePayload, { type: "decision" }>;
  ownerRole: CoopRole;
  localRole: CoopRole;
  wave: number;
  turn: number;
}): void {
  commit(params);
}
export function commitCoopLearnMoveBatchDecision(params: {
  payload: Extract<CoopLearnMoveBatchPayload, { type: "decision" }>;
  ownerRole: CoopRole;
  localRole: CoopRole;
  wave: number;
  turn: number;
}): void {
  commit(params);
}

function retryKey(payload: LearnDecision): string {
  return `${kindOf(payload)}:${payload.partySlot}:${JSON.stringify(payload)}`;
}
function arm(payload: LearnDecision, _wave: number, _turn: number, resend: () => void): void {
  if (!isCoopLearnMoveOperationEnabled()) {
    return;
  }
  const key = retryKey(payload);
  if (retries.has(key)) {
    return;
  }
  const tick = () => {
    if (!retries.has(key)) {
      return;
    }
    try {
      resend();
    } catch (error) {
      coopWarn("learnmove", "learn-move intent resend threw", error);
    }
    if (retries.has(key)) {
      retries.set(key, setTimeout(tick, retryMs));
    }
  };
  retries.set(key, setTimeout(tick, retryMs));
}
export function armCoopLearnMoveIntentResend(params: {
  payload: Extract<CoopLearnMovePayload, { type: "decision" }>;
  wave: number;
  turn: number;
  resend: () => void;
}): void {
  arm(params.payload, params.wave, params.turn, params.resend);
}
export function armCoopLearnMoveBatchIntentResend(params: {
  payload: Extract<CoopLearnMoveBatchPayload, { type: "decision" }>;
  wave: number;
  turn: number;
  resend: () => void;
}): void {
  arm(params.payload, params.wave, params.turn, params.resend);
}
function cancel(payload: LearnDecision, _wave: number, _turn: number): void {
  const key = retryKey(payload);
  const timer = retries.get(key);
  if (timer != null) {
    clearTimeout(timer);
    retries.delete(key);
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
function applyEnvelope(envelope: CoopAuthoritativeEnvelopeV1): CoopApplyOutcome {
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
  const g = guest();
  if (g.hasApplied(op.id)) {
    return "duplicate";
  }
  if (applyCoopOperationEnvelope(g, "op:learnMove", envelope) !== "applied") {
    return "rejected";
  }
  if (op.payload.type === "decision") {
    cancel(op.payload, envelope.wave, envelope.turn);
  }
  return "applied";
}
registerCoopOperationApplier("op:learnMove", applyEnvelope);
