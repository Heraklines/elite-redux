/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { COOP_CAP_OP_COLOSSEUM, isCoopSurfaceCapabilityBlocked } from "#data/elite-redux/coop/coop-capabilities";
import { coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopApplyOutcome } from "#data/elite-redux/coop/coop-durability";
import { setCoopMeColosseumControl } from "#data/elite-redux/coop/coop-me-pin-state";
import {
  type CoopAuthoritativeEnvelopeV1,
  type CoopColosseumPayload,
  type CoopPendingOperation,
  makeCoopOperationId,
} from "#data/elite-redux/coop/coop-operation-envelope";
import {
  applyCoopOperationEnvelope,
  registerCoopOperationApplier,
  tryJournalCoopCommittedEnvelope,
} from "#data/elite-redux/coop/coop-operation-journal";
import { CoopOperationGuest, CoopOperationHost } from "#data/elite-redux/coop/coop-operation-runtime";
import { coopInteractionOwnerSeat } from "#data/elite-redux/coop/coop-session";
import type { CoopAuthoritativeBattleStateV1, CoopRole } from "#data/elite-redux/coop/coop-transport";

export const COOP_COLOSSEUM_ACTION_STRIDE = 100;
const COOP_COLOSSEUM_MAX_ROUND = Math.floor((COOP_COLOSSEUM_ACTION_STRIDE - 2) / 2);
const DEFAULT_ENABLED = !(typeof process !== "undefined" && process.env?.COOP_COLOSSEUM_OP === "off");

let enabled = DEFAULT_ENABLED;
let epoch = 1;
let revisionFloor = 0;
let authorityHost: CoopOperationHost | null = null;
let receiverGuest: CoopOperationGuest | null = null;
const nextBoardRoundByPin = new Map<number, number>();
const committedBoardsByPin = new Map<number, Map<number, { labels: string[]; operationId: string | null }>>();
const committedDecisionsByPin = new Map<number, Map<number, { index: number; operationId: string }>>();
let decisionRetryMs = 1_000;
const decisionRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();

function decisionKey(pinned: number, round: number, index: number): string {
  return `${pinned}:${round}:${index}`;
}

function cancelDecisionRetriesForRound(pinned: number, round: number): void {
  const prefix = `${pinned}:${round}:`;
  for (const [key, timer] of decisionRetryTimers) {
    if (key.startsWith(prefix)) {
      clearTimeout(timer);
      decisionRetryTimers.delete(key);
    }
  }
}

export function setCoopColosseumDecisionRetryMs(ms: number): void {
  decisionRetryMs = Math.max(1, Math.floor(ms));
}

export function resetCoopColosseumDecisionRetryMs(): void {
  decisionRetryMs = 1_000;
}

/** Guest owner: resend the same deterministic legacy intent until its committed envelope returns. */
export function armCoopColosseumDecisionResend(pinned: number, round: number, index: number, resend: () => void): void {
  if (!isCoopColosseumOperationEnabled() || pinned < 0) {
    return;
  }
  const key = decisionKey(pinned, round, index);
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
  nextBoardRoundByPin.clear();
  committedBoardsByPin.clear();
  committedDecisionsByPin.clear();
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
  actionOrdinal: number;
  wave: number;
  turn: number;
}): string | null {
  const op: CoopPendingOperation = {
    id: makeCoopOperationId(
      epoch,
      params.owner,
      params.pinned * COOP_COLOSSEUM_ACTION_STRIDE + params.actionOrdinal,
      "COLO_PICK",
    ),
    kind: "COLO_PICK",
    owner: params.owner,
    status: "proposed",
    payload: params.payload,
  };
  const result = host().submit(op, context(params.wave, params.turn), intent =>
    intent.owner === params.owner ? { ok: true } : { ok: false, reason: "wrong-owner" },
  );
  if ((result.kind === "committed" || result.kind === "reack") && tryJournalCoopCommittedEnvelope(result.envelope)) {
    return op.id;
  }
  return null;
}

