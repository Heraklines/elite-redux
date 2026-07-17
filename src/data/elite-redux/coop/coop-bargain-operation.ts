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
  applyCoopOperationEnvelope,
  isCoopOperationJournalActive,
  registerCoopOperationApplier,
  tryJournalCoopCommittedEnvelope,
} from "#data/elite-redux/coop/coop-operation-journal";
import {
  CoopOperationGuest,
  CoopOperationHost,
  maybeCoopOpSurfaceState,
  registerCoopOpSurfaceState,
  requireCoopOpSurfaceState,
  resetActiveCoopRuntimeClocks,
} from "#data/elite-redux/coop/coop-operation-runtime";
import { coopInteractionOwnerSeat } from "#data/elite-redux/coop/coop-session";
import type {
  CoopAuthoritativeBattleStateV1,
  CoopInteractionOutcome,
  CoopRole,
} from "#data/elite-redux/coop/coop-transport";

const DEFAULT_ENABLED = !(typeof process !== "undefined" && process.env?.COOP_BARGAIN_OP === "off");

let enabled = DEFAULT_ENABLED;

/** Per-runtime apply state for the bargain surface (see coop-operation-runtime.ts opState infra). */
interface BargainOpState {
  epoch: number;
  revisionFloor: number;
  authorityHost: CoopOperationHost | null;
  watcherGuest: CoopOperationGuest | null;
  readonly pendingJournalMaterializations: Set<string>;
}

registerCoopOpSurfaceState(
  "bargain",
  (): BargainOpState => ({
    epoch: 1,
    revisionFloor: 0,
    authorityHost: null,
    watcherGuest: null,
    pendingJournalMaterializations: new Set<string>(),
  }),
);

/** Fail-loud apply-path accessor: requires an installed runtime (a fresh runtime holds a reset record). */
function state(): BargainOpState {
  return requireCoopOpSurfaceState<BargainOpState>("bargain");
}

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
  const s = maybeCoopOpSurfaceState<BargainOpState>("bargain");
  if (s == null) {
    return; // safe no-op: no runtime installed, nothing exists to reset
  }
  resetActiveCoopRuntimeClocks();
  s.authorityHost = null;
  s.watcherGuest = null;
  s.pendingJournalMaterializations.clear();
  s.revisionFloor = 0;
}

export function setCoopBargainOperationRevisionFloor(highWater: number): void {
  const s = maybeCoopOpSurfaceState<BargainOpState>("bargain");
  if (s == null) {
    return;
  }
  if (!Number.isFinite(highWater) || highWater <= 0 || highWater === s.revisionFloor) {
    return;
  }
  s.revisionFloor = highWater;
  s.authorityHost = null;
  s.watcherGuest = null;
}

export function setCoopBargainOperationEpoch(next: number): void {
  const s = maybeCoopOpSurfaceState<BargainOpState>("bargain");
  if (s == null) {
    return;
  }
  if (next === s.epoch) {
    return;
  }
  s.epoch = next;
  resetCoopBargainOperationState();
}

function host(): CoopOperationHost {
  const s = state();
  s.authorityHost ??= CoopOperationHost.forActiveRuntime({ epoch: s.epoch, initialRevision: s.revisionFloor });
  return s.authorityHost;
}

function guest(): CoopOperationGuest {
  const s = state();
  s.watcherGuest ??= CoopOperationGuest.forActiveRuntime({ epoch: s.epoch, initialRevision: s.revisionFloor });
  return s.watcherGuest;
}

function bargainOperationId(pinned: number): string {
  return makeCoopOperationId(state().epoch, coopInteractionOwnerSeat(pinned), pinned, "BARGAIN");
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

function commit(pinned: number, outcome: CoopInteractionOutcome, wave: number, turn: number): boolean {
  const intent = intentFor(pinned, outcome);
  const result = host().submit(intent, controlContext(wave, turn), proposed =>
    proposed.owner === coopInteractionOwnerSeat(pinned) ? { ok: true } : { ok: false, reason: "wrong-owner" },
  );
  if (result.kind === "committed" || result.kind === "reack") {
    if (!tryJournalCoopCommittedEnvelope(result.envelope)) {
      coopWarn("reward", `bargain op could not retain rev=${result.envelope.revision} id=${intent.id}`);
      return false;
    }
    coopLog("reward", `bargain op commit rev=${result.envelope.revision} id=${intent.id}`);
    return true;
  }
  return false;
}

/** Owner-side commit. Guest-owned outcomes are committed when the host watcher receives the proposal. */
export function commitBargainOwnerOutcome(params: {
  pinned: number;
  outcome: CoopInteractionOutcome;
  localRole: CoopRole;
  wave: number;
  turn?: number;
}): boolean {
  if (!isCoopBargainOperationEnabled()) {
    return true;
  }
  if (params.pinned < 0) {
    return false;
  }
  // A guest-owned bargain uses the raw typed outcome only as its proposal carrier; the host watcher is the
  // sole authority that commits it when that carrier arrives.
  if (params.localRole !== "host") {
    return true;
  }
  try {
    return commit(params.pinned, params.outcome, params.wave, params.turn ?? 0);
  } catch (error) {
    coopWarn("reward", "bargain owner op commit threw; refusing the unretained terminal", error);
    return false;
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
      return commit(params.pinned, params.outcome, params.wave, params.turn ?? 0);
    }
    const s = state();
    const g = guest();
    if (g.hasApplied(id)) {
      return s.pendingJournalMaterializations.delete(id);
    }
    if (isCoopOperationJournalActive()) {
      return false;
    }
    const intent = intentFor(params.pinned, params.outcome);
    const result = g.applyEnvelope({
      version: 1,
      sessionEpoch: s.epoch,
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
  state().pendingJournalMaterializations.add(operationId);
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
  const result = applyCoopOperationEnvelope(g, "op:bargain", envelope);
  if (result !== "applied") {
    return result;
  }
  return "applied";
}

registerCoopOperationApplier("op:bargain", applyJournaledBargainEnvelope);
