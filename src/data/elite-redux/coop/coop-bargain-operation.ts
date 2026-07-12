/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { COOP_CAP_OP_BARGAIN, isCoopSurfaceCapabilityBlocked } from "#data/elite-redux/coop/coop-capabilities";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopApplyOutcome } from "#data/elite-redux/coop/coop-durability";
import {
  type CoopAuthoritativeEnvelopeV1,
  type CoopBargainPayload,
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
import type {
  CoopAuthoritativeBattleStateV1,
  CoopInteractionOutcome,
  CoopRole,
} from "#data/elite-redux/coop/coop-transport";

const DEFAULT_ENABLED = !(typeof process !== "undefined" && process.env?.COOP_BARGAIN_OP === "off");

let enabled = DEFAULT_ENABLED;
let epoch = 1;
let revisionFloor = 0;
let authorityHost: CoopOperationHost | null = null;
let watcherGuest: CoopOperationGuest | null = null;
const pendingJournalMaterializations = new Set<string>();

export function isCoopBargainOperationEnabled(): boolean {
  return enabled && !isCoopSurfaceCapabilityBlocked(COOP_CAP_OP_BARGAIN);
}

export function setCoopBargainOperationEnabled(value: boolean): void {
  enabled = value;
}

export function resetCoopBargainOperationFlag(): void {
  enabled = DEFAULT_ENABLED;
}

export function resetCoopBargainOperationState(): void {
  CoopOperationHost.resetGlobalOrder();
  authorityHost = null;
  watcherGuest = null;
  pendingJournalMaterializations.clear();
  revisionFloor = 0;
}

export function setCoopBargainOperationRevisionFloor(highWater: number): void {
  if (!Number.isFinite(highWater) || highWater <= 0 || highWater === revisionFloor) {
    return;
  }
  revisionFloor = highWater;
  authorityHost = null;
  watcherGuest = null;
}

export function setCoopBargainOperationEpoch(next: number): void {
  if (next === epoch) {
    return;
  }
  epoch = next;
  resetCoopBargainOperationState();
}

function host(): CoopOperationHost {
  authorityHost ??= CoopOperationHost.global({ epoch, initialRevision: revisionFloor });
  return authorityHost;
}

function guest(): CoopOperationGuest {
  watcherGuest ??= CoopOperationGuest.global({ epoch, initialRevision: revisionFloor });
  return watcherGuest;
}

function bargainOperationId(pinned: number): string {
  return makeCoopOperationId(epoch, coopInteractionOwnerSeat(pinned), pinned);
}

function controlContext(
  wave: number,
  turn: number,
): Omit<CoopAuthoritativeEnvelopeV1, "version" | "sessionEpoch" | "revision" | "pendingOperation"> {
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
  return { wave, turn, logicalPhase: "INTERACTION", authoritativeState };
}

function intentFor(pinned: number, outcome: CoopInteractionOutcome): CoopPendingOperation {
  return {
    id: bargainOperationId(pinned),
    kind: "BARGAIN",
    owner: coopInteractionOwnerSeat(pinned),
    status: "proposed",
    payload: { outcome } satisfies CoopBargainPayload,
  };
}

function commit(pinned: number, outcome: CoopInteractionOutcome, wave: number, turn: number): void {
  const intent = intentFor(pinned, outcome);
  const result = host().submit(intent, controlContext(wave, turn), proposed =>
    proposed.owner === coopInteractionOwnerSeat(pinned) ? { ok: true } : { ok: false, reason: "wrong-owner" },
  );
  if (result.kind === "committed") {
    journalCoopCommittedEnvelope(result.envelope);
    coopLog("reward", `bargain op commit rev=${result.envelope.revision} id=${intent.id}`);
  }
}

/** Owner-side commit. Guest-owned outcomes are committed when the host watcher receives the proposal. */
export function commitBargainOwnerOutcome(params: {
  pinned: number;
  outcome: CoopInteractionOutcome;
  localRole: CoopRole;
  wave: number;
  turn?: number;
}): void {
  if (!isCoopBargainOperationEnabled() || params.pinned < 0 || params.localRole !== "host") {
    return;
  }
  try {
    commit(params.pinned, params.outcome, params.wave, params.turn ?? 0);
  } catch (error) {
    coopWarn("reward", "bargain owner op commit threw; legacy outcome remains active", error);
  }
}

/** Gate the real watcher apply through the single operation ledger. */
export function adoptBargainWatcherOutcome(params: {
  pinned: number;
  outcome: CoopInteractionOutcome | null;
  localRole: CoopRole;
  wave: number;
  turn?: number;
}): boolean {
  if (!isCoopBargainOperationEnabled()) {
    return params.outcome?.k === "meResync";
  }
  if (params.outcome?.k !== "meResync" || params.pinned < 0) {
    return false;
  }
  try {
    const id = bargainOperationId(params.pinned);
    if (params.localRole === "host") {
      // Guest owner -> host authority: the legacy outcome is the typed proposal carrier.
      commit(params.pinned, params.outcome, params.wave, params.turn ?? 0);
      return true;
    }
    const g = guest();
    if (g.hasApplied(id)) {
      return pendingJournalMaterializations.delete(id);
    }
    const intent = intentFor(params.pinned, params.outcome);
    const result = g.applyEnvelope({
      version: 1,
      sessionEpoch: epoch,
      revision: g.getLastAppliedRevision() + 1,
      ...controlContext(params.wave, params.turn ?? 0),
      pendingOperation: { ...intent, status: "applied" },
    });
    return result.kind === "applied";
  } catch (error) {
    coopWarn("reward", "bargain watcher op apply threw; rejecting unsafe local derivation", error);
    return false;
  }
}

export function armCoopBargainJournalMaterialization(operationId: string): void {
  pendingJournalMaterializations.add(operationId);
}

function applyJournaledBargainEnvelope(envelope: CoopAuthoritativeEnvelopeV1): CoopApplyOutcome {
  if (!isCoopBargainOperationEnabled()) {
    return "rejected";
  }
  const op = envelope.pendingOperation;
  if (op?.kind !== "BARGAIN" || op.status !== "applied") {
    return "rejected";
  }
  const g = guest();
  if (g.hasApplied(op.id)) {
    return "duplicate";
  }
  if (!routeCoopOperationToLiveSink("op:bargain", envelope)) {
    return "rejected";
  }
  const result = g.applyEnvelope({ ...envelope, sessionEpoch: epoch, revision: g.getLastAppliedRevision() + 1 });
  if (result.kind !== "applied") {
    return "rejected";
  }
  return "applied";
}

registerCoopOperationApplier("op:bargain", applyJournaledBargainEnvelope);