export function commitColosseumBoard(params: {
  pinned: number;
  round?: number;
  labels: string[];
  localRole: CoopRole;
  wave: number;
  turn?: number;
}): { operationId: string | null; round: number } | null {
  if (params.localRole !== "host" || params.pinned < 0) {
    return null;
  }
  try {
    const round = params.round ?? nextBoardRoundByPin.get(params.pinned) ?? 0;
    if (!Number.isSafeInteger(round) || round < 0 || round > COOP_COLOSSEUM_MAX_ROUND) {
      return null;
    }
    const boards = committedBoardsByPin.get(params.pinned) ?? new Map();
    const prior = boards.get(round);
    if (prior == null) {
      const expected = nextBoardRoundByPin.get(params.pinned);
      // Live Colosseum boards are numbered by wins and therefore begin at one. Headless/default callers
      // begin at zero. The first retained board establishes that origin; every later board is contiguous.
      if (expected != null && round !== expected) {
        return null;
      }
    } else {
      if (JSON.stringify(prior.labels) !== JSON.stringify(params.labels)) {
        return null;
      }
      if (!isCoopColosseumOperationEnabled()) {
        return { operationId: null, round };
      }
    }
    if (!isCoopColosseumOperationEnabled()) {
      boards.set(round, { labels: [...params.labels], operationId: null });
      committedBoardsByPin.set(params.pinned, boards);
      nextBoardRoundByPin.set(params.pinned, round + 1);
      return { operationId: null, round };
    }
    const operationId = commit({
      pinned: params.pinned,
      payload: { type: "board", round, labels: [...params.labels] },
      owner: 0,
      actionOrdinal: round * 2,
      wave: params.wave,
      turn: params.turn ?? 0,
    });
    if (operationId == null) {
      return null;
    }
    boards.set(round, { labels: [...params.labels], operationId });
    committedBoardsByPin.set(params.pinned, boards);
    nextBoardRoundByPin.set(params.pinned, round + 1);
    return { operationId, round };
  } catch (error) {
    coopWarn("me", "colosseum board op commit/retention failed", error);
    return null;
  }
}

/** Called directly for a host-owned pick and by the host awaiter for a guest-owned proposal. */
export function commitColosseumDecision(params: {
  pinned: number;
  round: number;
  index: number;
  localRole: CoopRole;
  wave: number;
  turn?: number;
}): { kind: "committed"; operationId: string } | { kind: "duplicate" } | { kind: "failed" } {
  if (
    !isCoopColosseumOperationEnabled()
    || params.pinned < 0
    || !Number.isSafeInteger(params.round)
    || params.round < 0
    || params.round > COOP_COLOSSEUM_MAX_ROUND
    || (params.index !== 0 && params.index !== 1)
  ) {
    return { kind: "failed" };
  }
  try {
    const operationId = makeCoopOperationId(
      epoch,
      coopInteractionOwnerSeat(params.pinned),
      params.pinned * COOP_COLOSSEUM_ACTION_STRIDE + params.round * 2 + 1,
      "COLO_PICK",
    );
    if (params.localRole !== "host") {
      return { kind: "committed", operationId };
    }
    const committedDecisions = committedDecisionsByPin.get(params.pinned) ?? new Map();
    const prior = committedDecisions.get(params.round);
    if (prior != null) {
      return prior.index === params.index ? { kind: "duplicate" } : { kind: "failed" };
    }
    const retainedId = commit({
      pinned: params.pinned,
      payload: { type: "decision", round: params.round, index: params.index },
      owner: coopInteractionOwnerSeat(params.pinned),
      actionOrdinal: params.round * 2 + 1,
      wave: params.wave,
      turn: params.turn ?? 0,
    });
    if (retainedId == null) {
      return { kind: "failed" };
    }
    committedDecisions.set(params.round, { index: params.index, operationId: retainedId });
    committedDecisionsByPin.set(params.pinned, committedDecisions);
    return { kind: "committed", operationId: retainedId };
  } catch (error) {
    coopWarn("me", "colosseum decision op commit/retention failed", error);
    return { kind: "failed" };
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
  const result = applyCoopOperationEnvelope(g, "op:colosseum", envelope);
  if (result !== "applied") {
    return "rejected";
  }
  const payload = op.payload as CoopColosseumPayload | undefined;
  const parsed = /^\d+:\d+:[A-Z_]+:(\d+)$/.exec(op.id);
  if (payload != null && parsed != null) {
    const pinned = Math.floor(Number(parsed[1]) / COOP_COLOSSEUM_ACTION_STRIDE);
    if (payload.type === "board") {
      setCoopMeColosseumControl(pinned, { expectedRound: payload.round, boardRound: payload.round });
    } else {
      cancelDecisionRetriesForRound(pinned, payload.round);
      setCoopMeColosseumControl(pinned, {
        expectedRound: payload.round,
        boardRound: payload.round,
        decision: { round: payload.round, index: payload.index, operationId: op.id },
      });
    }
  }
  return "applied";
}

registerCoopOperationApplier("op:colosseum", applyJournaledColosseumEnvelope);
