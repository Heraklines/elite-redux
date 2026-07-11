/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { COOP_CAP_OP_CATCH_FULL, isCoopSurfaceCapabilityBlocked } from "#data/elite-redux/coop/coop-capabilities";
import { coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopApplyOutcome } from "#data/elite-redux/coop/coop-durability";
import type { CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import {
  type CoopAuthoritativeEnvelopeV1,
  type CoopCatchFullPayload,
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

const DEFAULT_ENABLED = !(typeof process !== "undefined" && process.env?.COOP_CATCH_FULL_OP === "off");

let enabled = DEFAULT_ENABLED;
let epoch = 1;
let revisionFloor = 0;
let ordinal = 0;
let authorityHost: CoopOperationHost | null = null;
let receiverGuest: CoopOperationGuest | null = null;
let retryMs = 1_000;
const retries = new Map<string, ReturnType<typeof setTimeout>>();

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
  for (const timer of retries.values()) {
    clearTimeout(timer);
  }
  retries.clear();
  authorityHost = null;
  receiverGuest = null;
  revisionFloor = 0;
  ordinal = 0;
}

export function setCoopCatchFullOperationRevisionFloor(highWater: number): void {
  if (!Number.isFinite(highWater) || highWater <= 0 || highWater === revisionFloor) {
    return;
  }
  revisionFloor = highWater;
  ordinal = 0;
  authorityHost = null;
  receiverGuest = null;
}

export function setCoopCatchFullOperationEpoch(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value === epoch) {
    return;
  }
  epoch = value;
  resetCoopCatchFullOperationState();
}

function host(): CoopOperationHost {
  authorityHost ??= new CoopOperationHost({ epoch, initialRevision: revisionFloor });
  return authorityHost;
}

function guest(): CoopOperationGuest {
  receiverGuest ??= new CoopOperationGuest({ epoch, initialRevision: revisionFloor });
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

function commitAction(params: {
  payload: CoopCatchFullPayload;
  ownerRole: CoopRole;
  localRole: CoopRole;
  wave: number;
  turn: number;
}): string | undefined {
  if (!isCoopCatchFullOperationEnabled() || params.localRole !== "host") {
    return;
  }
  try {
    const owner = coopSeatOfRole(params.ownerRole);
    const operation: CoopPendingOperation = {
      id: makeCoopOperationId(epoch, owner, revisionFloor + ++ordinal),
      kind: "CATCH_FULL",
      owner,
      status: "proposed",
      payload: { ...params.payload },
    };
    const result = host().submit(operation, context(params.wave, params.turn), intent =>
      intent.owner === owner ? { ok: true } : { ok: false, reason: "wrong-owner" },
    );
    if (result.kind === "committed") {
      journalCoopCommittedEnvelope(result.envelope);
      return result.envelope.pendingOperation?.id;
    }
  } catch (error) {
    coopWarn("replay", "catch-full op commit threw; legacy carrier/fallback remains active", error);
  }
  return;
}

/** Journal the presentation before sending its low-latency legacy carrier. */
export function sendCoopCatchFullPrompt(
  relay: CoopInteractionRelay,
  pokemonName: string,
  speciesId: number,
  params: { localRole: CoopRole; wave: number; turn: number },
): void {
  const operationId = commitAction({
    payload: { type: "prompt", pokemonName, speciesId },
    ownerRole: "guest",
    ...params,
  });
  relay.promptCatchFull(pokemonName, speciesId, operationId);
}

export function commitCoopCatchFullAuthorityDecision(params: {
  payload: Extract<CoopCatchFullPayload, { type: "decision" }>;
  ownerRole: CoopRole;
  localRole: CoopRole;
  wave: number;
  turn: number;
}): void {
  commitAction(params);
}

function retryKey(payload: Extract<CoopCatchFullPayload, { type: "decision" }>): string {
  return `${payload.speciesId}:${payload.partySlot}`;
}

export function armCoopCatchFullIntentResend(params: {
  payload: Extract<CoopCatchFullPayload, { type: "decision" }>;
  wave: number;
  turn: number;
  resend: () => void;
}): void {
  if (!isCoopCatchFullOperationEnabled()) {
    return;
  }
  const key = retryKey(params.payload);
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
      coopWarn("replay", "catch-full intent resend threw; retry remains armed", error);
    }
    if (retries.has(key)) {
      retries.set(key, setTimeout(tick, retryMs));
    }
  };
  retries.set(key, setTimeout(tick, retryMs));
}

function cancelRetry(payload: Extract<CoopCatchFullPayload, { type: "decision" }>): void {
  const key = retryKey(payload);
  const timer = retries.get(key);
  if (timer != null) {
    clearTimeout(timer);
    retries.delete(key);
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

function applyJournaledCatchFullEnvelope(envelope: CoopAuthoritativeEnvelopeV1): CoopApplyOutcome {
  if (!isCoopCatchFullOperationEnabled()) {
    return "duplicate";
  }
  const operation = envelope.pendingOperation;
  if (operation?.kind !== "CATCH_FULL" || operation.status !== "applied") {
    return "duplicate";
  }
  if (!validPayload(operation.payload)) {
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
  if (operation.payload.type === "prompt") {
    routeCoopOperationToLiveSink("op:catchFull", envelope);
  } else {
    cancelRetry(operation.payload);
  }
  return "applied";
}

registerCoopOperationApplier("op:catchFull", applyJournaledCatchFullEnvelope);
