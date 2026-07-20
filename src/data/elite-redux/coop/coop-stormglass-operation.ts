/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { isCoopV2InteractionCutoverActive } from "#data/elite-redux/coop/authority-v2/cutover-interaction";
import { isCompleteCoopOperationAuthorityState } from "#data/elite-redux/coop/coop-authority-state-validator";
import { COOP_CAP_OP_STORMGLASS, isCoopSurfaceCapabilityBlocked } from "#data/elite-redux/coop/coop-capabilities";
import { coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopApplyOutcome, CoopDurabilityManager } from "#data/elite-redux/coop/coop-durability";
import type { CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import {
  type CoopAuthoritativeEnvelopeV1,
  type CoopPendingOperation,
  type CoopStormglassPayload,
  type CoopStormglassPresentationPayload,
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
import { COOP_STORMGLASS_SEQ } from "#data/elite-redux/coop/coop-seq-registry";
import { coopSeatOfRole } from "#data/elite-redux/coop/coop-session";
import type { CoopRole } from "#data/elite-redux/coop/coop-transport";

const DEFAULT_ENABLED = !(typeof process !== "undefined" && process.env?.COOP_STORMGLASS_OP === "off");

let enabled = DEFAULT_ENABLED;

/** Per-runtime apply state for the stormglass surface (see coop-operation-runtime.ts opState infra). */
interface StormglassOpState {
  epoch: number;
  revisionFloor: number;
  authorityHost: CoopOperationHost | null;
  receiverGuest: CoopOperationGuest | null;
  /** Complete V2 images already installed, safe for exact idempotent reapply. */
  readonly stateAppliedOperations: Set<string>;
  /** Exact picker result phases that consumed the authoritative choice and ended. */
  readonly settledOperations: Set<string>;
}

registerCoopOpSurfaceState(
  "stormglass",
  (): StormglassOpState => ({
    epoch: 1,
    revisionFloor: 0,
    authorityHost: null,
    receiverGuest: null,
    stateAppliedOperations: new Set(),
    settledOperations: new Set(),
  }),
);

/** Runtime selectors captured before a Stormglass picker crosses an async UI/network boundary. */
export interface CoopStormglassOperationBinding {
  readonly opState: CoopRuntimeOpState;
  readonly durability: CoopDurabilityManager | null;
}

export function captureCoopStormglassOperationBinding(): CoopStormglassOperationBinding {
  const opState = getActiveCoopRuntimeOpState();
  if (opState == null) {
    throw new Error("[coop-op] no runtime installed for surface=stormglass");
  }
  return { opState, durability: getActiveCoopOperationDurability() };
}

/** Fail-loud apply-path accessor: requires an installed runtime (a fresh runtime holds a reset record). */
function state(binding?: CoopStormglassOperationBinding | null): StormglassOpState {
  return binding == null
    ? requireCoopOpSurfaceState<StormglassOpState>("stormglass")
    : requireCoopOpSurfaceStateFor<StormglassOpState>(binding.opState, "stormglass");
}

function retainEnvelope(
  envelope: CoopAuthoritativeEnvelopeV1,
  binding?: CoopStormglassOperationBinding | null,
): boolean {
  return binding == null
    ? tryJournalCoopCommittedEnvelope(envelope)
    : tryJournalCoopCommittedEnvelopeFor(binding.durability, envelope);
}

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
  const s = maybeCoopOpSurfaceState<StormglassOpState>("stormglass");
  if (s == null) {
    return; // safe no-op: no runtime installed, nothing exists to reset
  }
  resetActiveCoopRuntimeClocks();
  s.authorityHost = null;
  s.receiverGuest = null;
  s.revisionFloor = 0;
  s.stateAppliedOperations.clear();
  s.settledOperations.clear();
}

export function setCoopStormglassOperationRevisionFloor(highWater: number): void {
  const s = maybeCoopOpSurfaceState<StormglassOpState>("stormglass");
  if (s == null) {
    return;
  }
  if (!Number.isFinite(highWater) || highWater <= 0 || highWater === s.revisionFloor) {
    return;
  }
  s.revisionFloor = highWater;
  s.authorityHost = null;
  s.receiverGuest = null;
}

export function setCoopStormglassOperationEpoch(value: number): void {
  const s = maybeCoopOpSurfaceState<StormglassOpState>("stormglass");
  if (s == null) {
    return;
  }
  if (!Number.isSafeInteger(value) || value <= 0 || value === s.epoch) {
    return;
  }
  s.epoch = value;
  resetCoopStormglassOperationState();
}

function host(binding?: CoopStormglassOperationBinding | null): CoopOperationHost {
  const s = state(binding);
  s.authorityHost ??=
    binding == null
      ? CoopOperationHost.forActiveRuntime({ epoch: s.epoch, initialRevision: s.revisionFloor })
      : CoopOperationHost.forRuntime(binding.opState, { epoch: s.epoch, initialRevision: s.revisionFloor });
  return s.authorityHost;
}

function guest(binding?: CoopStormglassOperationBinding | null): CoopOperationGuest {
  const s = state(binding);
  s.receiverGuest ??=
    binding == null
      ? CoopOperationGuest.forActiveRuntime({ epoch: s.epoch, initialRevision: s.revisionFloor })
      : CoopOperationGuest.forRuntime(binding.opState, { epoch: s.epoch, initialRevision: s.revisionFloor });
  return s.receiverGuest;
}

function context(wave: number, turn: number) {
  return coopOperationCommitContext(wave, turn, "INTERACTION");
}

export function coopStormglassPresentationOperationId(binding?: CoopStormglassOperationBinding | null): string {
  const s = state(binding);
  return makeCoopOperationId(s.epoch, coopSeatOfRole("host"), COOP_STORMGLASS_SEQ, "STORMGLASS_PRESENT");
}

/** The one Stormglass result is the exact same event address under its result kind. */
export function coopStormglassDecisionOperationId(presentationOperationId: string): string | null {
  const parsed = parseCoopOperationId(presentationOperationId);
  if (
    parsed == null
    || parsed.kind !== "STORMGLASS_PRESENT"
    || parsed.owner !== coopSeatOfRole("host")
    || parsed.pinnedSeq !== COOP_STORMGLASS_SEQ
  ) {
    return null;
  }
  return makeCoopOperationId(parsed.epoch, parsed.owner, parsed.pinnedSeq, "STORMGLASS");
}

export function settleCoopStormglassOperation(
  operationId: string,
  binding?: CoopStormglassOperationBinding | null,
): boolean {
  if (operationId.length === 0) {
    return false;
  }
  state(binding).settledOperations.add(operationId);
  return true;
}

export function isCoopStormglassOperationSettled(
  operationId: string,
  binding?: CoopStormglassOperationBinding | null,
): boolean {
  return state(binding).settledOperations.has(operationId);
}

/** Retain the exact weather pool before the owner can act on the picker. */
export function commitCoopStormglassPresentation(
  options: readonly { readonly weatherIndex: number; readonly weather: number }[],
  params: { readonly localRole: CoopRole; readonly wave: number; readonly turn: number },
  binding?: CoopStormglassOperationBinding | null,
): boolean {
  if (!isCoopStormglassOperationEnabled() || params.localRole !== "host") {
    return true;
  }
  if (
    options.length === 0
    || options.some(
      option =>
        !Number.isSafeInteger(option.weatherIndex)
        || option.weatherIndex < 0
        || !Number.isSafeInteger(option.weather)
        || option.weather < 0,
    )
  ) {
    return false;
  }
  try {
    const owner = coopSeatOfRole("host");
    const operation: CoopPendingOperation = {
      id: coopStormglassPresentationOperationId(binding),
      kind: "STORMGLASS_PRESENT",
      owner,
      status: "proposed",
      payload: { options: structuredClone(options) } satisfies CoopStormglassPresentationPayload,
    };
    const result = host(binding).submit(operation, context(params.wave, params.turn), intent =>
      intent.owner === owner ? { ok: true } : { ok: false, reason: "wrong-owner" },
    );
    return (result.kind === "committed" || result.kind === "reack") && retainEnvelope(result.envelope, binding);
  } catch (error) {
    coopWarn("reward", "stormglass presentation commit threw", error);
    return false;
  }
}

/** Commit the host's resolved weather first, then send the low-latency legacy choice carrier. */
export function commitCoopStormglassDecision(
  relay: CoopInteractionRelay,
  weatherIndex: number,
  weather: number,
  params: { localRole: CoopRole; wave: number; turn: number },
  binding?: CoopStormglassOperationBinding | null,
): boolean {
  if (isCoopStormglassOperationEnabled() && params.localRole === "host") {
    try {
      const owner = coopSeatOfRole("host");
      const operationId = coopStormglassDecisionOperationId(coopStormglassPresentationOperationId(binding));
      if (operationId == null) {
        return false;
      }
      const operation: CoopPendingOperation = {
        id: operationId,
        kind: "STORMGLASS",
        owner,
        status: "proposed",
        payload: { weatherIndex, weather } satisfies CoopStormglassPayload,
      };
      const result = host(binding).submit(operation, context(params.wave, params.turn), intent =>
        intent.owner === owner ? { ok: true } : { ok: false, reason: "wrong-owner" },
      );
      if (result.kind !== "committed" && result.kind !== "reack") {
        return false;
      }
      if (!retainEnvelope(result.envelope, binding)) {
        coopWarn("reward", `stormglass op could not retain rev=${result.envelope.revision} id=${operation.id}`);
        return false;
      }
    } catch (error) {
      coopWarn("reward", "stormglass op commit threw; refusing the unretained carrier", error);
      return false;
    }
  }
  if (!isCoopV2InteractionCutoverActive(binding?.durability)) {
    relay.sendInteractionChoice(COOP_STORMGLASS_SEQ, "stormglass", weatherIndex);
  }
  return true;
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

function validPresentationPayload(value: unknown): value is CoopStormglassPresentationPayload {
  const payload = value as CoopStormglassPresentationPayload | undefined;
  return (
    payload != null
    && Array.isArray(payload.options)
    && payload.options.length > 0
    && payload.options.every(
      option =>
        Number.isSafeInteger(option.weatherIndex)
        && option.weatherIndex >= 0
        && Number.isSafeInteger(option.weather)
        && option.weather >= 0,
    )
  );
}

function applyJournaledStormglassEnvelope(
  envelope: CoopAuthoritativeEnvelopeV1,
  applyContext?: CoopOperationEnvelopeApplyContext,
): CoopApplyOutcome {
  if (!isCoopStormglassOperationEnabled()) {
    return "rejected";
  }
  const operation = envelope.pendingOperation;
  if (
    (operation?.kind !== "STORMGLASS" && operation?.kind !== "STORMGLASS_PRESENT")
    || operation.status !== "applied"
  ) {
    return "rejected";
  }
  if (
    operation.kind === "STORMGLASS" ? !validPayload(operation.payload) : !validPresentationPayload(operation.payload)
  ) {
    return "rejected";
  }
  const g = guest();
  if (!isCoopOperationAuthorityV2Apply(applyContext) && g.hasApplied(operation.id)) {
    return "duplicate";
  }
  if (isCoopOperationAuthorityV2Apply(applyContext)) {
    const s = state();
    if (!isCompleteCoopOperationAuthorityState(envelope.authoritativeState, envelope.wave, envelope.turn)) {
      return "rejected";
    }
    // State material is installed once by the V2 replica transaction, before this surface dispatch.
    s.stateAppliedOperations.add(operation.id);
  }
  const result = applyCoopOperationEnvelope(g, "op:stormglass", envelope, applyContext);
  if (result !== "applied") {
    return result;
  }
  return "applied";
}

registerCoopOperationApplier("op:stormglass", applyJournaledStormglassEnvelope);
