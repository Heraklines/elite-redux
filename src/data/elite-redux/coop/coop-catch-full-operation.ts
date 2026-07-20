/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { isCompleteCoopOperationAuthorityState } from "#data/elite-redux/coop/coop-authority-state-validator";
import { COOP_CAP_OP_CATCH_FULL, isCoopSurfaceCapabilityBlocked } from "#data/elite-redux/coop/coop-capabilities";
import { coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopApplyOutcome, CoopDurabilityManager } from "#data/elite-redux/coop/coop-durability";
import type { CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import {
  type CoopAuthoritativeEnvelopeV1,
  type CoopCatchFullPayload,
  type CoopPendingOperation,
  makeCoopOperationId,
  parseCoopOperationId,
} from "#data/elite-redux/coop/coop-operation-envelope";
import {
  applyCoopOperationEnvelope,
  type CoopOperationEnvelopeApplyContext,
  getActiveCoopOperationDurability,
  isCoopOperationAuthorityV2Apply,
  registerCoopOperationApplier,
  tryJournalCoopCommittedEnvelope,
  tryJournalCoopCommittedEnvelopeFor,
} from "#data/elite-redux/coop/coop-operation-journal";
import {
  CoopOperationGuest,
  CoopOperationHost,
  type CoopRuntimeOpState,
  coopOperationCommitContext,
  getActiveCoopRuntimeOpState,
  maybeCoopOpSurfaceState,
  registerCoopOpSurfaceState,
  requireCoopOpSurfaceState,
  requireCoopOpSurfaceStateFor,
  resetActiveCoopRuntimeClocks,
} from "#data/elite-redux/coop/coop-operation-runtime";
import { coopSeatOfRole } from "#data/elite-redux/coop/coop-session";
import type { CoopRole } from "#data/elite-redux/coop/coop-transport";

const DEFAULT_ENABLED = !(typeof process !== "undefined" && process.env?.COOP_CATCH_FULL_OP === "off");

let enabled = DEFAULT_ENABLED;
let retryMs = 1_000;

interface CatchFullOpState {
  epoch: number;
  revisionFloor: number;
  ordinal: number;
  authorityHost: CoopOperationHost | null;
  receiverGuest: CoopOperationGuest | null;
  readonly retries: Map<string, ReturnType<typeof setTimeout>>;
  readonly stateAppliedOperations: Set<string>;
}

registerCoopOpSurfaceState(
  "catchFull",
  (): CatchFullOpState => ({
    epoch: 1,
    revisionFloor: 0,
    ordinal: 0,
    authorityHost: null,
    receiverGuest: null,
    retries: new Map(),
    stateAppliedOperations: new Set(),
  }),
);

/** Stable runtime selectors carried across the host await and the guest's asynchronous picker callbacks. */
export interface CoopCatchFullOperationBinding {
  readonly opState: CoopRuntimeOpState;
  readonly durability: CoopDurabilityManager | null;
}

/** Capture the scheduling client before an async continuation can install its peer as the ambient runtime. */
export function captureCoopCatchFullOperationBinding(): CoopCatchFullOperationBinding {
  const opState = getActiveCoopRuntimeOpState();
  if (opState == null) {
    throw new Error("[coop-op] no runtime installed for surface=catchFull (cannot capture continuation binding)");
  }
  return { opState, durability: getActiveCoopOperationDurability() };
}

function state(binding?: CoopCatchFullOperationBinding | null): CatchFullOpState {
  return binding == null
    ? requireCoopOpSurfaceState<CatchFullOpState>("catchFull")
    : requireCoopOpSurfaceStateFor<CatchFullOpState>(binding.opState, "catchFull");
}

function retainEnvelope(
  envelope: CoopAuthoritativeEnvelopeV1,
  binding?: CoopCatchFullOperationBinding | null,
): boolean {
  return binding == null
    ? tryJournalCoopCommittedEnvelope(envelope)
    : tryJournalCoopCommittedEnvelopeFor(binding.durability, envelope);
}

function isCoopOpRuntimeError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("[coop-op]");
}

export function isCoopCatchFullOperationEnabled(): boolean {
  return enabled && !isCoopSurfaceCapabilityBlocked(COOP_CAP_OP_CATCH_FULL);
}

export function setCoopCatchFullOperationEnabled(value: boolean): void {
  enabled = value;
}

export function resetCoopCatchFullOperationFlag(): void {
  enabled = DEFAULT_ENABLED;
}

export function setCoopCatchFullRetryMs(ms: number): void {
  retryMs = Math.max(1, Math.floor(ms));
}

export function resetCoopCatchFullRetryMs(): void {
  retryMs = 1_000;
}

