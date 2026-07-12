/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { COOP_CAP_OP_COLOSSEUM, isCoopSurfaceCapabilityBlocked } from "#data/elite-redux/coop/coop-capabilities";
import { coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopApplyOutcome } from "#data/elite-redux/coop/coop-durability";
import {
  type CoopAuthoritativeEnvelopeV1,
  type CoopColosseumPayload,
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

export const COOP_COLOSSEUM_ACTION_STRIDE = 100;
const DEFAULT_ENABLED = !(typeof process !== "undefined" && process.env?.COOP_COLOSSEUM_OP === "off");

let enabled = DEFAULT_ENABLED;
let epoch = 1;
let revisionFloor = 0;
let authorityHost: CoopOperationHost | null = null;
let receiverGuest: CoopOperationGuest | null = null;
let ordinalPin = -1;
let ordinal = 0;
let decisionRetryMs = 1_000;
const decisionRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();

function decisionKey(pinned: number, index: number): string {
  return `${pinned}:${index}`;
}

function cancelDecisionRetry(pinned: number, index: number): void {
  const key = decisionKey(pinned, index);
  const timer = decisionRetryTimers.get(key);
  if (timer != null) {
    clearTimeout(timer);
    decisionRetryTimers.delete(key);
  }
}

export function setCoopColosseumDecisionRetryMs(ms: number): void {
  decisionRetryMs = Math.max(1, Math.floor(ms));
}

export function resetCoopColosseumDecisionRetryMs(): void {
  decisionRetryMs = 1_000;
}

/** Guest owner: resend the same deterministic legacy intent until its committed envelope returns. */
export function armCoopColosseumDecisionResend(pinned: number, index: number, resend: () => void): void {
  if (!isCoopColosseumOperationEnabled() || pinned < 0) {
    return;
  }
  const key = decisionKey(pinned, index);
  if (decisionRetryTimers.has(key)) {
    return;
  }
  const tick = () => {
    if (!decisionRetryTimers.has(key)) {
      return;
    }
    try {
      resend();
    } catch {
      /* the next bounded retry remains armed */
    }
    if (decisionRetryTimers.has(key)) {
      decisionRetryTimers.set(key, setTimeout(tick, decisionRetryMs));
    }
  };
  decisionRetryTimers.set(key, setTimeout(tick, decisionRetryMs));
}

export function isCoopColosseumOperationEnabled(): boolean {
  return enabled && !isCoopSurfaceCapabilityBlocked(COOP_CAP_OP_COLOSSEUM);
}

export function setCoopColosseumOperationEnabled(value: boolean): void {
  enabled = value;
}

export function resetCoopColosseumOperationFlag(): void {
  enabled = DEFAULT_ENABLED;
}

export function resetCoopColosseumOperationState(): void {
  CoopOperationHost.resetGlobalOrder();
  for (const timer of decisionRetryTimers.values()) {
    clearTimeout(timer);
  }
  decisionRetryTimers.clear();
  authorityHost = null;
  receiverGuest = null;
  revisionFloor = 0;
  ordinalPin = -1;
  ordinal = 0;
}

export function setCoopColosseumOperationRevisionFloor(highWater: number): void {
  if (!Number.isFinite(highWater) || highWater <= 0 || highWater === revisionFloor) {
    return;
  }
  revisionFloor = highWater;
  authorityHost = null;
  receiverGuest = null;
}

export function setCoopColosseumOperationEpoch(next: number): void {
  if (next === epoch) {
    return;
  }
  epoch = next;
  resetCoopColosseumOperationState();
}

function host(): CoopOperationHost {
  authorityHost ??= CoopOperationHost.global({ epoch, initialRevision: revisionFloor });
  return authorityHost;
}

function guest(): CoopOperationGuest {
  receiverGuest ??= CoopOperationGuest.global({ epoch, initialRevision: revisionFloor });
  return receiverGuest;
}

function nextOrdinal(pinned: number): number {
  if (ordinalPin !== pinned) {
    ordinalPin = pinned;
    ordinal = 0;
  }
  return ordinal++;
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

function commit(params: {
  pinned: number;
  payload: CoopColosseumPayload;
  owner: number;
  wave: number;
  turn: number;
}): void {
  const actionOrdinal = nextOrdinal(params.pinned);
  const op: CoopPendingOperation = {
    id: makeCoopOperationId(epoch, params.owner, params.pinned * COOP_COLOSSEUM_ACTION_STRIDE + actionOrdinal),
    kind: "COLO_PICK",
    owner: params.owner,
    status: "proposed",
    payload: params.payload,
  };
  const result = host().submit(op, context(params.wave, params.turn), intent =>
    intent.owner === params.owner ? { ok: true } : { ok: false, reason: "wrong-owner" },
  );
  if (result.kind === "committed") {
    journalCoopCommittedEnvelope(result.envelope);
  }
}

export function commitColosseumBoard(params: {
  pinned: number;
  labels: string[];
  localRole: CoopRole;
  wave: number;
  turn?: number;
}): void {
  if (!isCoopColosseumOperationEnabled() || params.localRole !== "host" || params.pinned < 0) {
    return;
  }
  try {
    commit({
      pinned: params.pinned,
      payload: { type: "board", labels: [...params.labels] },
      owner: 0,
      wave: params.wave,
      turn: params.turn ?? 0,
    });
  } catch (error) {
    coopWarn("me", "colosseum board op commit threw; legacy carrier remains active", error);
  }
}

/** Called directly for a host-owned pick and by the host awaiter for a guest-owned proposal. */
export function commitColosseumDecision(params: {
  pinned: number;
  index: number;
  localRole: CoopRole;
  wave: number;
  turn?: number;
}): void {
  if (!isCoopColosseumOperationEnabled() || params.localRole !== "host" || params.pinned < 0) {
    return;
  }
  try {
    commit({
      pinned: params.pinned,
      payload: { type: "decision", index: params.index },
      owner: coopInteractionOwnerSeat(params.pinned),
      wave: params.wave,
      turn: params.turn ?? 0,
    });
  } catch (error) {
    coopWarn("me", "colosseum decision op commit threw; legacy carrier remains active", error);
  }
}

function applyJournaledColosseumEnvelope(envelope: CoopAuthoritativeEnvelopeV1): CoopApplyOutcome {
  if (!isCoopColosseumOperationEnabled()) {
    return "rejected";
  }
  const op = envelope.pendingOperation;
  if (op?.kind !== "COLO_PICK" || op.status !== "applied") {
    return "rejected";
  }
  const g = guest();
  if (g.hasApplied(op.id)) {
    return "duplicate";
  }
  if (!routeCoopOperationToLiveSink("op:colosseum", envelope)) {
    return "rejected";
  }
  const result = g.applyEnvelope({ ...envelope, sessionEpoch: epoch, revision: g.getLastAppliedRevision() + 1 });
  if (result.kind !== "applied") {
    return "rejected";
  }
  const payload = op.payload as CoopColosseumPayload | undefined;
  if (payload?.type === "decision") {
    const parsed = /^\d+:\d+:(\d+)$/.exec(op.id);
    if (parsed != null) {
      const pinned = Math.floor(Number(parsed[1]) / COOP_COLOSSEUM_ACTION_STRIDE);
      cancelDecisionRetry(pinned, payload.index);
    }
  }
  return "applied";
}

registerCoopOperationApplier("op:colosseum", applyJournaledColosseumEnvelope);
