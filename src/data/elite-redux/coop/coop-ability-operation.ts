/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { COOP_CAP_OP_ABILITY, isCoopSurfaceCapabilityBlocked } from "#data/elite-redux/coop/coop-capabilities";
import { coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopApplyOutcome, CoopDurabilityManager } from "#data/elite-redux/coop/coop-durability";
import {
  type CoopAbilityPickPayload,
  type CoopAuthoritativeEnvelopeV1,
  type CoopPendingOperation,
  makeCoopOperationId,
  parseCoopOperationId,
} from "#data/elite-redux/coop/coop-operation-envelope";
import {
  applyCoopOperationEnvelope,
  getActiveCoopOperationDurability,
  isCoopOperationJournalActive,
  isCoopOperationJournalActiveFor,
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

export const COOP_ABILITY_ACTION_STRIDE = 100;
const DEFAULT_ENABLED = !(typeof process !== "undefined" && process.env?.COOP_ABILITY_OP === "off");

let enabled = DEFAULT_ENABLED;
let retryMs = 1_000;

interface AbilityOpState {
  epoch: number;
  revisionFloor: number;
  authorityHost: CoopOperationHost | null;
  receiverGuest: CoopOperationGuest | null;
  authorityOrdinalPin: number;
  authorityOrdinal: number;
  watcherOrdinalPin: number;
  watcherOrdinal: number;
  readonly retries: Map<string, ReturnType<typeof setTimeout>>;
  readonly pendingMaterializations: Set<string>;
}

registerCoopOpSurfaceState(
  "ability",
  (): AbilityOpState => ({
    epoch: 1,
    revisionFloor: 0,
    authorityHost: null,
    receiverGuest: null,
    authorityOrdinalPin: -1,
    authorityOrdinal: 0,
    watcherOrdinalPin: -1,
    watcherOrdinal: 0,
    retries: new Map(),
    pendingMaterializations: new Set(),
  }),
);

/** Opaque runtime selectors captured by a picker before any UI or async continuation. */
export interface CoopAbilityOperationBinding {
  readonly opState: CoopRuntimeOpState;
  readonly durability: CoopDurabilityManager | null;
}

/**
 * Capture the scheduling client's stable operation state. A co-op phase without an installed runtime is a
 * programming error: fail at the scheduling boundary instead of silently adopting a process-global ledger.
 */
export function captureCoopAbilityOperationBinding(): CoopAbilityOperationBinding {
  const opState = getActiveCoopRuntimeOpState();
  if (opState == null) {
    throw new Error("[coop-op] no runtime installed for surface=ability (cannot capture continuation binding)");
  }
  return { opState, durability: getActiveCoopOperationDurability() };
}

function state(binding?: CoopAbilityOperationBinding | null): AbilityOpState {
  return binding == null
    ? requireCoopOpSurfaceState<AbilityOpState>("ability")
    : requireCoopOpSurfaceStateFor<AbilityOpState>(binding.opState, "ability");
}

function journalActive(binding?: CoopAbilityOperationBinding | null): boolean {
  return binding == null ? isCoopOperationJournalActive() : isCoopOperationJournalActiveFor(binding.durability);
}

function retainEnvelope(envelope: CoopAuthoritativeEnvelopeV1, binding?: CoopAbilityOperationBinding | null): boolean {
  return binding == null
    ? tryJournalCoopCommittedEnvelope(envelope)
    : tryJournalCoopCommittedEnvelopeFor(binding.durability, envelope);
}

function isCoopOpRuntimeError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("[coop-op]");
}

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
  const s = maybeCoopOpSurfaceState<AbilityOpState>("ability");
  if (s == null || !Number.isSafeInteger(value) || value <= 0 || value === s.epoch) {
    return;
  }
  s.epoch = value;
  resetCoopAbilityOperationState();
}

export function setCoopAbilityOutcomeRetryMs(ms: number): void {
  retryMs = Math.max(1, Math.floor(ms));
}

