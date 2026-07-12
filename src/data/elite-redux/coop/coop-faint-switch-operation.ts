/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { COOP_CAP_OP_FAINT_SWITCH, isCoopSurfaceCapabilityBlocked } from "#data/elite-redux/coop/coop-capabilities";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopApplyOutcome } from "#data/elite-redux/coop/coop-durability";
import {
  type CoopAuthoritativeEnvelopeV1,
  type CoopFaintSwitchPayload,
  type CoopPendingOperation,
  makeCoopOperationId,
} from "#data/elite-redux/coop/coop-operation-envelope";
import {
  journalCoopCommittedEnvelope,
  registerCoopOperationApplier,
  routeCoopOperationToLiveSink,
} from "#data/elite-redux/coop/coop-operation-journal";
import { CoopOperationGuest, CoopOperationHost } from "#data/elite-redux/coop/coop-operation-runtime";
import { coopSeatOfRole } from "#data/elite-redux/coop/coop-session";
import type { CoopAuthoritativeBattleStateV1, CoopRole } from "#data/elite-redux/coop/coop-transport";

const DEFAULT_ENABLED = !(typeof process !== "undefined" && process.env?.COOP_FAINT_SWITCH_OP === "off");
const COOP_FAINT_SWITCH_WAVE_STRIDE = 1_000_000;
const COOP_FAINT_SWITCH_TURN_STRIDE = 100;
const COOP_FAINT_SWITCH_FIELD_STRIDE = 10;

let enabled = DEFAULT_ENABLED;
let epoch = 1;
let revisionFloor = 0;
let authorityHost: CoopOperationHost | null = null;
let receiverGuest: CoopOperationGuest | null = null;
let retryMs = 1_000;
const retries = new Map<string, ReturnType<typeof setTimeout>>();

export function isCoopFaintSwitchOperationEnabled(): boolean {
  return enabled && !isCoopSurfaceCapabilityBlocked(COOP_CAP_OP_FAINT_SWITCH);
}

export function setCoopFaintSwitchOperationEnabled(value: boolean): void {
  enabled = value;
}

export function resetCoopFaintSwitchOperationFlag(): void {
  enabled = DEFAULT_ENABLED;
}

export function setCoopFaintSwitchRetryMs(ms: number): void {
  retryMs = Math.max(1, Math.floor(ms));
}

export function resetCoopFaintSwitchRetryMs(): void {
  retryMs = 1_000;
}

export function resetCoopFaintSwitchOperationState(): void {
  CoopOperationHost.resetGlobalOrder();
  for (const timer of retries.values()) {
    clearTimeout(timer);
  }
  retries.clear();
  authorityHost = null;
  receiverGuest = null;
  revisionFloor = 0;
}

export function setCoopFaintSwitchOperationRevisionFloor(highWater: number): void {
  if (!Number.isFinite(highWater) || highWater <= 0 || highWater === revisionFloor) {
    return;
  }
  revisionFloor = highWater;
  authorityHost = null;
  receiverGuest = null;
}

export function setCoopFaintSwitchOperationEpoch(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value === epoch) {
    return;
  }
  epoch = value;
  resetCoopFaintSwitchOperationState();
}

function coopFaintSwitchEventAddress(wave: number, turn: number, fieldIndex: number): number {
  return (
    Math.max(0, Math.trunc(wave)) * COOP_FAINT_SWITCH_WAVE_STRIDE
    + Math.max(0, Math.trunc(turn)) * COOP_FAINT_SWITCH_TURN_STRIDE
    + Math.max(0, Math.trunc(fieldIndex)) * COOP_FAINT_SWITCH_FIELD_STRIDE
  );
}

