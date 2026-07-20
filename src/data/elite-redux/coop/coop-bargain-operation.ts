/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { applyCoopMeOutcome, captureCoopMeOutcome } from "#data/elite-redux/coop/coop-battle-engine";
import { COOP_CAP_OP_BARGAIN, isCoopSurfaceCapabilityBlocked } from "#data/elite-redux/coop/coop-capabilities";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopApplyOutcome } from "#data/elite-redux/coop/coop-durability";
import { isCompleteCoopMeResyncOutcome } from "#data/elite-redux/coop/coop-me-terminal-validator";
import {
  type CoopAuthoritativeEnvelopeV1,
  type CoopBargainPayload,
  type CoopBargainPresentationPayload,
  type CoopPendingOperation,
  makeCoopOperationId,
} from "#data/elite-redux/coop/coop-operation-envelope";
import {
  applyCoopOperationEnvelope,
  type CoopOperationEnvelopeApplyContext,
  isCoopOperationAuthorityV2Apply,
  isCoopOperationJournalActive,
  registerCoopOperationApplier,
  tryJournalCoopCommittedEnvelope,
} from "#data/elite-redux/coop/coop-operation-journal";
import {
  CoopOperationGuest,
  CoopOperationHost,
  coopOperationCommitContext,
  maybeCoopOpSurfaceState,
  registerCoopOpSurfaceState,
  requireCoopOpSurfaceState,
  resetActiveCoopRuntimeClocks,
} from "#data/elite-redux/coop/coop-operation-runtime";
import { coopInteractionOwnerSeat } from "#data/elite-redux/coop/coop-session";
import type { CoopInteractionOutcome, CoopRole } from "#data/elite-redux/coop/coop-transport";

const DEFAULT_ENABLED = !(typeof process !== "undefined" && process.env?.COOP_BARGAIN_OP === "off");
export const COOP_BARGAIN_PRESENT_KIND = "bargain-present";

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

export function coopBargainOperationId(pinned: number): string {
  return makeCoopOperationId(state().epoch, coopInteractionOwnerSeat(pinned), pinned, "BARGAIN");
}

export function coopBargainPresentationOperationId(pinned: number): string {
  return makeCoopOperationId(state().epoch, coopInteractionOwnerSeat(pinned), pinned, "BARGAIN_PRESENT");
}

function controlContext(
  wave: number,
  turn: number,
  outcome?: CoopInteractionOutcome,
): Omit<CoopAuthoritativeEnvelopeV1, "version" | "sessionEpoch" | "revision" | "pendingOperation"> {
  return coopOperationCommitContext(
    wave,
    turn,
    "INTERACTION",
    outcome?.k === "meResync" ? outcome.authoritativeState : null,
  );
}

function intentFor(pinned: number, outcome: CoopInteractionOutcome): CoopPendingOperation {
  return {
    id: coopBargainOperationId(pinned),
    kind: "BARGAIN",
    owner: coopInteractionOwnerSeat(pinned),
    status: "proposed",
    payload: { outcome } satisfies CoopBargainPayload,
  };
}

