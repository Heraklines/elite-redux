/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { COOP_CAP_OP_REVIVAL, isCoopSurfaceCapabilityBlocked } from "#data/elite-redux/coop/coop-capabilities";
import { coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopApplyOutcome } from "#data/elite-redux/coop/coop-durability";
import type { CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import {
  type CoopAuthoritativeEnvelopeV1,
  type CoopPendingOperation,
  type CoopRevivalPayload,
  makeCoopOperationId,
} from "#data/elite-redux/coop/coop-operation-envelope";
import {
  applyCoopOperationEnvelope,
  journalCoopCommittedEnvelope,
  registerCoopOperationApplier,
} from "#data/elite-redux/coop/coop-operation-journal";
import { CoopOperationGuest, CoopOperationHost } from "#data/elite-redux/coop/coop-operation-runtime";
import { coopSeatOfRole } from "#data/elite-redux/coop/coop-session";
import type { CoopAuthoritativeBattleStateV1, CoopRole } from "#data/elite-redux/coop/coop-transport";

const DEFAULT_ENABLED = !(typeof process !== "undefined" && process.env?.COOP_REVIVAL_OP === "off");
const WAVE_STRIDE = 1_000_000;
const TURN_STRIDE = 100;
const FIELD_STRIDE = 10;

let enabled = DEFAULT_ENABLED;
let epoch = 1;
let revisionFloor = 0;
let authorityHost: CoopOperationHost | null = null;
let receiverGuest: CoopOperationGuest | null = null;
let retryMs = 1_000;
const retries = new Map<string, ReturnType<typeof setTimeout>>();

export function isCoopRevivalOperationEnabled(): boolean {
  return enabled && !isCoopSurfaceCapabilityBlocked(COOP_CAP_OP_REVIVAL);
}

export function setCoopRevivalOperationEnabled(value: boolean): void {
  enabled = value;
}

export function resetCoopRevivalOperationFlag(): void {
  enabled = DEFAULT_ENABLED;
}

export function setCoopRevivalRetryMs(ms: number): void {
  retryMs = Math.max(1, Math.floor(ms));
}

export function resetCoopRevivalRetryMs(): void {
  retryMs = 1_000;
}

export function resetCoopRevivalOperationState(): void {
  CoopOperationHost.resetGlobalOrder();
  for (const timer of retries.values()) {
    clearTimeout(timer);
  }
  retries.clear();
  authorityHost = null;
  receiverGuest = null;
  revisionFloor = 0;
}

export function setCoopRevivalOperationRevisionFloor(highWater: number): void {
  if (!Number.isFinite(highWater) || highWater <= 0 || highWater === revisionFloor) {
    return;
  }
  revisionFloor = highWater;
  authorityHost = null;
  receiverGuest = null;
}

export function setCoopRevivalOperationEpoch(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value === epoch) {
    return;
  }
  epoch = value;
  resetCoopRevivalOperationState();
}

function eventAddress(wave: number, turn: number, fieldIndex: number): number {
  return (
    Math.max(0, Math.trunc(wave)) * WAVE_STRIDE
    + Math.max(0, Math.trunc(turn)) * TURN_STRIDE
    + Math.max(0, Math.trunc(fieldIndex)) * FIELD_STRIDE
  );
}

function actionAddress(payload: CoopRevivalPayload, wave: number, turn: number): number {
  const base = eventAddress(wave, turn, payload.fieldIndex);
  return payload.type === "prompt" ? base : base + Math.max(1, Math.trunc(payload.partySlot) + 1);
}

function host(): CoopOperationHost {
  authorityHost ??= CoopOperationHost.global({ epoch, initialRevision: revisionFloor });
  return authorityHost;
}

