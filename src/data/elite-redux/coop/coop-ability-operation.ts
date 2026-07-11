/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { COOP_CAP_OP_ABILITY, isCoopSurfaceCapabilityBlocked } from "#data/elite-redux/coop/coop-capabilities";
import { coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopApplyOutcome } from "#data/elite-redux/coop/coop-durability";
import {
  type CoopAbilityPickPayload,
  type CoopAuthoritativeEnvelopeV1,
  type CoopPendingOperation,
  makeCoopOperationId,
} from "#data/elite-redux/coop/coop-operation-envelope";
import {
  journalCoopCommittedEnvelope,
  registerCoopOperationApplier,
  routeCoopOperationToLiveSink,
} from "#data/elite-redux/coop/coop-operation-journal";
import { CoopOperationGuest, CoopOperationHost } from "#data/elite-redux/coop/coop-operation-runtime";
import { coopInteractionOwnerSeat } from "#data/elite-redux/coop/coop-session";
import type { CoopAuthoritativeBattleStateV1, CoopRole } from "#data/elite-redux/coop/coop-transport";

export const COOP_ABILITY_ACTION_STRIDE = 100;
const DEFAULT_ENABLED = !(typeof process !== "undefined" && process.env?.COOP_ABILITY_OP === "off");

let enabled = DEFAULT_ENABLED;
let epoch = 1;
let revisionFloor = 0;
let authorityHost: CoopOperationHost | null = null;
let receiverGuest: CoopOperationGuest | null = null;
let authorityOrdinalPin = -1;
let authorityOrdinal = 0;
let watcherOrdinalPin = -1;
let watcherOrdinal = 0;
let retryMs = 1_000;
const retries = new Map<string, ReturnType<typeof setTimeout>>();
const pendingMaterializations = new Set<string>();

export function isCoopAbilityOperationEnabled(): boolean {
  return enabled && !isCoopSurfaceCapabilityBlocked(COOP_CAP_OP_ABILITY);
}

export function setCoopAbilityOperationEnabled(value: boolean): void {
  enabled = value;
}

export function resetCoopAbilityOperationFlag(): void {
  enabled = DEFAULT_ENABLED;
}

export function setCoopAbilityOperationEpoch(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value === epoch) {
    return;
  }
  epoch = value;
  resetCoopAbilityOperationState();
}

export function setCoopAbilityOutcomeRetryMs(ms: number): void {
  retryMs = Math.max(1, Math.floor(ms));
}

export function resetCoopAbilityOutcomeRetryMs(): void {
  retryMs = 1_000;
}

export function resetCoopAbilityOperationState(): void {
  for (const timer of retries.values()) {
    clearTimeout(timer);
  }
  retries.clear();
  pendingMaterializations.clear();
  authorityHost = null;
  receiverGuest = null;
  authorityOrdinalPin = -1;
  authorityOrdinal = 0;
  watcherOrdinalPin = -1;
  watcherOrdinal = 0;
  revisionFloor = 0;
}

export function setCoopAbilityOperationRevisionFloor(highWater: number): void {
  if (!Number.isFinite(highWater) || highWater <= 0 || highWater === revisionFloor) {
    return;
  }
  revisionFloor = highWater;
  authorityHost = null;
  receiverGuest = null;
}

function host(): CoopOperationHost {
  authorityHost ??= new CoopOperationHost({ epoch, initialRevision: revisionFloor });
  return authorityHost;
}

function guest(): CoopOperationGuest {
  receiverGuest ??= new CoopOperationGuest({ epoch, initialRevision: revisionFloor });
  return receiverGuest;
}

function nextAuthorityOrdinal(pinned: number): number {
  if (authorityOrdinalPin !== pinned) {
    authorityOrdinalPin = pinned;
    authorityOrdinal = 0;
  }
  return authorityOrdinal++;
}

function peekWatcherOrdinal(pinned: number): number {
  if (watcherOrdinalPin !== pinned) {
    watcherOrdinalPin = pinned;
    watcherOrdinal = 0;
  }
  return watcherOrdinal;
}

function opId(pinned: number, ordinal: number): string {
  return makeCoopOperationId(epoch, coopInteractionOwnerSeat(pinned), pinned * COOP_ABILITY_ACTION_STRIDE + ordinal);
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
  return { wave, turn, logicalPhase: "INTERACTION" as const, authoritativeState };
}

