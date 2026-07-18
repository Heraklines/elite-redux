/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  activeCoopV2ShadowSessionEpoch,
  isCoopV2ShadowActive,
  tapCoopV2ShadowReplacementCommit,
} from "#data/elite-redux/coop/authority-v2/shadow";
import { COOP_CAP_OP_FAINT_SWITCH, isCoopSurfaceCapabilityBlocked } from "#data/elite-redux/coop/coop-capabilities";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopApplyOutcome, CoopDurabilityManager } from "#data/elite-redux/coop/coop-durability";
import {
  COOP_FAINT_SWITCH_SEQ_BASE,
  type CoopInteractionChoice,
  type CoopInteractionRelay,
} from "#data/elite-redux/coop/coop-interaction-relay";
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
import { COOP_SWITCH_CHOICE_KINDS } from "#data/elite-redux/coop/coop-seq-registry";
import { coopSeatOfRole } from "#data/elite-redux/coop/coop-session";
import type { CoopAuthoritativeBattleStateV1, CoopRole } from "#data/elite-redux/coop/coop-transport";

const DEFAULT_ENABLED = !(typeof process !== "undefined" && process.env?.COOP_FAINT_SWITCH_OP === "off");
// Decimal packing stays exactly representable below Number.MAX_SAFE_INTEGER. Wave count is bounded
// far above today's longest modes, while the larger per-wave budget keeps pathological stall battles
// uniquely addressable through 99,999 turns instead of aliasing or silently clamping.
const COOP_FAINT_SWITCH_WAVE_STRIDE = 100_000_000_000;
const COOP_FAINT_SWITCH_TURN_STRIDE = 1_000_000;
const COOP_FAINT_SWITCH_OCCURRENCE_STRIDE = 100;
const COOP_FAINT_SWITCH_FIELD_STRIDE = 10;
const COOP_FAINT_SWITCH_ID_EPOCH_INDEX = 2;
const COOP_FAINT_SWITCH_ID_ADDRESS_INDEX = 3;
const COOP_FAINT_SWITCH_RESOLUTION_INDEX = 4;
const COOP_FAINT_SWITCH_OCCURRENCE_INDEX = 5;
const COOP_FAINT_SWITCH_MAX_WAVE = 90_000;
const COOP_FAINT_SWITCH_MAX_TURN = 99_999;
const COOP_FAINT_SWITCH_MAX_OCCURRENCE = 9_999;

export const COOP_FAINT_SWITCH_RESOLUTION_OWNER = 0;
export const COOP_FAINT_SWITCH_RESOLUTION_FALLBACK = 1;
export const COOP_FAINT_SWITCH_RESOLUTION_NONE = 2;

/** Immutable event-source address carried from the faint through delayed host and renderer phases. */
export interface CoopFaintSourceAddress {
  readonly wave: number;
  readonly turn: number;
  /** Authority-issued per-turn faint-event sequence. */
  readonly occurrence: number;
}

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
      occurrence: number;
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

function boundedAddressPart(value: number, max: number, label: string): number {
  const normalized = Math.trunc(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0 || normalized > max) {
    throw new Error(`[coop-op] invalid faint-switch ${label}=${value}`);
  }
  return normalized;
}

function coopFaintSwitchEventAddress(wave: number, turn: number, fieldIndex: number, occurrence = 0): number {
  return (
    boundedAddressPart(wave, COOP_FAINT_SWITCH_MAX_WAVE, "wave") * COOP_FAINT_SWITCH_WAVE_STRIDE
    + boundedAddressPart(turn, COOP_FAINT_SWITCH_MAX_TURN, "turn") * COOP_FAINT_SWITCH_TURN_STRIDE
    + boundedAddressPart(occurrence, COOP_FAINT_SWITCH_MAX_OCCURRENCE, "occurrence")
      * COOP_FAINT_SWITCH_OCCURRENCE_STRIDE
    + boundedAddressPart(fieldIndex, 3, "fieldIndex") * COOP_FAINT_SWITCH_FIELD_STRIDE
  );
}