function commit(pinned: number, outcome: CoopInteractionOutcome, wave: number, turn: number): boolean {
  const intent = intentFor(pinned, outcome);
  const result = host().submit(intent, controlContext(wave, turn, outcome), proposed =>
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

/** Authority commits the exact stable Sin keys before either peer may render or act. */
export function commitCoopBargainPresentation(params: {
  readonly pinned: number;
  readonly sins: readonly string[];
  readonly localRole: CoopRole;
  readonly wave: number;
  readonly turn: number;
}): boolean {
  if (!isCoopBargainOperationEnabled() || params.localRole !== "host") {
    return true;
  }
  if (
    !Number.isSafeInteger(params.pinned)
    || params.pinned < 0
    || params.sins.length > 3
    || params.sins.some(sin => typeof sin !== "string" || sin.length === 0)
  ) {
    return false;
  }
  try {
    const owner = coopInteractionOwnerSeat(params.pinned);
    const operation: CoopPendingOperation = {
      id: coopBargainPresentationOperationId(params.pinned),
      kind: "BARGAIN_PRESENT",
      owner,
      status: "proposed",
      payload: {
        pinned: params.pinned,
        sins: [...params.sins],
      } satisfies CoopBargainPresentationPayload,
    };
    const result = host().submit(operation, controlContext(params.wave, params.turn), proposed =>
      proposed.owner === owner ? { ok: true } : { ok: false, reason: "wrong-owner" },
    );
    if (result.kind !== "committed" && result.kind !== "reack") {
      return false;
    }
    if (!tryJournalCoopCommittedEnvelope(result.envelope)) {
      coopWarn("reward", `bargain presentation could not retain id=${operation.id}`);
      return false;
    }
    coopLog("reward", `bargain presentation retained pinned=${params.pinned} sins=${params.sins.join(",")}`);
    return true;
  } catch (error) {
    coopWarn("reward", "bargain presentation commit threw", error);
    return false;
  }
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
export interface CoopBargainWatcherAdoption {
  /** The terminal was durably accepted and the phase may leave its watcher surface. */
  readonly accepted: boolean;
  /** The complete authoritative image already reached the live engine; the phase must not apply it again. */
  readonly projectionApplied: boolean;
  /** Host watcher must commit the post-apply complete image only after its local phase ends. */
  readonly requiresAuthorityCommit: boolean;
  readonly operationId: string | null;
  readonly authoritativeOutcome: CoopInteractionOutcome | null;
}

const REJECTED_BARGAIN_ADOPTION: CoopBargainWatcherAdoption = {
  accepted: false,
  projectionApplied: false,
  requiresAuthorityCommit: false,
  operationId: null,
  authoritativeOutcome: null,
};

/** Gate the real watcher apply through the single operation ledger. */
export function adoptBargainWatcherOutcome(params: {
  pinned: number;
  outcome: CoopInteractionOutcome | null;
  localRole: CoopRole;
  wave: number;
  turn?: number;
}): CoopBargainWatcherAdoption {
  if (!isCoopBargainOperationEnabled()) {
    return {
      accepted: params.outcome?.k === "meResync",
      projectionApplied: false,
      requiresAuthorityCommit: false,
      operationId: null,
      authoritativeOutcome: null,
    };
  }
  if (!isCompleteCoopMeResyncOutcome(params.outcome) || params.pinned < 0) {
    return REJECTED_BARGAIN_ADOPTION;
  }
  try {
    const id = coopBargainOperationId(params.pinned);
    if (params.localRole === "host") {
      // Guest owner -> host authority: the raw outcome is only a typed proposal. Apply it transactionally
      // to the authoritative engine FIRST, then capture and commit the host's resulting complete image.
      // Committing the proposal before this projection let a receipt retire DATA the authority had not
      // installed yet and made reconnect replay dependent on whichever peer happened to mutate first.
      if (!applyCoopMeOutcome(params.outcome)) {
        return REJECTED_BARGAIN_ADOPTION;
      }
      const authoritativeOutcome = captureCoopMeOutcome();
      if (!isCompleteCoopMeResyncOutcome(authoritativeOutcome)) {
        return REJECTED_BARGAIN_ADOPTION;
      }
      return {
        accepted: true,
        projectionApplied: true,
        requiresAuthorityCommit: true,
        operationId: id,
        authoritativeOutcome,
      };
    }
    const s = state();
    const g = guest();
    // The live sink sets this proof only after applyCoopMeOutcome returned true. Under Authority V2 the
    // legacy guest applied-id/revision domain is intentionally bypassed, so this runtime-owned proof must
    // be consulted before that legacy cursor.
    if (s.pendingJournalMaterializations.delete(id)) {
      return {
        accepted: true,
        projectionApplied: true,
        requiresAuthorityCommit: false,
        operationId: id,
        authoritativeOutcome: null,
      };
    }
    if (g.hasApplied(id)) {
      return REJECTED_BARGAIN_ADOPTION;
    }
    if (isCoopOperationJournalActive()) {
      return REJECTED_BARGAIN_ADOPTION;
    }
    const intent = intentFor(params.pinned, params.outcome);
    const result = g.applyEnvelope({
      version: 1,
      sessionEpoch: s.epoch,
      revision: g.getLastAppliedRevision() + 1,
      ...controlContext(params.wave, params.turn ?? 0),
      pendingOperation: { ...intent, status: "applied" },
    });
    return {
      accepted: result.kind === "applied",
      projectionApplied: false,
      requiresAuthorityCommit: false,
      operationId: result.kind === "applied" ? id : null,
      authoritativeOutcome: null,
    };
  } catch (error) {
    coopWarn("reward", "bargain watcher op apply threw; rejecting unsafe local derivation", error);
    return REJECTED_BARGAIN_ADOPTION;
  }
}

/** Host watcher post-terminal seam for a guest-owned Bargain proposal. */
export function commitBargainWatcherOutcome(
  operationId: string,
  params: { readonly pinned: number; readonly wave: number; readonly turn: number },
  outcome: CoopInteractionOutcome,
): boolean {
  return (
    operationId === coopBargainOperationId(params.pinned)
    && isCompleteCoopMeResyncOutcome(outcome)
    && commit(params.pinned, outcome, params.wave, params.turn)
  );
}

export function armCoopBargainJournalMaterialization(operationId: string): void {
  state().pendingJournalMaterializations.add(operationId);
}

function applyJournaledBargainEnvelope(
  envelope: CoopAuthoritativeEnvelopeV1,
  applyContext?: CoopOperationEnvelopeApplyContext,
): CoopApplyOutcome {
  if (!isCoopBargainOperationEnabled()) {
    return "rejected";
  }
  const op = envelope.pendingOperation;
  if ((op?.kind !== "BARGAIN" && op?.kind !== "BARGAIN_PRESENT") || op.status !== "applied") {
    return "rejected";
  }
  if (
    op.kind === "BARGAIN_PRESENT"
    && (typeof (op.payload as CoopBargainPresentationPayload | undefined)?.pinned !== "number"
      || !Array.isArray((op.payload as CoopBargainPresentationPayload).sins)
      || (op.payload as CoopBargainPresentationPayload).sins.length > 3
      || (op.payload as CoopBargainPresentationPayload).sins.some(sin => typeof sin !== "string" || sin.length === 0))
  ) {
    return "rejected";
  }
  const g = guest();
  if (!isCoopOperationAuthorityV2Apply(applyContext) && g.hasApplied(op.id)) {
    return "duplicate";
  }
  const result = applyCoopOperationEnvelope(g, "op:bargain", envelope, applyContext);
  if (result !== "applied") {
    return result;
  }
  return "applied";
}

registerCoopOperationApplier("op:bargain", applyJournaledBargainEnvelope);
