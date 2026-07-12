/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { COOP_CAP_OP_STORMGLASS, isCoopSurfaceCapabilityBlocked } from "#data/elite-redux/coop/coop-capabilities";
import { coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopApplyOutcome } from "#data/elite-redux/coop/coop-durability";
import type { CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import {
  type CoopAuthoritativeEnvelopeV1,
  type CoopPendingOperation,
  type CoopStormglassPayload,
  makeCoopOperationId,
} from "#data/elite-redux/coop/coop-operation-envelope";
import {
  applyCoopOperationEnvelope,
  journalCoopCommittedEnvelope,
  registerCoopOperationApplier,
} from "#data/elite-redux/coop/coop-operation-journal";
import { CoopOperationGuest, CoopOperationHost } from "#data/elite-redux/coop/coop-operation-runtime";
import { COOP_STORMGLASS_SEQ } from "#data/elite-redux/coop/coop-seq-registry";
import { coopSeatOfRole } from "#data/elite-redux/coop/coop-session";
import type { CoopAuthoritativeBattleStateV1, CoopRole } from "#data/elite-redux/coop/coop-transport";

const DEFAULT_ENABLED = !(typeof process !== "undefined" && process.env?.COOP_STORMGLASS_OP === "off");

let enabled = DEFAULT_ENABLED;
let epoch = 1;
let revisionFloor = 0;
let ordinal = 0;
let authorityHost: CoopOperationHost | null = null;
let receiverGuest: CoopOperationGuest | null = null;

export function isCoopStormglassOperationEnabled(): boolean {
  return enabled && !isCoopSurfaceCapabilityBlocked(COOP_CAP_OP_STORMGLASS);
}

export function setCoopStormglassOperationEnabled(value: boolean): void {
  enabled = value;
}

export function resetCoopStormglassOperationFlag(): void {
  enabled = DEFAULT_ENABLED;
}

export function resetCoopStormglassOperationState(): void {
  CoopOperationHost.resetGlobalOrder();
  authorityHost = null;
  receiverGuest = null;
  revisionFloor = 0;
  ordinal = 0;
}

export function setCoopStormglassOperationRevisionFloor(highWater: number): void {
  if (!Number.isFinite(highWater) || highWater <= 0 || highWater === revisionFloor) {
    return;
  }
  revisionFloor = highWater;
  ordinal = 0;
  authorityHost = null;
  receiverGuest = null;
}

export function setCoopStormglassOperationEpoch(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value === epoch) {
    return;
  }
  epoch = value;
  resetCoopStormglassOperationState();
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

/** Commit the host's resolved weather first, then send the low-latency legacy choice carrier. */
export function commitCoopStormglassDecision(
  relay: CoopInteractionRelay,
  weatherIndex: number,
  weather: number,
  params: { localRole: CoopRole; wave: number; turn: number },
): void {
  if (isCoopStormglassOperationEnabled() && params.localRole === "host") {
    try {
      const owner = coopSeatOfRole("host");
      const operation: CoopPendingOperation = {
        id: makeCoopOperationId(epoch, owner, revisionFloor + ++ordinal, "STORMGLASS"),
        kind: "STORMGLASS",
        owner,
        status: "proposed",
        payload: { weatherIndex, weather } satisfies CoopStormglassPayload,
      };
      const result = host().submit(operation, context(params.wave, params.turn), intent =>
        intent.owner === owner ? { ok: true } : { ok: false, reason: "wrong-owner" },
      );
      if (result.kind === "committed") {
        journalCoopCommittedEnvelope(result.envelope);
      }
    } catch (error) {
      coopWarn("reward", "stormglass op commit threw; legacy carrier remains active", error);
    }
  }
  relay.sendInteractionChoice(COOP_STORMGLASS_SEQ, "stormglass", weatherIndex);
}

function validPayload(value: unknown): value is CoopStormglassPayload {
  const payload = value as CoopStormglassPayload | undefined;
  return (
    payload != null
    && Number.isSafeInteger(payload.weatherIndex)
    && payload.weatherIndex >= 0
    && payload.weatherIndex < 5
    && Number.isSafeInteger(payload.weather)
    && payload.weather >= 0
  );
}

function applyJournaledStormglassEnvelope(envelope: CoopAuthoritativeEnvelopeV1): CoopApplyOutcome {
  if (!isCoopStormglassOperationEnabled()) {
    return "rejected";
  }
  const operation = envelope.pendingOperation;
  if (operation?.kind !== "STORMGLASS" || operation.status !== "applied") {
    return "rejected";
  }
  if (!validPayload(operation.payload)) {
    return "rejected";
  }
  const g = guest();
  if (g.hasApplied(operation.id)) {
    return "duplicate";
  }
  const result = applyCoopOperationEnvelope(g, "op:stormglass", envelope);
  if (result !== "applied") {
    return "rejected";
  }
  return "applied";
}

registerCoopOperationApplier("op:stormglass", applyJournaledStormglassEnvelope);