export function coopFaintSwitchOperationAddress(
  wave: number,
  turn: number,
  fieldIndex: number,
  partySlot: number,
  occurrence = 0,
): number {
  return (
    coopFaintSwitchEventAddress(wave, turn, fieldIndex, occurrence) + boundedAddressPart(partySlot + 1, 9, "partySlot")
  );
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

function retryKey(
  payload: CoopFaintSwitchPayload,
  wave: number,
  turn: number,
  occurrence = 0,
  binding?: CoopFaintSwitchOperationBinding | null,
): string {
  const s = state(binding);
  // This identifies the owner's one proposal WINDOW, not its proposed result. Authority may legally
  // remap the slot by species identity or commit a different fallback; either terminal must still
  // close the original proposal retry without touching another turn's same-field window.
  return `${s.epoch}:${coopSeatOfRole("guest")}:${Math.trunc(wave)}:${Math.trunc(turn)}:${Math.trunc(occurrence)}:${Math.trunc(payload.fieldIndex)}:FAINT_SWITCH_PROPOSAL`;
}

function cancelRetry(s: FaintSwitchOpState, retryWindow: string, operationId: string): void {
  const timer = s.retries.get(retryWindow);
  if (timer != null) {
    clearTimeout(timer);
    s.retries.delete(retryWindow);
    coopLog(
      "replay",
      `faint-switch authority APPLIED op=${operationId} window=${retryWindow} -> cancelled exact intent retry`,
    );
  }
}

/**
 * Add the immutable proposal address to the legacy numeric metadata. This keeps the wire union stable
 * while preventing a delayed same-slot raw proposal from being consumed by a later replacement window.
 */
export function addressCoopFaintSwitchChoiceData(
  data: readonly number[],
  params: {
    wave: number;
    turn: number;
    occurrence?: number;
    fieldIndex: number;
    partySlot: number;
    resolution: number;
  },
  binding?: CoopFaintSwitchOperationBinding | null,
): number[] {
  const addressed = [...data];
  // Densify the legacy metadata block below the address stamp. A short legacy base (`[0]` /
  // `[1]`) leaves index 1 a HOLE after the indexed writes below; the hole survives the JSON
  // round-trip as null, and the guest applier's validPayload (`data.every(Number.isFinite)`)
  // then hard-rejects the whole committed operation - so every HOST-owned replacement op was
  // permanently rejected by every guest (the live faint-stall class; gate 29598888047
  // B1/B7/B8/B10/B12 + S4: bounded recovery exhausted -> shared session terminal at faints).
  for (let i = 0; i < COOP_FAINT_SWITCH_ID_EPOCH_INDEX; i++) {
    if (!Number.isFinite(addressed[i])) {
      addressed[i] = 0;
    }
  }
  addressed[COOP_FAINT_SWITCH_ID_EPOCH_INDEX] = state(binding).epoch;
  addressed[COOP_FAINT_SWITCH_ID_ADDRESS_INDEX] = coopFaintSwitchOperationAddress(
    params.wave,
    params.turn,
    params.fieldIndex,
    params.partySlot,
    params.occurrence ?? 0,
  );
  addressed[COOP_FAINT_SWITCH_RESOLUTION_INDEX] = params.resolution;
  addressed[COOP_FAINT_SWITCH_OCCURRENCE_INDEX] = params.occurrence ?? 0;
  return addressed;
}

function matchesCoopFaintSwitchChoiceAddress(
  choice: CoopInteractionChoice,
  params: { wave: number; turn: number; occurrence?: number; fieldIndex: number },
  binding?: CoopFaintSwitchOperationBinding | null,
): boolean {
  const data = choice.data;
  try {
    return (
      data?.[COOP_FAINT_SWITCH_ID_EPOCH_INDEX] === state(binding).epoch
      && data[COOP_FAINT_SWITCH_OCCURRENCE_INDEX] === (params.occurrence ?? 0)
      && data[COOP_FAINT_SWITCH_ID_ADDRESS_INDEX]
        === coopFaintSwitchOperationAddress(
          params.wave,
          params.turn,
          params.fieldIndex,
          choice.choice,
          params.occurrence ?? 0,
        )
    );
  } catch {
    return false;
  }
}

/**
 * Await the next proposal for one immutable faint window. Stale same-slot frames are consumed and
 * rejected, never left buffered for this or any later replacement.
 */
export async function awaitAddressedCoopFaintSwitchChoice(
  relay: CoopInteractionRelay,
  params: {
    wave: number;
    turn: number;
    occurrence?: number;
    fieldIndex: number;
    timeoutMs: number;
  },
  binding?: CoopFaintSwitchOperationBinding | null,
): Promise<CoopInteractionChoice | null> {
  const deadline = Date.now() + Math.max(0, params.timeoutMs);
  do {
    const remaining = Math.max(0, deadline - Date.now());
    const choice = await relay.awaitInteractionChoice(
      COOP_FAINT_SWITCH_SEQ_BASE + params.fieldIndex,
      remaining,
      COOP_SWITCH_CHOICE_KINDS,
    );
    if (choice == null || !isCoopFaintSwitchOperationEnabled()) {
      return choice;
    }
    if (matchesCoopFaintSwitchChoiceAddress(choice, params, binding)) {
      return choice;
    }
    coopWarn(
      "replay",
      `dropped stale faint-switch proposal field=${params.fieldIndex} expected=${params.wave}:${params.turn} `
        + `choice=${choice.choice} data=[${choice.data?.join(",") ?? ""}]`,
    );
  } while (Date.now() < deadline);
  return null;
}

export function armCoopFaintSwitchIntentResend(
  params: {
    payload: CoopFaintSwitchPayload;
    localRole: CoopRole;
    wave: number;
    turn: number;
    occurrence?: number;
    resend: () => void;
  },
  binding?: CoopFaintSwitchOperationBinding | null,
): void {
  if (!isCoopFaintSwitchOperationEnabled()) {
    return;
  }
  assertBindingRole(binding, params.localRole);
  const s = state(binding);
  const key = retryKey(params.payload, params.wave, params.turn, params.occurrence ?? 0, binding);
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

function pickerKey(wave: number, turn: number, occurrence: number, fieldIndex: number): string {
  return `${Math.trunc(wave)}:${Math.trunc(turn)}:${Math.trunc(occurrence)}:${Math.trunc(fieldIndex)}`;
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
    occurrence?: number;
    fieldIndex: number;
    consume: (payload: CoopFaintSwitchPayload, operationId: string) => boolean;
  },
  binding?: CoopFaintSwitchOperationBinding | null,
): () => void {
  const s = state(binding);
  const terminal = {
    wave: Math.trunc(params.wave),
    turn: Math.trunc(params.turn),
    occurrence: Math.trunc(params.occurrence ?? 0),
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
  occurrence = 0,
): void {
  const s = state(binding);
  rememberSettledPicker(s, pickerKey(wave, turn, occurrence, fieldIndex));
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
  const s = state(binding);
  const occurrence = payload.data[COOP_FAINT_SWITCH_OCCURRENCE_INDEX] ?? 0;
  const key = pickerKey(envelope.wave, envelope.turn, occurrence, payload.fieldIndex);
  if (s.settledPickers.has(key)) {
    return true;
  }
  const terminal = s.pickerTerminals.get(payload.fieldIndex);
  if (
    terminal == null
    || terminal.wave !== envelope.wave
    || terminal.turn !== envelope.turn
    || terminal.occurrence !== occurrence
  ) {
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
 * Deliverable 4: build + fire the REPLACEMENT_COMMIT shadow tap from the raw faint params, WITHOUT the
 * op-surface state (this lane has it rolled back). The session epoch is sourced from the active harness's
 * authenticated frame context (the same authenticated epoch the harness stamps), so the v2 address is
 * well-formed; a non-positive epoch/wave/turn simply skips the tap rather than committing a malformed
 * proposal. The comparand is like-for-like (the same resolved proposal fingerprinted through the faint
 * adapter's own image digest), matching the op-surface-enabled tap. Shadow only - it never authorizes.
 */
function tapFaintReplacementShadowFromParams(params: {
  payload: CoopFaintSwitchPayload;
  ownerRole: CoopRole;
  wave: number;
  turn: number;
  occurrence?: number;
  speciesId?: number;
}): void {
  const epoch = activeCoopV2ShadowSessionEpoch();
  if (epoch == null || epoch <= 0 || !(params.wave > 0) || !(params.turn > 0)) {
    return;
  }
  const owner = coopSeatOfRole(params.ownerRole);
  const occurrence = params.occurrence ?? params.payload.data[COOP_FAINT_SWITCH_OCCURRENCE_INDEX] ?? 0;
  const resolutionCode = params.payload.data[COOP_FAINT_SWITCH_RESOLUTION_INDEX];
  const speciesId = params.speciesId ?? params.payload.data[1] ?? 0;
  const noReplacement = resolutionCode === COOP_FAINT_SWITCH_RESOLUTION_NONE;
  const selected =
    noReplacement || !(speciesId > 0) || params.payload.partySlot < 0
      ? null
      : { partySlot: params.payload.partySlot, speciesId };
  const proposal = {
    sourceAddress: {
      epoch,
      wave: params.wave,
      turn: params.turn,
      occurrence,
      fieldIndex: params.payload.fieldIndex,
    },
    ownerSeatId: owner,
    selected,
  };
  const resolution = resolutionCode === COOP_FAINT_SWITCH_RESOLUTION_OWNER ? "owner-pick" : "fallback-auto";
  tapCoopV2ShadowReplacementCommit({
    proposal,
    resolution,
    successor: { kind: "terminal" },
    legacyImage: { proposal, resolution },
    // No legacy carrier op id exists in this lane (op surface off); derive the adapter's own stable window
    // address as the raw fallback token, so the parity line has a meaningful comparand.
    legacyDigest: `RC/e${epoch}/w${params.wave}/t${params.turn}/o${occurrence}/f${params.payload.fieldIndex}/s${owner}`,
  });
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
    occurrence?: number;
    /**
     * The picked replacement's species id (#799 identity, promoted out of `data[1]`). OPTIONAL and UNUSED
     * by the legacy carrier (which resolves by slot) - it is threaded only so the authority-v2 shadow
     * REPLACEMENT tap can name the species in its typed proposal instead of a bare slot. Absent -> the tap
     * falls back to `payload.data[1]`. Populated at the call sites from `authoritativePick?.species?.speciesId`.
     */
    speciesId?: number;
  },
  binding?: CoopFaintSwitchOperationBinding | null,
): CoopFaintSwitchCommitReceipt | null {
  if (!isCoopFaintSwitchOperationEnabled()) {
    // Deliverable 4: the op surface is rolled back in THIS lane (the legacy carrier resolves the faint), but a
    // faint still happened - so still emit the REPLACEMENT_COMMIT shadow tap on the HOST, with a like-for-like
    // comparand, so faint-bearing lanes retain parity evidence instead of only op-surface-enabled ones. The
    // tap is host-only (the authority), harness-gated, and self-guarded (a throw is a logged shadow FAULT,
    // never propagated) - it can never affect the legacy carrier.
    if (params.localRole === "host" && isCoopV2ShadowActive()) {
      tapFaintReplacementShadowFromParams(params);
    }
    return { operationId: null };
  }
  assertBindingRole(binding, params.localRole);
  if (params.localRole !== "host") {
    return { operationId: null };
  }
  try {
    const s = state(binding);
    const owner = coopSeatOfRole(params.ownerRole);
    const occurrence = params.occurrence ?? params.payload.data[COOP_FAINT_SWITCH_OCCURRENCE_INDEX] ?? 0;
    if (
      params.payload.data[COOP_FAINT_SWITCH_OCCURRENCE_INDEX] != null
      && params.payload.data[COOP_FAINT_SWITCH_OCCURRENCE_INDEX] !== occurrence
    ) {
      return null;
    }
    const operation: CoopPendingOperation = {
      id: makeCoopOperationId(
        s.epoch,
        owner,
        coopFaintSwitchOperationAddress(
          params.wave,
          params.turn,
          params.payload.fieldIndex,
          params.payload.partySlot,
          occurrence,
        ),
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
      // authority-v2 SHADOW tap (contract change request 4): mirror this committed replacement into the v2
      // shadow harness for parity evidence. Null-guarded (no-op unless a harness is active) + the tap runs
      // under the harness's own try/catch, so a shadow fault is logged, never thrown back into the legacy
      // commit. Legacy still owns the replacement entirely; this only records + compares alongside it.
      if (isCoopV2ShadowActive()) {
        const resolutionCode = params.payload.data[COOP_FAINT_SWITCH_RESOLUTION_INDEX];
        const speciesId = params.speciesId ?? params.payload.data[1] ?? 0;
        const noReplacement = resolutionCode === COOP_FAINT_SWITCH_RESOLUTION_NONE;
        const selected =
          noReplacement || !(speciesId > 0) || params.payload.partySlot < 0
            ? null
            : { partySlot: params.payload.partySlot, speciesId };
        const proposal = {
          sourceAddress: {
            epoch: s.epoch,
            wave: params.wave,
            turn: params.turn,
            occurrence,
            fieldIndex: params.payload.fieldIndex,
          },
          ownerSeatId: owner,
          selected,
        };
        const resolution = resolutionCode === COOP_FAINT_SWITCH_RESOLUTION_OWNER ? "owner-pick" : "fallback-auto";
        tapCoopV2ShadowReplacementCommit({
          proposal,
          resolution,
          successor: { kind: "terminal" },
          operationId: operation.id,
          // Deliverable 1: fingerprint the LEGACY replacement image (the same resolved proposal the legacy
          // carrier committed) through the faint adapter's OWN image digest, so the shadow compares
          // like-for-like (v2 entry digest vs v2-digest-of-legacy-image) - a mismatch means the resolved
          // STATES differ, not the encodings. The legacy op id stays only as the raw fallback token.
          legacyImage: { proposal, resolution },
          legacyDigest: operation.id,
        });
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
    // "deferred" here is the guest picker/watcher not being open yet (engine pacing): the entry parks
    // and re-applies locally instead of exhausting bounded recovery into a shared session terminal.
    return result;
  }
  cancelRetry(
    s,
    retryKey(
      operation.payload,
      envelope.wave,
      envelope.turn,
      operation.payload.data[COOP_FAINT_SWITCH_OCCURRENCE_INDEX] ?? 0,
    ),
    operation.id,
  );
  return "applied";
}

registerCoopOperationApplier("op:faintSwitch", applyJournaledFaintSwitchEnvelope);
