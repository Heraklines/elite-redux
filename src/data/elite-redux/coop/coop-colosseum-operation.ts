/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { COOP_CAP_OP_COLOSSEUM, isCoopSurfaceCapabilityBlocked } from "#data/elite-redux/coop/coop-capabilities";
import { coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopApplyOutcome, CoopDurabilityManager } from "#data/elite-redux/coop/coop-durability";
import {
  captureCoopMeControlTransactionState,
  restoreCoopMeControlTransactionState,
  setCoopMeColosseumControl,
} from "#data/elite-redux/coop/coop-me-pin-state";
import {
  type CoopAuthoritativeEnvelopeV1,
  type CoopColosseumPayload,
  type CoopPendingOperation,
  makeCoopOperationId,
  parseCoopOperationId,
} from "#data/elite-redux/coop/coop-operation-envelope";
import {
  applyCoopOperationEnvelope,
  getActiveCoopOperationDurability,
  registerCoopOperationApplier,
  tryJournalCoopCommittedEnvelope,
  tryJournalCoopCommittedEnvelopeFor,
} from "#data/elite-redux/coop/coop-operation-journal";
import {
  CoopOperationGuest,
  CoopOperationHost,
  type CoopRuntimeOpState,
  getActiveCoopRuntimeOpState,
  maybeCoopOpSurfaceState,
  registerCoopOpSurfaceState,
  requireCoopOpSurfaceState,
  requireCoopOpSurfaceStateFor,
  resetActiveCoopRuntimeClocks,
} from "#data/elite-redux/coop/coop-operation-runtime";
import { coopInteractionOwnerSeat } from "#data/elite-redux/coop/coop-session";
import type { CoopAuthoritativeBattleStateV1, CoopRole } from "#data/elite-redux/coop/coop-transport";

export const COOP_COLOSSEUM_ACTION_STRIDE = 100;
const COOP_COLOSSEUM_MAX_ROUND = Math.floor((COOP_COLOSSEUM_ACTION_STRIDE - 2) / 2);
const DEFAULT_ENABLED = !(typeof process !== "undefined" && process.env?.COOP_COLOSSEUM_OP === "off");

let enabled = DEFAULT_ENABLED;
let decisionRetryMs = 1_000;

/** Authority/receiver cursors and every Colosseum receipt belong to one assembled co-op runtime. */
interface ColosseumOpState {
  epoch: number;
  revisionFloor: number;
  authorityHost: CoopOperationHost | null;
  receiverGuest: CoopOperationGuest | null;
  readonly nextBoardRoundByPin: Map<number, number>;
  readonly committedBoardsByPin: Map<number, Map<number, { labels: string[]; operationId: string | null }>>;
  readonly committedDecisionsByPin: Map<number, Map<number, { index: number; operationId: string }>>;
  readonly decisionRetryTimers: Map<string, ReturnType<typeof setTimeout>>;
}

function createColosseumOpState(): ColosseumOpState {
  return {
    epoch: 1,
    revisionFloor: 0,
    authorityHost: null,
    receiverGuest: null,
    nextBoardRoundByPin: new Map(),
    committedBoardsByPin: new Map(),
    committedDecisionsByPin: new Map(),
    decisionRetryTimers: new Map(),
  };
}

registerCoopOpSurfaceState("colosseum", createColosseumOpState);

/**
 * Operation-off callers keep their deterministic legacy board validation without inventing an ambient
 * authoritative runtime. No enabled/journaled operation reads or writes this compatibility record.
 */
const legacyState = createColosseumOpState();

/** Stable selectors captured before a board await or resend timer can resume on another client. */
export interface CoopColosseumOperationBinding {
  readonly opState: CoopRuntimeOpState;
  readonly durability: CoopDurabilityManager | null;
}