export function coopFaintSwitchOperationAddress(
  wave: number,
  turn: number,
  fieldIndex: number,
  partySlot: number,
): number {
  return coopFaintSwitchEventAddress(wave, turn, fieldIndex) + Math.max(0, Math.trunc(partySlot) + 1);
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

function retryKey(payload: CoopFaintSwitchPayload, wave: number, turn: number): string {
  return `${payload.fieldIndex}:${coopFaintSwitchEventAddress(wave, turn, payload.fieldIndex)}`;
}

function cancelRetry(payload: CoopFaintSwitchPayload): void {
  // The legacy carrier is addressed by owned field slot, while the peers may
  // temporarily observe its wave/turn from different checkpoint revisions. A
  // commit must therefore terminate retries by the stable shared identity.
  // Replacements for the same field cannot legitimately overlap.
  const fieldPrefix = `${payload.fieldIndex}:`;
  let cancelled = 0;
  for (const [key, timer] of retries) {
    if (key.startsWith(fieldPrefix)) {
      clearTimeout(timer);
      retries.delete(key);
      cancelled++;
    }
  }
  if (cancelled > 0) {
    coopLog(
      "replay",
      `faint-switch authority APPLIED field=${payload.fieldIndex} -> cancelled ${cancelled} intent retry timer(s)`,
    );
  }
}

export function armCoopFaintSwitchIntentResend(params: {
  payload: CoopFaintSwitchPayload;
  wave: number;
  turn: number;
  resend: () => void;
}): void {
  if (!isCoopFaintSwitchOperationEnabled()) {
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
      coopWarn("replay", "faint-switch intent resend threw; retry remains armed", error);
    }
    if (retries.has(key)) {
      retries.set(key, setTimeout(tick, retryMs));
    }
  };
  retries.set(key, setTimeout(tick, retryMs));
}

export function commitFaintSwitchAuthorityIntent(params: {
  payload: CoopFaintSwitchPayload;
  ownerRole: CoopRole;
  localRole: CoopRole;
  wave: number;
  turn: number;
}): void {
  if (!isCoopFaintSwitchOperationEnabled() || params.localRole !== "host") {
    return;
  }
  try {
    const owner = coopSeatOfRole(params.ownerRole);
    const operation: CoopPendingOperation = {
      id: makeCoopOperationId(
        epoch,
        owner,
        coopFaintSwitchOperationAddress(params.wave, params.turn, params.payload.fieldIndex, params.payload.partySlot),
      ),
      kind: "FAINT_SWITCH",
      owner,
      status: "proposed",
      payload: { ...params.payload, data: [...params.payload.data] },
    };
    const result = host().submit(operation, context(params.wave, params.turn), intent =>
      intent.owner === owner ? { ok: true } : { ok: false, reason: "wrong-owner" },
    );
    if (result.kind === "committed") {
      journalCoopCommittedEnvelope(result.envelope);
    }
  } catch (error) {
    coopWarn("replay", "faint-switch op commit threw; legacy carrier/fallback remains active", error);
  }
}

function validPayload(value: unknown): value is CoopFaintSwitchPayload {
  const payload = value as CoopFaintSwitchPayload | undefined;
  return (
    payload != null
    && Number.isSafeInteger(payload.fieldIndex)
    && payload.fieldIndex >= 0
    && payload.fieldIndex < 4
    && Number.isSafeInteger(payload.partySlot)
    && Array.isArray(payload.data)
    && payload.data.every(Number.isFinite)
  );
}

function applyJournaledFaintSwitchEnvelope(envelope: CoopAuthoritativeEnvelopeV1): CoopApplyOutcome {
  if (!isCoopFaintSwitchOperationEnabled()) {
    return "rejected";
  }
  const operation = envelope.pendingOperation;
  if (operation?.kind !== "FAINT_SWITCH" || operation.status !== "applied") {
    return "rejected";
  }
  if (!validPayload(operation.payload)) {
    return "rejected";
  }
  const g = guest();
  if (g.hasApplied(operation.id)) {
    return "duplicate";
  }
  if (!routeCoopOperationToLiveSink("op:faintSwitch", envelope)) {
    return "rejected";
  }
  const result = g.applyEnvelope({ ...envelope, sessionEpoch: epoch, revision: g.getLastAppliedRevision() + 1 });
  if (result.kind !== "applied") {
    return "rejected";
  }
  cancelRetry(operation.payload);
  return "applied";
}

registerCoopOperationApplier("op:faintSwitch", applyJournaledFaintSwitchEnvelope);