function guest(): CoopOperationGuest {
  receiverGuest ??= CoopOperationGuest.global({ epoch, initialRevision: revisionFloor });
  return receiverGuest;
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

function commitAction(params: {
  payload: CoopRevivalPayload;
  ownerRole: CoopRole;
  localRole: CoopRole;
  wave: number;
  turn: number;
}): string | undefined {
  if (!isCoopRevivalOperationEnabled() || params.localRole !== "host") {
    return;
  }
  try {
    const owner = coopSeatOfRole(params.ownerRole);
    const operation: CoopPendingOperation = {
      id: makeCoopOperationId(epoch, owner, actionAddress(params.payload, params.wave, params.turn)),
      kind: "REVIVAL",
      owner,
      status: "proposed",
      payload: { ...params.payload },
    };
    const result = host().submit(operation, context(params.wave, params.turn), intent =>
      intent.owner === owner ? { ok: true } : { ok: false, reason: "wrong-owner" },
    );
    if (result.kind === "committed") {
      journalCoopCommittedEnvelope(result.envelope);
      return result.envelope.pendingOperation?.id;
    }
  } catch (error) {
    coopWarn("replay", "revival op commit threw; legacy carrier/fallback remains active", error);
  }
  return;
}

/** Journal the prompt first, then send the low-latency legacy carrier. */
export function sendCoopRevivalPrompt(
  relay: CoopInteractionRelay,
  fieldIndex: number,
  params: { localRole: CoopRole; wave: number; turn: number },
): void {
  const operationId = commitAction({
    payload: { type: "prompt", fieldIndex },
    ownerRole: "guest",
    ...params,
  });
  relay.promptRevival(fieldIndex, operationId);
}

export function commitRevivalAuthorityDecision(params: {
  payload: Extract<CoopRevivalPayload, { type: "decision" }>;
  ownerRole: CoopRole;
  localRole: CoopRole;
  wave: number;
  turn: number;
}): void {
  commitAction(params);
}

function retryKey(payload: Extract<CoopRevivalPayload, { type: "decision" }>, wave: number, turn: number): string {
  return String(eventAddress(wave, turn, payload.fieldIndex));
}

export function armCoopRevivalIntentResend(params: {
  payload: Extract<CoopRevivalPayload, { type: "decision" }>;
  wave: number;
  turn: number;
  resend: () => void;
}): void {
  if (!isCoopRevivalOperationEnabled()) {
    return;
  }
  const key = retryKey(params.payload, params.wave, params.turn);
  if (retries.has(key)) {
    return;
  }
  const tick = () => {
    if (!retries.has(key)) {
      return;
    }
    try {
      params.resend();
    } catch (error) {
      coopWarn("replay", "revival intent resend threw; retry remains armed", error);
    }
    if (retries.has(key)) {
      retries.set(key, setTimeout(tick, retryMs));
    }
  };
  retries.set(key, setTimeout(tick, retryMs));
}

function cancelRetry(payload: Extract<CoopRevivalPayload, { type: "decision" }>, wave: number, turn: number): void {
  const key = retryKey(payload, wave, turn);
  const timer = retries.get(key);
  if (timer != null) {
    clearTimeout(timer);
    retries.delete(key);
  }
}

function validPayload(value: unknown): value is CoopRevivalPayload {
  const payload = value as CoopRevivalPayload | undefined;
  if (
    payload == null
    || !Number.isSafeInteger(payload.fieldIndex)
    || payload.fieldIndex < 0
    || payload.fieldIndex >= 4
  ) {
    return false;
  }
  return (
    payload.type === "prompt"
    || (payload.type === "decision"
      && Number.isSafeInteger(payload.partySlot)
      && payload.partySlot >= 0
      && payload.partySlot < 6
      && Number.isSafeInteger(payload.speciesId)
      && payload.speciesId > 0)
  );
}

function applyJournaledRevivalEnvelope(envelope: CoopAuthoritativeEnvelopeV1): CoopApplyOutcome {
  if (!isCoopRevivalOperationEnabled()) {
    return "rejected";
  }
  const operation = envelope.pendingOperation;
  if (operation?.kind !== "REVIVAL" || operation.status !== "applied") {
    return "rejected";
  }
  if (!validPayload(operation.payload)) {
    return "rejected";
  }
  const g = guest();
  if (g.hasApplied(operation.id)) {
    return "duplicate";
  }
  const result = applyCoopOperationEnvelope(g, "op:revival", envelope);
  if (result.kind !== "applied") {
    return "rejected";
  }
  if (operation.payload.type !== "prompt") {
    cancelRetry(operation.payload, envelope.wave, envelope.turn);
  }
  return "applied";
}

registerCoopOperationApplier("op:revival", applyJournaledRevivalEnvelope);