/** Missing or role-mismatched runtime state is a programming error, never a process-global fallback. */
export function captureCoopColosseumOperationBinding(expectedRole?: CoopRole): CoopColosseumOperationBinding {
  const opState = getActiveCoopRuntimeOpState();
  if (opState == null) {
    throw new Error("[coop-op] no runtime installed for surface=colosseum (cannot capture continuation binding)");
  }
  if (expectedRole != null && opState.localRole != null && opState.localRole !== expectedRole) {
    throw new Error(
      `[coop-op] surface=colosseum binding role=${opState.localRole} cannot execute localRole=${expectedRole}`,
    );
  }
  requireCoopOpSurfaceStateFor<ColosseumOpState>(opState, "colosseum");
  return { opState, durability: getActiveCoopOperationDurability() };
}

function state(binding?: CoopColosseumOperationBinding | null): ColosseumOpState {
  return binding == null
    ? requireCoopOpSurfaceState<ColosseumOpState>("colosseum")
    : requireCoopOpSurfaceStateFor<ColosseumOpState>(binding.opState, "colosseum");
}

function maybeState(binding?: CoopColosseumOperationBinding | null): ColosseumOpState | null {
  return binding == null
    ? maybeCoopOpSurfaceState<ColosseumOpState>("colosseum")
    : requireCoopOpSurfaceStateFor<ColosseumOpState>(binding.opState, "colosseum");
}

function assertBindingRole(binding: CoopColosseumOperationBinding | null | undefined, role: CoopRole): void {
  const opState = binding?.opState ?? getActiveCoopRuntimeOpState();
  if (opState == null) {
    throw new Error(`[coop-op] no runtime installed for surface=colosseum localRole=${role}`);
  }
  if (opState.localRole != null && opState.localRole !== role) {
    throw new Error(`[coop-op] surface=colosseum binding role=${opState.localRole} cannot execute localRole=${role}`);
  }
}

function retainEnvelope(
  envelope: CoopAuthoritativeEnvelopeV1,
  binding?: CoopColosseumOperationBinding | null,
): boolean {
  return binding == null
    ? tryJournalCoopCommittedEnvelope(envelope)
    : tryJournalCoopCommittedEnvelopeFor(binding.durability, envelope);
}

function isCoopOpRuntimeError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("[coop-op]");
}

function decisionKey(pinned: number, round: number, index: number): string {
  return `${pinned}:${round}:${index}`;
}

