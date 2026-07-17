/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { COOP_CAP_OP_FAINT_SWITCH, isCoopSurfaceCapabilityBlocked } from "#data/elite-redux/coop/coop-capabilities";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopApplyOutcome, CoopDurabilityManager } from "#data/elite-redux/coop/coop-durability";
import {
  type CoopAuthoritativeEnvelopeV1,
  type CoopFaintSwitchPayload,
  type CoopPendingOperation,
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

const DEFAULT_ENABLED = !(typeof process !== "undefined" && process.env?.COOP_FAINT_SWITCH_OP === "off");
const COOP_FAINT_SWITCH_WAVE_STRIDE = 1_000_000;
const COOP_FAINT_SWITCH_TURN_STRIDE = 100;
const COOP_FAINT_SWITCH_FIELD_STRIDE = 10;

let enabled = DEFAULT_ENABLED;
let retryMs = 1_000;

/** Every mutable faint/replacement cursor and retry timer belongs to one assembled runtime. */
interface FaintSwitchOpState {
  epoch: number;
  revisionFloor: number;
  authorityHost: CoopOperationHost | null;
  receiverGuest: CoopOperationGuest | null;
  readonly retries: Map<string, ReturnType<typeof setTimeout>>;
  /** One live guest-owned picker terminal, bound to its immutable source address. */
  readonly pickerTerminals: Map<
    number,
    {
      wave: number;
      turn: number;
      consume: (payload: CoopFaintSwitchPayload, operationId: string) => boolean;
    }
  >;
  /** Picker addresses already closed by a local callback before their committed confirmation arrived. */
  readonly settledPickers: Set<string>;
}

registerCoopOpSurfaceState(
  "faintSwitch",
  (): FaintSwitchOpState => ({
    epoch: 1,
    revisionFloor: 0,
    authorityHost: null,
    receiverGuest: null,
    retries: new Map(),
    pickerTerminals: new Map(),
    settledPickers: new Set(),
  }),
);

/** Stable selectors captured before a replacement await, picker callback, or retry timer can resume. */
export interface CoopFaintSwitchOperationBinding {
  readonly opState: CoopRuntimeOpState;
  readonly durability: CoopDurabilityManager | null;
}

/** Missing runtime state is a programming error, never permission to share a process-global ledger. */
export function captureCoopFaintSwitchOperationBinding(expectedRole?: CoopRole): CoopFaintSwitchOperationBinding {
  const opState = getActiveCoopRuntimeOpState();
  if (opState == null) {
    throw new Error("[coop-op] no runtime installed for surface=faintSwitch (cannot capture continuation binding)");
  }
  if (expectedRole != null && opState.localRole != null && opState.localRole !== expectedRole) {
    throw new Error(
      `[coop-op] surface=faintSwitch binding role=${opState.localRole} cannot execute localRole=${expectedRole}`,
    );
  }
  requireCoopOpSurfaceStateFor<FaintSwitchOpState>(opState, "faintSwitch");
  return { opState, durability: getActiveCoopOperationDurability() };
}

function state(binding?: CoopFaintSwitchOperationBinding | null): FaintSwitchOpState {
  return binding == null
    ? requireCoopOpSurfaceState<FaintSwitchOpState>("faintSwitch")
    : requireCoopOpSurfaceStateFor<FaintSwitchOpState>(binding.opState, "faintSwitch");
}

function assertBindingRole(binding: CoopFaintSwitchOperationBinding | null | undefined, role: CoopRole): void {
  const opState = binding?.opState ?? getActiveCoopRuntimeOpState();
  if (opState == null) {
    throw new Error(`[coop-op] no runtime installed for surface=faintSwitch localRole=${role}`);
  }
  if (opState.localRole != null && opState.localRole !== role) {
    throw new Error(`[coop-op] surface=faintSwitch binding role=${opState.localRole} cannot execute localRole=${role}`);
  }
}

function retainEnvelope(
  envelope: CoopAuthoritativeEnvelopeV1,
  binding?: CoopFaintSwitchOperationBinding | null,
): boolean {
  return binding == null
    ? tryJournalCoopCommittedEnvelope(envelope)
    : tryJournalCoopCommittedEnvelopeFor(binding.durability, envelope);
}

function isCoopOpRuntimeError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("[coop-op]");
}

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
  const s = maybeCoopOpSurfaceState<FaintSwitchOpState>("faintSwitch");
  if (s == null) {
    return;
  }
  resetActiveCoopRuntimeClocks();
  for (const timer of s.retries.values()) {
    clearTimeout(timer);
  }
  s.retries.clear();
  s.pickerTerminals.clear();
  s.settledPickers.clear();
  s.authorityHost = null;
  s.receiverGuest = null;
  s.revisionFloor = 0;
}