export function resetCoopCatchFullOperationState(): void {
  const s = maybeCoopOpSurfaceState<CatchFullOpState>("catchFull");
  if (s == null) {
    return;
  }
  resetActiveCoopRuntimeClocks();
  for (const timer of s.retries.values()) {
    clearTimeout(timer);
  }
  s.retries.clear();
  s.stateAppliedOperations.clear();
  s.authorityHost = null;
  s.receiverGuest = null;
  s.revisionFloor = 0;
  s.ordinal = 0;
}

export function setCoopCatchFullOperationRevisionFloor(highWater: number): void {
  const s = maybeCoopOpSurfaceState<CatchFullOpState>("catchFull");
  if (s == null || !Number.isFinite(highWater) || highWater <= 0 || highWater === s.revisionFloor) {
    return;
  }
  s.revisionFloor = highWater;
  s.ordinal = 0;
  s.authorityHost = null;
  s.receiverGuest = null;
}

export function setCoopCatchFullOperationEpoch(value: number): void {
  const s = maybeCoopOpSurfaceState<CatchFullOpState>("catchFull");
  if (s == null || !Number.isSafeInteger(value) || value <= 0 || value === s.epoch) {
    return;
  }
  s.epoch = value;
  resetCoopCatchFullOperationState();
}

function host(binding?: CoopCatchFullOperationBinding | null): CoopOperationHost {
  const s = state(binding);
  s.authorityHost ??=
    binding == null
      ? CoopOperationHost.forActiveRuntime({ epoch: s.epoch, initialRevision: s.revisionFloor })
      : CoopOperationHost.forRuntime(binding.opState, { epoch: s.epoch, initialRevision: s.revisionFloor });
  return s.authorityHost;
}

function guest(binding?: CoopCatchFullOperationBinding | null): CoopOperationGuest {
  const s = state(binding);
  s.receiverGuest ??=
    binding == null
      ? CoopOperationGuest.forActiveRuntime({ epoch: s.epoch, initialRevision: s.revisionFloor })
      : CoopOperationGuest.forRuntime(binding.opState, { epoch: s.epoch, initialRevision: s.revisionFloor });
  return s.receiverGuest;
}

function context(wave: number, turn: number) {
  return coopOperationCommitContext(wave, turn, "TURN_RESOLVE");
}

function commitAction(
  params: {
    payload: CoopCatchFullPayload;
    ownerRole: CoopRole;
    localRole: CoopRole;
    wave: number;
    turn: number;
    operationId?: string;
  },
  binding?: CoopCatchFullOperationBinding | null,
): string | undefined {
  if (!isCoopCatchFullOperationEnabled() || params.localRole !== "host") {
    return;
  }
  try {
    const s = state(binding);
    const owner = coopSeatOfRole(params.ownerRole);
    const suppliedAddress = params.operationId == null ? null : parseCoopOperationId(params.operationId);
    if (
      params.operationId != null
      && (suppliedAddress == null
        || suppliedAddress.epoch !== s.epoch
        || suppliedAddress.owner !== owner
        || suppliedAddress.kind !== "CATCH_FULL"
        || suppliedAddress.pinnedSeq <= s.revisionFloor)
    ) {
      return;
    }
    if (suppliedAddress != null) {
      s.ordinal = Math.max(s.ordinal, suppliedAddress.pinnedSeq - s.revisionFloor);
    }
    const operation: CoopPendingOperation = {
      id: params.operationId ?? makeCoopOperationId(s.epoch, owner, s.revisionFloor + ++s.ordinal, "CATCH_FULL"),
      kind: "CATCH_FULL",
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
          `catch-full op could not retain rev=${result.envelope.revision} id=${operation.id}; refusing raw continuation`,
        );
        return;
      }
      return result.envelope.pendingOperation?.id;
    }
  } catch (error) {
    if (isCoopOpRuntimeError(error)) {
      throw error;
    }
    coopWarn("replay", "catch-full op commit threw; refusing the unretained continuation", error);
  }
  return;
}

/** The decision immediately succeeds one exact catch-full prompt; no local ordinal may be guessed. */
export function coopCatchFullDecisionOperationId(promptOperationId: string): string | null {
  const parsed = parseCoopOperationId(promptOperationId);
  if (parsed == null || parsed.kind !== "CATCH_FULL" || parsed.owner !== coopSeatOfRole("guest")) {
    return null;
  }
  return makeCoopOperationId(parsed.epoch, parsed.owner, parsed.pinnedSeq + 1, "CATCH_FULL");
}