export function resetCoopAbilityOutcomeRetryMs(): void {
  retryMs = 1_000;
}

export function resetCoopAbilityOperationState(): void {
  const s = maybeCoopOpSurfaceState<AbilityOpState>("ability");
  if (s == null) {
    return;
  }
  resetActiveCoopRuntimeClocks();
  for (const timer of s.retries.values()) {
    clearTimeout(timer);
  }
  s.retries.clear();
  s.pendingMaterializations.clear();
  s.authorityHost = null;
  s.receiverGuest = null;
  s.authorityOrdinalPin = -1;
  s.authorityOrdinal = 0;
  s.watcherOrdinalPin = -1;
  s.watcherOrdinal = 0;
  s.revisionFloor = 0;
}

export function setCoopAbilityOperationRevisionFloor(highWater: number): void {
  const s = maybeCoopOpSurfaceState<AbilityOpState>("ability");
  if (s == null || !Number.isFinite(highWater) || highWater <= 0 || highWater === s.revisionFloor) {
    return;
  }
  s.revisionFloor = highWater;
  s.authorityHost = null;
  s.receiverGuest = null;
}

function host(binding?: CoopAbilityOperationBinding | null): CoopOperationHost {
  const s = state(binding);
  s.authorityHost ??=
    binding == null
      ? CoopOperationHost.forActiveRuntime({ epoch: s.epoch, initialRevision: s.revisionFloor })
      : CoopOperationHost.forRuntime(binding.opState, { epoch: s.epoch, initialRevision: s.revisionFloor });
  return s.authorityHost;
}

function guest(binding?: CoopAbilityOperationBinding | null): CoopOperationGuest {
  const s = state(binding);
  s.receiverGuest ??=
    binding == null
      ? CoopOperationGuest.forActiveRuntime({ epoch: s.epoch, initialRevision: s.revisionFloor })
      : CoopOperationGuest.forRuntime(binding.opState, { epoch: s.epoch, initialRevision: s.revisionFloor });
  return s.receiverGuest;
}

function nextAuthorityOrdinal(s: AbilityOpState, pinned: number): number {
  if (s.authorityOrdinalPin !== pinned) {
    s.authorityOrdinalPin = pinned;
    s.authorityOrdinal = 0;
  }
  return s.authorityOrdinal++;
}

function peekWatcherOrdinal(s: AbilityOpState, pinned: number): number {
  if (s.watcherOrdinalPin !== pinned) {
    s.watcherOrdinalPin = pinned;
    s.watcherOrdinal = 0;
  }
  return s.watcherOrdinal;
}

function opId(s: AbilityOpState, pinned: number, ordinal: number): string {
  return makeCoopOperationId(
    s.epoch,
    coopInteractionOwnerSeat(pinned),
    pinned * COOP_ABILITY_ACTION_STRIDE + ordinal,
    "ABILITY_PICK",
  );
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
  pinned: number,
  data: number[],
  wave: number,
  turn: number,
  binding?: CoopAbilityOperationBinding | null,
): void {
  const s = state(binding);
  const owner = coopInteractionOwnerSeat(pinned);
  const operation: CoopPendingOperation = {
    id: opId(s, pinned, nextAuthorityOrdinal(s, pinned)),
    kind: "ABILITY_PICK",
    owner,
    status: "proposed",
    payload: { data: [...data] } satisfies CoopAbilityPickPayload,
  };
  const result = host(binding).submit(operation, context(wave, turn), intent =>
    intent.owner === owner ? { ok: true } : { ok: false, reason: "wrong-owner" },
  );
  if (result.kind === "committed") {
    retainEnvelope(result.envelope, binding);
  }
}

export function commitAbilityOwnerOutcome(
  params: {
    pinned: number;
    data: number[];
    localRole: CoopRole;
    wave: number;
    turn?: number;
  },
  binding?: CoopAbilityOperationBinding | null,
): void {
  if (!isCoopAbilityOperationEnabled() || params.localRole !== "host" || params.pinned < 0) {
    return;
  }
  try {
    commit(params.pinned, params.data, params.wave, params.turn ?? 0, binding);
  } catch (error) {
    if (isCoopOpRuntimeError(error)) {
      throw error;
    }
    coopWarn("ability", "ability op commit threw; legacy carrier remains active", error);
  }
}