function cancelDecisionRetriesForRound(s: ColosseumOpState, pinned: number, round: number): void {
  const prefix = `${pinned}:${round}:`;
  for (const [key, timer] of s.decisionRetryTimers) {
    if (key.startsWith(prefix)) {
      clearTimeout(timer);
      s.decisionRetryTimers.delete(key);
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
export function armCoopColosseumDecisionResend(
  pinned: number,
  round: number,
  index: number,
  resend: () => void,
  binding?: CoopColosseumOperationBinding | null,
): void {
  if (!isCoopColosseumOperationEnabled() || pinned < 0) {
    return;
  }
  const captured = binding ?? captureCoopColosseumOperationBinding("guest");
  assertBindingRole(captured, "guest");
  const s = state(captured);
  const key = decisionKey(pinned, round, index);
  if (s.decisionRetryTimers.has(key)) {
    return;
  }
  const tick = () => {
    if (!s.decisionRetryTimers.has(key)) {
      return;
    }
    try {
      resend();
    } catch {
      /* the next bounded retry remains armed */
    }
    if (s.decisionRetryTimers.has(key)) {
      s.decisionRetryTimers.set(key, setTimeout(tick, decisionRetryMs));
    }
  };
  s.decisionRetryTimers.set(key, setTimeout(tick, decisionRetryMs));
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

function resetStateRecord(s: ColosseumOpState): void {
  for (const timer of s.decisionRetryTimers.values()) {
    clearTimeout(timer);
  }
  s.decisionRetryTimers.clear();
  s.authorityHost = null;
  s.receiverGuest = null;
  s.revisionFloor = 0;
  s.nextBoardRoundByPin.clear();
  s.committedBoardsByPin.clear();
  s.committedDecisionsByPin.clear();
}

export function resetCoopColosseumOperationState(binding?: CoopColosseumOperationBinding | null): void {
  const s = maybeState(binding);
  if (s != null) {
    if (binding == null) {
      resetActiveCoopRuntimeClocks();
    } else {
      binding.opState.hostClock = null;
      binding.opState.guestClock = null;
    }
    resetStateRecord(s);
  }
  if (binding == null) {
    resetStateRecord(legacyState);
  }
}

export function setCoopColosseumOperationRevisionFloor(
  highWater: number,
  binding?: CoopColosseumOperationBinding | null,
): void {
  const s = maybeState(binding);
  if (s == null || !Number.isFinite(highWater) || highWater <= 0 || highWater === s.revisionFloor) {
    return;
  }
  s.revisionFloor = highWater;
  s.authorityHost = null;
  s.receiverGuest = null;
}

export function setCoopColosseumOperationEpoch(next: number, binding?: CoopColosseumOperationBinding | null): void {
  const s = maybeState(binding);
  if (s == null || !Number.isSafeInteger(next) || next <= 0 || next === s.epoch) {
    return;
  }
  s.epoch = next;
  resetCoopColosseumOperationState(binding);
}

function host(binding?: CoopColosseumOperationBinding | null): CoopOperationHost {
  const s = state(binding);
  s.authorityHost ??=
    binding == null
      ? CoopOperationHost.forActiveRuntime({ epoch: s.epoch, initialRevision: s.revisionFloor })
      : CoopOperationHost.forRuntime(binding.opState, { epoch: s.epoch, initialRevision: s.revisionFloor });
  return s.authorityHost;
}

function guest(binding?: CoopColosseumOperationBinding | null): CoopOperationGuest {
  const s = state(binding);
  s.receiverGuest ??=
    binding == null
      ? CoopOperationGuest.forActiveRuntime({ epoch: s.epoch, initialRevision: s.revisionFloor })
      : CoopOperationGuest.forRuntime(binding.opState, { epoch: s.epoch, initialRevision: s.revisionFloor });
  return s.receiverGuest;
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

function commit(
  params: {
    pinned: number;
    payload: CoopColosseumPayload;
    owner: number;
    actionOrdinal: number;
    wave: number;
    turn: number;
  },
  binding?: CoopColosseumOperationBinding | null,
): string | null {
  const s = state(binding);
  const op: CoopPendingOperation = {
    id: makeCoopOperationId(
      s.epoch,
      params.owner,
      params.pinned * COOP_COLOSSEUM_ACTION_STRIDE + params.actionOrdinal,
      "COLO_PICK",
    ),
    kind: "COLO_PICK",
    owner: params.owner,
    status: "proposed",
    payload: params.payload,
  };
  const result = host(binding).submit(op, context(params.wave, params.turn), intent =>
    intent.owner === params.owner ? { ok: true } : { ok: false, reason: "wrong-owner" },
  );
  if ((result.kind === "committed" || result.kind === "reack") && retainEnvelope(result.envelope, binding)) {
    return op.id;
  }
  return null;
}

interface ColosseumBoardSlot {
  readonly round: number;
  readonly boards: Map<number, { labels: string[]; operationId: string | null }>;
  readonly alreadyRetained: boolean;
}

function resolveBoardSlot(
  s: ColosseumOpState,
  pinned: number,
  roundOverride: number | undefined,
  labels: readonly string[],
): ColosseumBoardSlot | null {
  const round = roundOverride ?? s.nextBoardRoundByPin.get(pinned) ?? 0;
  if (!Number.isSafeInteger(round) || round < 0 || round > COOP_COLOSSEUM_MAX_ROUND) {
    return null;
  }
  const boards = s.committedBoardsByPin.get(pinned) ?? new Map();
  const prior = boards.get(round);
  if (prior != null) {
    return JSON.stringify(prior.labels) === JSON.stringify(labels) ? { round, boards, alreadyRetained: true } : null;
  }
  const expected = s.nextBoardRoundByPin.get(pinned);
  // Live boards start at win one; headless/default callers start at zero. The first board fixes the origin.
  return expected == null || round === expected ? { round, boards, alreadyRetained: false } : null;
}

export function commitColosseumBoard(
  params: {
    pinned: number;
    round?: number | undefined;
    labels: string[];
    localRole: CoopRole;
    wave: number;
    turn?: number | undefined;
  },
  binding?: CoopColosseumOperationBinding | null,
): { operationId: string | null; round: number } | null {
  if (params.localRole !== "host" || params.pinned < 0) {
    return null;
  }
  const operationEnabled = isCoopColosseumOperationEnabled();
  if (operationEnabled) {
    assertBindingRole(binding, params.localRole);
  }
  try {
    const s = operationEnabled ? state(binding) : legacyState;
    const slot = resolveBoardSlot(s, params.pinned, params.round, params.labels);
    if (slot == null) {
      return null;
    }
    if (slot.alreadyRetained && !operationEnabled) {
      return { operationId: null, round: slot.round };
    }
    if (!operationEnabled) {
      slot.boards.set(slot.round, { labels: [...params.labels], operationId: null });
      s.committedBoardsByPin.set(params.pinned, slot.boards);
      s.nextBoardRoundByPin.set(params.pinned, slot.round + 1);
      return { operationId: null, round: slot.round };
    }
    const operationId = commit(
      {
        pinned: params.pinned,
        payload: { type: "board", round: slot.round, labels: [...params.labels] },
        owner: 0,
        actionOrdinal: slot.round * 2,
        wave: params.wave,
        turn: params.turn ?? 0,
      },
      binding,
    );
    if (operationId == null) {
      return null;
    }
    slot.boards.set(slot.round, { labels: [...params.labels], operationId });
    s.committedBoardsByPin.set(params.pinned, slot.boards);
    s.nextBoardRoundByPin.set(params.pinned, slot.round + 1);
    return { operationId, round: slot.round };
  } catch (error) {
    if (isCoopOpRuntimeError(error)) {
      throw error;
    }
    coopWarn("me", "colosseum board op commit/retention failed", error);
    return null;
  }
}

/** Called directly for a host-owned pick and by the host awaiter for a guest-owned proposal. */
export function commitColosseumDecision(
  params: {
    pinned: number;
    round: number;
    index: number;
    localRole: CoopRole;
    wave: number;
    turn?: number;
  },
  binding?: CoopColosseumOperationBinding | null,
): { kind: "committed"; operationId: string } | { kind: "duplicate" } | { kind: "failed" } {
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
  assertBindingRole(binding, params.localRole);
  try {
    const s = state(binding);
    const operationId = makeCoopOperationId(
      s.epoch,
      coopInteractionOwnerSeat(params.pinned),
      params.pinned * COOP_COLOSSEUM_ACTION_STRIDE + params.round * 2 + 1,
      "COLO_PICK",
    );
    if (params.localRole !== "host") {
      return { kind: "committed", operationId };
    }
    const committedDecisions = s.committedDecisionsByPin.get(params.pinned) ?? new Map();
    const prior = committedDecisions.get(params.round);
    if (prior != null) {
      return prior.index === params.index ? { kind: "duplicate" } : { kind: "failed" };
    }
    const retainedId = commit(
      {
        pinned: params.pinned,
        payload: { type: "decision", round: params.round, index: params.index },
        owner: coopInteractionOwnerSeat(params.pinned),
        actionOrdinal: params.round * 2 + 1,
        wave: params.wave,
        turn: params.turn ?? 0,
      },
      binding,
    );
    if (retainedId == null) {
      return { kind: "failed" };
    }
    committedDecisions.set(params.round, { index: params.index, operationId: retainedId });
    s.committedDecisionsByPin.set(params.pinned, committedDecisions);
    return { kind: "committed", operationId: retainedId };
  } catch (error) {
    if (isCoopOpRuntimeError(error)) {
      throw error;
    }
    coopWarn("me", "colosseum decision op commit/retention failed", error);
    return { kind: "failed" };
  }
}

function validatedColosseumEnvelope(
  envelope: CoopAuthoritativeEnvelopeV1,
): { op: CoopPendingOperation; payload: CoopColosseumPayload; pinned: number } | null {
  const op = envelope.pendingOperation;
  if (op?.kind !== "COLO_PICK" || op.status !== "applied") {
    return null;
  }
  const parsed = parseCoopOperationId(op.id);
  if (
    parsed == null
    || parsed.epoch !== envelope.sessionEpoch
    || parsed.kind !== "COLO_PICK"
    || parsed.owner !== op.owner
    || parsed.pinnedSeq < 0
  ) {
    return null;
  }
  const pinned = Math.floor(parsed.pinnedSeq / COOP_COLOSSEUM_ACTION_STRIDE);
  const actionOrdinal = parsed.pinnedSeq - pinned * COOP_COLOSSEUM_ACTION_STRIDE;
  const payload = op.payload as CoopColosseumPayload | undefined;
  if (
    payload == null
    || !Number.isSafeInteger(payload.round)
    || payload.round < 0
    || payload.round > COOP_COLOSSEUM_MAX_ROUND
  ) {
    return null;
  }
  if (payload.type === "board") {
    if (
      parsed.owner !== 0
      || actionOrdinal !== payload.round * 2
      || !Array.isArray(payload.labels)
      || payload.labels.some(label => typeof label !== "string")
    ) {
      return null;
    }
  } else if (
    payload.type !== "decision"
    || parsed.owner !== coopInteractionOwnerSeat(pinned)
    || actionOrdinal !== payload.round * 2 + 1
    || (payload.index !== 0 && payload.index !== 1)
  ) {
    return null;
  }
  return { op, payload, pinned };
}

function applyJournaledColosseumEnvelope(envelope: CoopAuthoritativeEnvelopeV1): CoopApplyOutcome {
  if (!isCoopColosseumOperationEnabled()) {
    return "rejected";
  }
  const validated = validatedColosseumEnvelope(envelope);
  if (validated == null) {
    return "rejected";
  }
  assertBindingRole(undefined, "guest");
  const s = state();
  const { op, payload, pinned } = validated;
  const g = guest();
  const inspected = g.inspectEnvelope(envelope);
  if (inspected.kind === "duplicate") {
    return "duplicate";
  }
  if (inspected.kind !== "applied") {
    return "rejected";
  }
  // The Colosseum cursor and the journal/live-sink application are one transaction. Recovery can snapshot
  // this process-global ME control between durability retries, so a sink rejection must not leave a board or
  // decision visible before the corresponding operation is materialized and ACKable. Capture every coupled
  // ME scalar, pre-apply the exact cursor (the live sink may synchronously wake its consumer), and restore the
  // immutable before-image unless the sink AND guest ledger both accept. This is the same shadow-atomic seam
  // used by full ME-state recovery: failure is externally indistinguishable from no attempt.
  const controlBefore = captureCoopMeControlTransactionState();
  let applied = false;
  try {
    const controlRetained =
      payload.type === "board"
        ? setCoopMeColosseumControl(pinned, { expectedRound: payload.round, boardRound: payload.round })
        : setCoopMeColosseumControl(pinned, {
            expectedRound: payload.round,
            boardRound: payload.round,
            decision: { round: payload.round, index: payload.index, operationId: op.id },
          });
    if (!controlRetained) {
      return "rejected";
    }
    const colosseumApply = applyCoopOperationEnvelope(g, "op:colosseum", envelope);
    if (colosseumApply !== "applied") {
      return colosseumApply;
    }
    applied = true;
  } finally {
    if (!applied) {
      restoreCoopMeControlTransactionState(controlBefore);
    }
  }
  if (payload.type === "decision") {
    cancelDecisionRetriesForRound(s, pinned, payload.round);
  }
  return "applied";
}

registerCoopOperationApplier("op:colosseum", applyJournaledColosseumEnvelope);