/** Journal the presentation before sending its low-latency legacy carrier. */
export function sendCoopCatchFullPromptWithOperationId(
  relay: CoopInteractionRelay,
  pokemonName: string,
  speciesId: number,
  params: { localRole: CoopRole; wave: number; turn: number },
  binding?: CoopCatchFullOperationBinding | null,
): string | null {
  if (!isCoopCatchFullOperationEnabled()) {
    relay.promptCatchFull(pokemonName, speciesId);
    return "legacy";
  }
  const operationId = commitAction(
    {
      payload: { type: "prompt", pokemonName, speciesId },
      ownerRole: "guest",
      ...params,
    },
    binding,
  );
  if (operationId == null) {
    return null;
  }
  relay.promptCatchFull(pokemonName, speciesId, operationId);
  return operationId;
}

export function sendCoopCatchFullPrompt(
  relay: CoopInteractionRelay,
  pokemonName: string,
  speciesId: number,
  params: { localRole: CoopRole; wave: number; turn: number },
  binding?: CoopCatchFullOperationBinding | null,
): boolean {
  return sendCoopCatchFullPromptWithOperationId(relay, pokemonName, speciesId, params, binding) != null;
}

export function commitCoopCatchFullAuthorityDecision(
  params: {
    payload: Extract<CoopCatchFullPayload, { type: "decision" }>;
    ownerRole: CoopRole;
    localRole: CoopRole;
    wave: number;
    turn: number;
    operationId?: string;
  },
  binding?: CoopCatchFullOperationBinding | null,
): boolean {
  if (!isCoopCatchFullOperationEnabled()) {
    return true;
  }
  return commitAction(params, binding) != null;
}

function retryKey(payload: Extract<CoopCatchFullPayload, { type: "decision" }>): string {
  return `${payload.speciesId}:${payload.partySlot}`;
}

export function armCoopCatchFullIntentResend(
  params: {
    payload: Extract<CoopCatchFullPayload, { type: "decision" }>;
    wave: number;
    turn: number;
    resend: () => void;
  },
  binding?: CoopCatchFullOperationBinding | null,
): void {
  if (!isCoopCatchFullOperationEnabled()) {
    return;
  }
  const s = state(binding);
  const key = retryKey(params.payload);
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
      coopWarn("replay", "catch-full intent resend threw; retry remains armed", error);
    }
    if (s.retries.has(key)) {
      s.retries.set(key, setTimeout(tick, retryMs));
    }
  };
  s.retries.set(key, setTimeout(tick, retryMs));
}

function cancelRetry(s: CatchFullOpState, payload: Extract<CoopCatchFullPayload, { type: "decision" }>): void {
  const key = retryKey(payload);
  const timer = s.retries.get(key);
  if (timer != null) {
    clearTimeout(timer);
    s.retries.delete(key);
  }
}

function validPayload(value: unknown): value is CoopCatchFullPayload {
  const payload = value as CoopCatchFullPayload | undefined;
  if (payload == null || !Number.isSafeInteger(payload.speciesId) || payload.speciesId <= 0) {
    return false;
  }
  if (payload.type === "prompt") {
    return typeof payload.pokemonName === "string" && payload.pokemonName.length > 0;
  }
  return (
    payload.type === "decision"
    && Number.isSafeInteger(payload.partySlot)
    && payload.partySlot >= -1
    && payload.partySlot < 6
  );
}

function applyJournaledCatchFullEnvelope(
  envelope: CoopAuthoritativeEnvelopeV1,
  applyContext?: CoopOperationEnvelopeApplyContext,
): CoopApplyOutcome {
  if (!isCoopCatchFullOperationEnabled()) {
    return "rejected";
  }
  const operation = envelope.pendingOperation;
  if (operation?.kind !== "CATCH_FULL" || operation.status !== "applied") {
    return "rejected";
  }
  if (!validPayload(operation.payload)) {
    return "rejected";
  }
  const s = state();
  const g = guest();
  if (!isCoopOperationAuthorityV2Apply(applyContext) && g.hasApplied(operation.id)) {
    return "duplicate";
  }
  if (isCoopOperationAuthorityV2Apply(applyContext)) {
    if (!isCompleteCoopOperationAuthorityState(envelope.authoritativeState, envelope.wave, envelope.turn)) {
      return "rejected";
    }
    // Authority V2 owns one central immutable-state transaction. The surface applier only records that
    // result for its UI adoption seam; applying the same tick again would reject it as stale.
    s.stateAppliedOperations.add(operation.id);
  }
  const result = applyCoopOperationEnvelope(g, "op:catchFull", envelope, applyContext);
  if (result !== "applied") {
    return result;
  }
  if (operation.payload.type !== "prompt") {
    cancelRetry(s, operation.payload);
  }
  return "applied";
}

registerCoopOperationApplier("op:catchFull", applyJournaledCatchFullEnvelope);