export function adoptAbilityWatcherOutcome(
  params: {
    pinned: number;
    data: number[] | null;
    localRole: CoopRole;
    wave: number;
    turn?: number;
  },
  binding?: CoopAbilityOperationBinding | null,
): boolean {
  if (!isCoopAbilityOperationEnabled()) {
    return params.data != null;
  }
  if (params.data == null || params.pinned < 0) {
    return false;
  }
  const s = state(binding);
  if (params.localRole === "host") {
    commit(params.pinned, params.data, params.wave, params.turn ?? 0, binding);
    return true;
  }
  const ordinal = peekWatcherOrdinal(s, params.pinned);
  const id = opId(s, params.pinned, ordinal);
  const g = guest(binding);
  if (g.hasApplied(id)) {
    if (s.pendingMaterializations.delete(id)) {
      s.watcherOrdinal++;
      return true;
    }
    return false;
  }
  if (journalActive(binding)) {
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
    sessionEpoch: s.epoch,
    revision: g.getLastAppliedRevision() + 1,
    ...context(params.wave, params.turn ?? 0),
    pendingOperation: operation,
  });
  if (result.kind === "applied") {
    s.watcherOrdinal++;
    return true;
  }
  return false;
}

function retryKey(pinned: number, data: number[]): string {
  return `${pinned}:${JSON.stringify(data)}`;
}

export function armCoopAbilityOutcomeResend(
  pinned: number,
  data: number[],
  resend: () => void,
  binding?: CoopAbilityOperationBinding | null,
): void {
  if (!isCoopAbilityOperationEnabled()) {
    return;
  }
  const s = state(binding);
  const key = retryKey(pinned, data);
  if (s.retries.has(key)) {
    return;
  }
  const tick = () => {
    if (!s.retries.has(key)) {
      return;
    }
    try {
      resend();
    } catch (error) {
      coopWarn("ability", "ability outcome resend threw; retry remains armed", error);
    }
    if (s.retries.has(key)) {
      s.retries.set(key, setTimeout(tick, retryMs));
    }
  };
  s.retries.set(key, setTimeout(tick, retryMs));
}

function cancelRetry(s: AbilityOpState, pinned: number, data: number[]): void {
  const key = retryKey(pinned, data);
  const timer = s.retries.get(key);
  if (timer != null) {
    clearTimeout(timer);
    s.retries.delete(key);
  }
}

export function armCoopAbilityJournalMaterialization(id: string, binding?: CoopAbilityOperationBinding | null): void {
  state(binding).pendingMaterializations.add(id);
}

function applyJournaledAbilityEnvelope(envelope: CoopAuthoritativeEnvelopeV1): CoopApplyOutcome {
  if (!isCoopAbilityOperationEnabled()) {
    return "rejected";
  }
  const operation = envelope.pendingOperation;
  if (operation?.kind !== "ABILITY_PICK" || operation.status !== "applied") {
    return "rejected";
  }
  const payload = operation.payload as CoopAbilityPickPayload | undefined;
  if (payload == null || !Array.isArray(payload.data) || !payload.data.every(Number.isFinite)) {
    return "rejected";
  }
  const s = state();
  const g = guest();
  if (g.hasApplied(operation.id)) {
    return "duplicate";
  }
  const result = applyCoopOperationEnvelope(g, "op:ability", envelope);
  if (result !== "applied") {
    return "rejected";
  }
  const parsed = parseCoopOperationId(operation.id);
  if (parsed != null) {
    const pinned = Math.floor(parsed.pinnedSeq / COOP_ABILITY_ACTION_STRIDE);
    cancelRetry(s, pinned, payload.data);
  }
  return "applied";
}

registerCoopOperationApplier("op:ability", applyJournaledAbilityEnvelope);