export function setCoopFaintSwitchOperationRevisionFloor(highWater: number): void {
  const s = maybeCoopOpSurfaceState<FaintSwitchOpState>("faintSwitch");
  if (s == null || !Number.isFinite(highWater) || highWater <= 0 || highWater === s.revisionFloor) {
    return;
  }
  s.revisionFloor = highWater;
  s.authorityHost = null;
  s.receiverGuest = null;
}

export function setCoopFaintSwitchOperationEpoch(value: number): void {
  const s = maybeCoopOpSurfaceState<FaintSwitchOpState>("faintSwitch");
  if (s == null || !Number.isSafeInteger(value) || value <= 0 || value === s.epoch) {
    return;
  }
  s.epoch = value;
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

function host(binding?: CoopFaintSwitchOperationBinding | null): CoopOperationHost {
  const s = state(binding);
  s.authorityHost ??=
    binding == null
      ? CoopOperationHost.forActiveRuntime({ epoch: s.epoch, initialRevision: s.revisionFloor })
      : CoopOperationHost.forRuntime(binding.opState, { epoch: s.epoch, initialRevision: s.revisionFloor });
  return s.authorityHost;
}

function guest(binding?: CoopFaintSwitchOperationBinding | null): CoopOperationGuest {
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

function retryKey(payload: CoopFaintSwitchPayload, wave: number, turn: number): string {
  return `${payload.fieldIndex}:${coopFaintSwitchEventAddress(wave, turn, payload.fieldIndex)}`;
}

function cancelRetry(s: FaintSwitchOpState, payload: CoopFaintSwitchPayload): void {
  // The legacy carrier is addressed by owned field slot, while the peers may
  // temporarily observe its wave/turn from different checkpoint revisions. A
  // commit must therefore terminate retries by the stable shared identity.
  // Replacements for the same field cannot legitimately overlap.
  const fieldPrefix = `${payload.fieldIndex}:`;
  let cancelled = 0;
  for (const [key, timer] of s.retries) {
    if (key.startsWith(fieldPrefix)) {
      clearTimeout(timer);
      s.retries.delete(key);
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

export function armCoopFaintSwitchIntentResend(
  params: {
    payload: CoopFaintSwitchPayload;
    localRole: CoopRole;
    wave: number;
    turn: number;
    resend: () => void;
  },
  binding?: CoopFaintSwitchOperationBinding | null,
): void {
  if (!isCoopFaintSwitchOperationEnabled()) {
    return;
  }
  assertBindingRole(binding, params.localRole);
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
      coopWarn("replay", "faint-switch intent resend threw; retry remains armed", error);
    }
    if (s.retries.has(key)) {
      s.retries.set(key, setTimeout(tick, retryMs));
    }
  };
  s.retries.set(key, setTimeout(tick, retryMs));
}

export interface CoopFaintSwitchCommitReceipt {
  /** Null only when the negotiated operation carrier is disabled and the legacy path owns progression. */
  readonly operationId: string | null;
}

function pickerKey(wave: number, turn: number, fieldIndex: number): string {
  return `${Math.trunc(wave)}:${Math.trunc(turn)}:${Math.trunc(fieldIndex)}`;
}

function rememberSettledPicker(s: FaintSwitchOpState, key: string): void {
  s.settledPickers.add(key);
  while (s.settledPickers.size > 512) {
    s.settledPickers.delete(s.settledPickers.values().next().value!);
  }
}

/**
 * Bind the real guest picker to the immutable operation address it can terminate. The live operation
 * sink invokes this synchronously, so materialApplied cannot precede its at-most-once settled latch.
 */
export function registerCoopFaintSwitchPickerTerminal(
  params: {
    wave: number;
    turn: number;
    fieldIndex: number;
    consume: (payload: CoopFaintSwitchPayload, operationId: string) => boolean;
  },
  binding?: CoopFaintSwitchOperationBinding | null,
): () => void {
  const s = state(binding);
  const terminal = {
    wave: Math.trunc(params.wave),
    turn: Math.trunc(params.turn),
    consume: params.consume,
  };
  s.pickerTerminals.set(params.fieldIndex, terminal);
  let live = true;
  return () => {
    if (!live) {
      return;
    }
    live = false;
    if (s.pickerTerminals.get(params.fieldIndex) === terminal) {
      s.pickerTerminals.delete(params.fieldIndex);
    }
  };
}

/** Record that a local picker callback already closed this exact address before durable confirmation. */
export function markCoopFaintSwitchPickerSettled(
  wave: number,
  turn: number,
  fieldIndex: number,
  binding?: CoopFaintSwitchOperationBinding | null,
): void {
  const s = state(binding);
  rememberSettledPicker(s, pickerKey(wave, turn, fieldIndex));
  s.pickerTerminals.delete(fieldIndex);
}

/**
 * Guest live-sink terminal. True means the exact picker was already closed locally or was synchronously
 * settled now; false keeps the retained operation unacknowledged and retriable.
 */
export function materializeCoopFaintSwitchPickerTerminal(
  envelope: CoopAuthoritativeEnvelopeV1,
  binding?: CoopFaintSwitchOperationBinding | null,
): boolean {
  const operation = envelope.pendingOperation;
  const payload = operation?.payload as CoopFaintSwitchPayload | undefined;
  if (operation?.kind !== "FAINT_SWITCH" || payload == null || operation.owner !== coopSeatOfRole("guest")) {
    return true;
  }
  // No legal replacement never opens a picker; its committed sentinel is already terminal.
  if (payload.partySlot < 0) {
    return true;
  }
  const s = state(binding);
  const key = pickerKey(envelope.wave, envelope.turn, payload.fieldIndex);
  if (s.settledPickers.has(key)) {
    return true;
  }
  const terminal = s.pickerTerminals.get(payload.fieldIndex);
  if (terminal == null || terminal.wave !== envelope.wave || terminal.turn !== envelope.turn) {
    return false;
  }
  if (!terminal.consume(payload, operation.id)) {
    return false;
  }
  s.pickerTerminals.delete(payload.fieldIndex);
  rememberSettledPicker(s, key);
  return true;
}

/**
 * Commit one authoritative replacement terminal and return the retained identity needed for the
 * host's peer-material barrier. A null result is a retention failure; an enabled operation always
 * returns its exact operation id.
 */
export function commitFaintSwitchAuthorityResult(
  params: {
    payload: CoopFaintSwitchPayload;
    ownerRole: CoopRole;
    localRole: CoopRole;
    wave: number;
    turn: number;
  },
  binding?: CoopFaintSwitchOperationBinding | null,
): CoopFaintSwitchCommitReceipt | null {
  if (!isCoopFaintSwitchOperationEnabled()) {
    return { operationId: null };
  }
  assertBindingRole(binding, params.localRole);
  if (params.localRole !== "host") {
    return { operationId: null };
  }
  try {
    const s = state(binding);
    const owner = coopSeatOfRole(params.ownerRole);
    const operation: CoopPendingOperation = {
      id: makeCoopOperationId(
        s.epoch,
        owner,
        coopFaintSwitchOperationAddress(params.wave, params.turn, params.payload.fieldIndex, params.payload.partySlot),
        "FAINT_SWITCH",
      ),
      kind: "FAINT_SWITCH",
      owner,
      status: "proposed",
      payload: { ...params.payload, data: [...params.payload.data] },
    };
    const result = host(binding).submit(operation, context(params.wave, params.turn), intent =>
      intent.owner === owner ? { ok: true } : { ok: false, reason: "wrong-owner" },
    );
    if (result.kind === "committed" || result.kind === "reack") {
      if (!retainEnvelope(result.envelope, binding)) {
        coopWarn("replay", `faint-switch op could not retain rev=${result.envelope.revision} id=${operation.id}`);
        return null;
      }
      return { operationId: operation.id };
    }
    return null;
  } catch (error) {
    if (isCoopOpRuntimeError(error)) {
      throw error;
    }
    coopWarn("replay", "faint-switch op commit threw; legacy carrier/fallback remains active", error);
    return null;
  }
}

/** Compatibility boolean for existing synchronous callers and engine-free contracts. */
export function commitFaintSwitchAuthorityIntent(
  params: Parameters<typeof commitFaintSwitchAuthorityResult>[0],
  binding?: CoopFaintSwitchOperationBinding | null,
): boolean {
  return commitFaintSwitchAuthorityResult(params, binding) != null;
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
  assertBindingRole(undefined, "guest");
  const s = state();
  const g = guest();
  if (g.hasApplied(operation.id)) {
    return "duplicate";
  }
  const result = applyCoopOperationEnvelope(g, "op:faintSwitch", envelope);
  if (result !== "applied") {
    return "rejected";
  }
  cancelRetry(s, operation.payload);
  return "applied";
}

registerCoopOperationApplier("op:faintSwitch", applyJournaledFaintSwitchEnvelope);