function commit(pinned: number, data: number[], wave: number, turn: number): void {
  const owner = coopInteractionOwnerSeat(pinned);
  const operation: CoopPendingOperation = {
    id: opId(pinned, nextAuthorityOrdinal(pinned)),
    kind: "ABILITY_PICK",
    owner,
    status: "proposed",
    payload: { data: [...data] } satisfies CoopAbilityPickPayload,
  };
  const result = host().submit(operation, context(wave, turn), intent =>
    intent.owner === owner ? { ok: true } : { ok: false, reason: "wrong-owner" },
  );
  if (result.kind === "committed") {
    journalCoopCommittedEnvelope(result.envelope);
  }
}

export function commitAbilityOwnerOutcome(params: {
  pinned: number;
  data: number[];
  localRole: CoopRole;
  wave: number;
  turn?: number;
}): void {
  if (!isCoopAbilityOperationEnabled() || params.localRole !== "host" || params.pinned < 0) {
    return;
  }
  try {
    commit(params.pinned, params.data, params.wave, params.turn ?? 0);
  } catch (error) {
    coopWarn("ability", "ability op commit threw; legacy carrier remains active", error);
  }
}

export function adoptAbilityWatcherOutcome(params: {
  pinned: number;
  data: number[] | null;
  localRole: CoopRole;
  wave: number;
  turn?: number;
}): boolean {
  if (!isCoopAbilityOperationEnabled()) {
    return params.data != null;
  }
  if (params.data == null || params.pinned < 0) {
    return false;
  }
  if (params.localRole === "host") {
    commit(params.pinned, params.data, params.wave, params.turn ?? 0);
    return true;
  }
  const ordinal = peekWatcherOrdinal(params.pinned);
  const id = opId(params.pinned, ordinal);
  const g = guest();
  if (g.hasApplied(id)) {
    if (pendingMaterializations.delete(id)) {
      watcherOrdinal++;
      return true;
    }
    return false;
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
    sessionEpoch: epoch,
    revision: g.getLastAppliedRevision() + 1,
    ...context(params.wave, params.turn ?? 0),
    pendingOperation: operation,
  });
  if (result.kind === "applied") {
    watcherOrdinal++;
    return true;
  }
  return false;
}

function retryKey(pinned: number, data: number[]): string {
  return `${pinned}:${JSON.stringify(data)}`;
}

export function armCoopAbilityOutcomeResend(pinned: number, data: number[], resend: () => void): void {
  if (!isCoopAbilityOperationEnabled()) {
    return;
  }
  const key = retryKey(pinned, data);
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
      coopWarn("ability", "ability outcome resend threw; retry remains armed", error);
    }
    if (retries.has(key)) {
      retries.set(key, setTimeout(tick, retryMs));
    }
  };
  retries.set(key, setTimeout(tick, retryMs));
}

function cancelRetry(pinned: number, data: number[]): void {
  const key = retryKey(pinned, data);
  const timer = retries.get(key);
  if (timer != null) {
    clearTimeout(timer);
    retries.delete(key);
  }
}

export function armCoopAbilityJournalMaterialization(id: string): void {
  pendingMaterializations.add(id);
}

function applyJournaledAbilityEnvelope(envelope: CoopAuthoritativeEnvelopeV1): CoopApplyOutcome {
  if (!isCoopAbilityOperationEnabled()) {
    return "duplicate";
  }
  const operation = envelope.pendingOperation;
  if (operation?.kind !== "ABILITY_PICK" || operation.status !== "applied") {
    return "duplicate";
  }
  const payload = operation.payload as CoopAbilityPickPayload | undefined;
  if (payload == null || !Array.isArray(payload.data) || !payload.data.every(Number.isFinite)) {
    return "rejected";
  }
  const g = guest();
  if (g.hasApplied(operation.id)) {
    return "duplicate";
  }
  const result = g.applyEnvelope({ ...envelope, sessionEpoch: epoch, revision: g.getLastAppliedRevision() + 1 });
  if (result.kind !== "applied") {
    return "rejected";
  }
  const parsed = /^\d+:\d+:(\d+)$/.exec(operation.id);
  if (parsed != null) {
    const pinned = Math.floor(Number(parsed[1]) / COOP_ABILITY_ACTION_STRIDE);
    cancelRetry(pinned, payload.data);
  }
  routeCoopOperationToLiveSink("op:ability", envelope);
  return "applied";
}

registerCoopOperationApplier("op:ability", applyJournaledAbilityEnvelope);
