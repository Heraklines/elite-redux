/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { COOP_CAP_OP_REVIVAL, isCoopSurfaceCapabilityBlocked } from "#data/elite-redux/coop/coop-capabilities";
import { coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopApplyOutcome, CoopDurabilityManager } from "#data/elite-redux/coop/coop-durability";
import type { CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import {
  type CoopAuthoritativeEnvelopeV1,
  type CoopPendingOperation,
  type CoopRevivalPayload,
  makeCoopOperationId,
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
import { coopSeatOfRole } from "#data/elite-redux/coop/coop-session";
import type { CoopAuthoritativeBattleStateV1, CoopRole } from "#data/elite-redux/coop/coop-transport";

const DEFAULT_ENABLED = !(typeof process !== "undefined" && process.env?.COOP_REVIVAL_OP === "off");
const WAVE_STRIDE = 1_000_000;
const TURN_STRIDE = 100;
const FIELD_STRIDE = 10;

let enabled = DEFAULT_ENABLED;
let retryMs = 1_000;

/** Every authoritative cursor, receive ledger, and retry timer belongs to one assembled runtime. */
interface RevivalOpState {
  epoch: number;
  revisionFloor: number;
  authorityHost: CoopOperationHost | null;
  receiverGuest: CoopOperationGuest | null;
  readonly retries: Map<string, ReturnType<typeof setTimeout>>;
}

registerCoopOpSurfaceState(
  "revival",
  (): RevivalOpState => ({
    epoch: 1,
    revisionFloor: 0,
    authorityHost: null,
    receiverGuest: null,
    retries: new Map(),
  }),
);

/** Stable selectors captured before a revival await, picker callback, or resend timer can resume. */
export interface CoopRevivalOperationBinding {
  readonly opState: CoopRuntimeOpState;
  readonly durability: CoopDurabilityManager | null;
}

/** Missing or role-mismatched runtime state is a programming error, never a process-global fallback. */
export function captureCoopRevivalOperationBinding(expectedRole?: CoopRole): CoopRevivalOperationBinding {
  const opState = getActiveCoopRuntimeOpState();
  if (opState == null) {
    throw new Error("[coop-op] no runtime installed for surface=revival (cannot capture continuation binding)");
  }
  if (expectedRole != null && opState.localRole != null && opState.localRole !== expectedRole) {
    throw new Error(
      `[coop-op] surface=revival binding role=${opState.localRole} cannot execute localRole=${expectedRole}`,
    );
  }
  requireCoopOpSurfaceStateFor<RevivalOpState>(opState, "revival");
  return { opState, durability: getActiveCoopOperationDurability() };
}

function state(binding?: CoopRevivalOperationBinding | null): RevivalOpState {
  return binding == null
    ? requireCoopOpSurfaceState<RevivalOpState>("revival")
    : requireCoopOpSurfaceStateFor<RevivalOpState>(binding.opState, "revival");
}

function maybeState(binding?: CoopRevivalOperationBinding | null): RevivalOpState | null {
  return binding == null
    ? maybeCoopOpSurfaceState<RevivalOpState>("revival")
    : requireCoopOpSurfaceStateFor<RevivalOpState>(binding.opState, "revival");
}

function assertBindingRole(binding: CoopRevivalOperationBinding | null | undefined, role: CoopRole): void {
  const opState = binding?.opState ?? getActiveCoopRuntimeOpState();
  if (opState == null) {
    throw new Error(`[coop-op] no runtime installed for surface=revival localRole=${role}`);
  }
  if (opState.localRole != null && opState.localRole !== role) {
    throw new Error(`[coop-op] surface=revival binding role=${opState.localRole} cannot execute localRole=${role}`);
  }
}

function retainEnvelope(envelope: CoopAuthoritativeEnvelopeV1, binding?: CoopRevivalOperationBinding | null): boolean {
  return binding == null
    ? tryJournalCoopCommittedEnvelope(envelope)
    : tryJournalCoopCommittedEnvelopeFor(binding.durability, envelope);
}

function isCoopOpRuntimeError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("[coop-op]");
}

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

export function resetCoopRevivalOperationState(binding?: CoopRevivalOperationBinding | null): void {
  const s = maybeState(binding);
  if (s == null) {
    return;
  }
  if (binding == null) {
    resetActiveCoopRuntimeClocks();
  } else {
    binding.opState.hostClock = null;
    binding.opState.guestClock = null;
  }
  for (const timer of s.retries.values()) {
    clearTimeout(timer);
  }
  s.retries.clear();
  s.authorityHost = null;
  s.receiverGuest = null;
  s.revisionFloor = 0;
}

export function setCoopRevivalOperationRevisionFloor(
  highWater: number,
  binding?: CoopRevivalOperationBinding | null,
): void {
  const s = maybeState(binding);
  if (s == null || !Number.isFinite(highWater) || highWater <= 0 || highWater === s.revisionFloor) {
    return;
  }
  s.revisionFloor = highWater;
  s.authorityHost = null;
  s.receiverGuest = null;
}

export function setCoopRevivalOperationEpoch(value: number, binding?: CoopRevivalOperationBinding | null): void {
  const s = maybeState(binding);
  if (s == null || !Number.isSafeInteger(value) || value <= 0 || value === s.epoch) {
    return;
  }
  s.epoch = value;
  resetCoopRevivalOperationState(binding);
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

function host(binding?: CoopRevivalOperationBinding | null): CoopOperationHost {
  const s = state(binding);
  s.authorityHost ??=
    binding == null
      ? CoopOperationHost.forActiveRuntime({ epoch: s.epoch, initialRevision: s.revisionFloor })
      : CoopOperationHost.forRuntime(binding.opState, { epoch: s.epoch, initialRevision: s.revisionFloor });
  return s.authorityHost;
}

function guest(binding?: CoopRevivalOperationBinding | null): CoopOperationGuest {
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
  return { wave, turn, logicalPhase: "TURN_RESOLVE" as const, authoritativeState };
}

function commitAction(
  params: {
    payload: CoopRevivalPayload;
    ownerRole: CoopRole;
    localRole: CoopRole;
    wave: number;
    turn: number;
  },
  binding?: CoopRevivalOperationBinding | null,
): string | undefined {
  if (!isCoopRevivalOperationEnabled()) {
    return;
  }
  assertBindingRole(binding, params.localRole);
  if (params.localRole !== "host") {
    return;
  }
  try {
    const s = state(binding);
    const owner = coopSeatOfRole(params.ownerRole);
    const operation: CoopPendingOperation = {
      id: makeCoopOperationId(s.epoch, owner, actionAddress(params.payload, params.wave, params.turn), "REVIVAL"),
      kind: "REVIVAL",
      owner,
      status: "proposed",
      payload: { ...params.payload },
    };
    const result = host(binding).submit(operation, context(params.wave, params.turn), intent =>
      intent.owner === owner ? { ok: true } : { ok: false, reason: "wrong-owner" },
    );
    if (result.kind === "committed" || result.kind === "reack") {
      if (!retainEnvelope(result.envelope, binding)) {
        coopWarn(
          "replay",
          `revival op could not retain rev=${result.envelope.revision} id=${operation.id}; refusing raw continuation`,
        );
        return;
      }
      return result.envelope.pendingOperation?.id;
    }
  } catch (error) {
    if (isCoopOpRuntimeError(error)) {
      throw error;
    }
    coopWarn("replay", "revival op commit threw; refusing the unretained continuation", error);
  }
  return;
}

/** Journal the prompt first, then send the low-latency legacy carrier. */
export function sendCoopRevivalPrompt(
  relay: CoopInteractionRelay,
  fieldIndex: number,
  params: { localRole: CoopRole; wave: number; turn: number },
  binding?: CoopRevivalOperationBinding | null,
): boolean {
  if (!isCoopRevivalOperationEnabled()) {
    relay.promptRevival(fieldIndex);
    return true;
  }
  const operationId = commitAction(
    {
      payload: { type: "prompt", fieldIndex },
      ownerRole: "guest",
      ...params,
    },
    binding,
  );
  if (operationId == null) {
    return false;
  }
  relay.promptRevival(fieldIndex, operationId);
  return true;
}

export function commitRevivalAuthorityDecision(
  params: {
    payload: Extract<CoopRevivalPayload, { type: "decision" }>;
    ownerRole: CoopRole;
    localRole: CoopRole;
    wave: number;
    turn: number;
  },
  binding?: CoopRevivalOperationBinding | null,
): boolean {
  if (!isCoopRevivalOperationEnabled()) {
    return true;
  }
  return commitAction(params, binding) != null;
}

function retryKey(payload: Extract<CoopRevivalPayload, { type: "decision" }>, wave: number, turn: number): string {
  return String(eventAddress(wave, turn, payload.fieldIndex));
}

export function armCoopRevivalIntentResend(
  params: {
    payload: Extract<CoopRevivalPayload, { type: "decision" }>;
    localRole?: CoopRole;
    wave: number;
    turn: number;
    resend: () => void;
  },
  binding?: CoopRevivalOperationBinding | null,
): void {
  if (!isCoopRevivalOperationEnabled()) {
    return;
  }
  assertBindingRole(binding, params.localRole ?? "guest");
  const s = state(binding);
  const key = retryKey(params.payload, params.wave, params.turn);
  if (s.retries.has(key)) {
    return;
  }
  const tick = () => {
    if (!s.retries.has(key)) {
      return;
    }
    try {
      params.resend();
    } catch (error) {
      coopWarn("replay", "revival intent resend threw; retry remains armed", error);
    }
    if (s.retries.has(key)) {
      s.retries.set(key, setTimeout(tick, retryMs));
    }
  };
  s.retries.set(key, setTimeout(tick, retryMs));
}

function cancelRetry(
  s: RevivalOpState,
  payload: Extract<CoopRevivalPayload, { type: "decision" }>,
  wave: number,
  turn: number,
): void {
  const key = retryKey(payload, wave, turn);
  const timer = s.retries.get(key);
  if (timer != null) {
    clearTimeout(timer);
    s.retries.delete(key);
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
  assertBindingRole(undefined, "guest");
  const s = state();
  const g = guest();
  if (g.hasApplied(operation.id)) {
    return "duplicate";
  }
  const result = applyCoopOperationEnvelope(g, "op:revival", envelope);
  if (result !== "applied") {
    return result;
  }
  if (operation.payload.type !== "prompt") {
    cancelRetry(s, operation.payload, envelope.wave, envelope.turn);
  }
  return "applied";
}

registerCoopOperationApplier("op:revival", applyJournaledRevivalEnvelope);
