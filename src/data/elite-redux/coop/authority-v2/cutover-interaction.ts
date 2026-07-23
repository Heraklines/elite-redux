/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - CUTOVER SURFACE 4 (shared interactions).
//
// The migrated V1 operation layer already captures the complete, settled,
// post-action state for every shared interaction. Its remaining architectural
// defect was transport ownership: the result was retained in `op:global` while
// Authority V2 merely shadowed the lossy raw relay choice. That left two global
// logs and made recovery/order depend on which carrier happened to arrive first.
//
// This switchboard promotes the COMPLETE committed operation envelope into the
// one Authority V2 log as INTERACTION_COMMIT material. The raw relay remains an
// unretained proposal/presentation carrier (guest-owned input still has to reach
// the authority); it is never correctness or recovery authority after cutover.
//
// The wrapper is intentionally a migration carrier rather than a second
// derivation of every surface payload. The embedded envelope contains:
//   - the exact operation identity, kind, owner, and resolved payload;
//   - the complete post-action authoritative battle/run state;
//   - the authority's global operation order.
// Replica installation routes that immutable image through the existing
// surface-specific, idempotent appliers. No interaction mechanics are re-derived
// from the raw relay choice.
// =============================================================================

import type {
  CoopAuthorityEntry,
  CoopFrameContextV2,
  CoopNextControl,
} from "#data/elite-redux/coop/authority-v2/contract";
import { controlsEqual, validateNextControl } from "#data/elite-redux/coop/authority-v2/next-control";
import type { CoopAuthorityV2Shadow } from "#data/elite-redux/coop/authority-v2/shadow";
import { isCompleteCoopOperationAuthorityState } from "#data/elite-redux/coop/coop-authority-state-validator";
import type { CoopDurabilityManager } from "#data/elite-redux/coop/coop-durability";
import {
  isCompleteCoopMeResyncOutcome,
  isCompleteCoopMeTerminalPayload,
} from "#data/elite-redux/coop/coop-me-terminal-validator";
import type {
  CoopAuthoritativeEnvelopeV1,
  CoopLogicalPhase,
  CoopOperationKind,
} from "#data/elite-redux/coop/coop-operation-envelope";
import {
  COOP_ME_REWARD_SURFACE_ID_MAX_LENGTH,
  COOP_ME_REWARD_SURFACE_LIMIT,
  makeCoopOperationId,
  parseCoopOperationId,
} from "#data/elite-redux/coop/coop-operation-envelope";
import type {
  CoopOperationSurfaceClass,
  CoopV2InteractionOperationKind,
} from "#data/elite-redux/coop/coop-operation-surface-registry";
import { isCoopOperationSurfaceClass } from "#data/elite-redux/coop/coop-operation-surface-registry";
import {
  COOP_BIOME_PICK_SEQ_BASE,
  COOP_CROSSROADS_SEQ_BASE,
  COOP_MAX_REACHABLE_COUNTER,
  COOP_ME_PUMP_SEQ_BASE,
} from "#data/elite-redux/coop/coop-seq-registry";
import { coopInteractionOwnerSeat } from "#data/elite-redux/coop/coop-session";

const viteEnv = import.meta.env as unknown as Record<string, string | undefined>;
const COOP_V2_INTERACTION_ENABLED =
  viteEnv.VITE_COOP_AUTHORITY_V2_INTERACTION === "on"
  || (typeof process !== "undefined" && process.env?.COOP_AUTHORITY_V2_INTERACTION === "on");

/** Whether this build advertises the Authority V2 interaction cutover (default OFF). */
export function isCoopV2InteractionEnabled(): boolean {
  return COOP_V2_INTERACTION_ENABLED;
}

export type CoopInteractionAuthorityModeV2 = "legacy" | "v2";

export interface CoopInteractionAuthorityInputsV2 {
  readonly buildEnabled: boolean;
  readonly negotiated: boolean;
  readonly harnessPresent: boolean;
}

/** Fail closed: the old journal is retired only when the complete V2 path exists. */
export function resolveCoopInteractionAuthorityModeV2(
  inputs: CoopInteractionAuthorityInputsV2,
): CoopInteractionAuthorityModeV2 {
  return inputs.buildEnabled && inputs.negotiated && inputs.harnessPresent ? "v2" : "legacy";
}

/** V2 delivery leases replace retained `op:global` interaction entries. */
export function suppressesLegacyInteractionOperationAuthority(mode: CoopInteractionAuthorityModeV2): boolean {
  return mode === "v2";
}

/** Material discriminant for the complete operation-envelope migration carrier. */
export const COOP_V2_INTERACTION_ENVELOPE_KIND = "OPERATION_ENVELOPE_V1" as const;

export interface CoopV2InteractionEnvelopeMaterial {
  readonly kind: typeof COOP_V2_INTERACTION_ENVELOPE_KIND;
  readonly surfaceClass: CoopOperationSurfaceClass;
  readonly envelope: CoopAuthoritativeEnvelopeV1;
}

type CoopV2InteractionSurfaceClass = Exclude<CoopOperationSurfaceClass, "op:faintSwitch" | "op:wave">;

interface CoopV2InteractionRegistration {
  readonly surfaceClass: CoopV2InteractionSurfaceClass;
  readonly logicalPhases: readonly CoopLogicalPhase[];
  readonly validatePayload: (payload: unknown) => boolean;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function finiteArray(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.every(finite);
}

function integerArray(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.every(integer);
}

function outcome(value: unknown): boolean {
  return isPlainObject(value) && typeof value.k === "string" && value.k.length > 0;
}

const COOP_REWARD_SURFACE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/;

function rewardSurfaceIdentity(value: unknown): boolean {
  return (
    isPlainObject(value)
    && typeof value.surfaceId === "string"
    && value.surfaceId.length <= COOP_ME_REWARD_SURFACE_ID_MAX_LENGTH
    && COOP_REWARD_SURFACE_ID_PATTERN.test(value.surfaceId)
    && integer(value.ordinal)
    && value.ordinal >= 0
    && value.ordinal < COOP_ME_REWARD_SURFACE_LIMIT
  );
}

function rewardPayload(value: unknown): boolean {
  const continuing =
    isPlainObject(value)
    && value.terminal === false
    && (value.label === "shop" || value.label === "check" || value.label === "transfer" || value.label === "lock");
  const terminalMatchesAction =
    isPlainObject(value)
    && (value.terminal === true
      ? (value.label === "skip" && value.choice === -1)
        || (value.label === "reward" && integer(value.choice) && value.choice >= 0)
      : value.label !== "skip" && value.label !== "reward");
  return (
    isPlainObject(value)
    && (value.label === "reward"
      || value.label === "shop"
      || value.label === "skip"
      || value.label === "reroll"
      || value.label === "check"
      || value.label === "transfer"
      || value.label === "lock")
    && integer(value.choice)
    && (value.data === undefined || integerArray(value.data))
    && typeof value.terminal === "boolean"
    && (value.rewardSurface === undefined || rewardSurfaceIdentity(value.rewardSurface))
    && terminalMatchesAction
    && isPlainObject(value.result)
    && typeof value.result.lockModifierTiers === "boolean"
    && (!continuing || rewardPresentationPayload(value.result.continuation, "reward"))
  );
}

function shopPayload(value: unknown): boolean {
  return (
    isPlainObject(value)
    && integer(value.slot)
    && (value.data === undefined || integerArray(value.data))
    && typeof value.terminal === "boolean"
    && isPlainObject(value.result)
    && integerArray(value.result.remainingStock)
    && value.result.remainingStock.every(stock => stock >= 0)
    && (value.terminal === true
      || marketContinuationMatchesStock(value.result.continuation, value.result.remainingStock))
  );
}

const COOP_MARKET_PROJECTION_KINDS = new Set(["biome", "exotic", "black-market", "import-bazaar"]);

function arraysEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function marketContinuationMatchesStock(value: unknown, remainingStock: readonly number[]): boolean {
  return (
    rewardPresentationPayload(value, "market")
    && isPlainObject(value)
    && integerArray(value.remainingStock)
    && arraysEqual(remainingStock, value.remainingStock)
  );
}

function rewardPresentationPayload(value: unknown, surface: "reward" | "market"): boolean {
  if (
    !isPlainObject(value)
    || value.surface !== surface
    || !integer(value.pinned)
    || value.pinned < 0
    || !integer(value.reroll)
    || value.reroll < 0
    || !Array.isArray(value.options)
  ) {
    return false;
  }
  if (
    surface === "market"
    && (!COOP_MARKET_PROJECTION_KINDS.has(value.marketKind as string)
      || !integerArray(value.remainingStock)
      || value.remainingStock.length !== value.options.length
      || value.remainingStock.some(stock => stock < 0))
  ) {
    return false;
  }
  if (value.rewardSurface !== undefined && !rewardSurfaceIdentity(value.rewardSurface)) {
    return false;
  }
  return value.options.every(
    option =>
      isPlainObject(option)
      && typeof option.id === "string"
      && option.id.length > 0
      && finite(option.tier)
      && finite(option.upgradeCount)
      && finite(option.cost)
      && (option.pregenArgs === undefined || finiteArray(option.pregenArgs)),
  );
}

function promptOrDecision(
  value: unknown,
  prompt: (payload: Record<string, unknown>) => boolean,
  decision: (payload: Record<string, unknown>) => boolean,
): boolean {
  return (
    isPlainObject(value) && (value.type === "prompt" ? prompt(value) : value.type === "decision" && decision(value))
  );
}

/**
 * Closed Authority V2 interaction registry. A new operation kind cannot enter the mechanical log until it
 * declares its exact legacy result phase, surface applier, and construction-time payload validator here.
 */
export const COOP_V2_INTERACTION_REGISTRY = {
  ABILITY_PRESENT: {
    surfaceClass: "op:ability",
    logicalPhases: ["INTERACTION"],
    validatePayload: value =>
      isPlainObject(value)
      && integer(value.pinned)
      && value.pinned >= 0
      && integer(value.partyIndex)
      && value.partyIndex >= 0
      && (value.workflow === "capsule"
        || value.workflow === "greater-capsule"
        || value.workflow === "greater-randomizer")
      && (value.workflow === "greater-randomizer"
        ? integerArray(value.rolledAbilityIds)
          && value.rolledAbilityIds.length === 4
          && value.rolledAbilityIds.every(id => id > 0)
          && new Set(value.rolledAbilityIds).size === value.rolledAbilityIds.length
        : value.rolledAbilityIds === undefined),
  },
  ABILITY_PICK: {
    surfaceClass: "op:ability",
    logicalPhases: ["INTERACTION"],
    validatePayload: value => isPlainObject(value) && finiteArray(value.data),
  },
  BARGAIN_PRESENT: {
    surfaceClass: "op:bargain",
    logicalPhases: ["INTERACTION"],
    validatePayload: value =>
      isPlainObject(value)
      && integer(value.pinned)
      && value.pinned >= 0
      && Array.isArray(value.sins)
      && value.sins.length <= 3
      && value.sins.every(sin => typeof sin === "string" && sin.length > 0),
  },
  BARGAIN: {
    surfaceClass: "op:bargain",
    logicalPhases: ["INTERACTION"],
    validatePayload: value => isPlainObject(value) && isCompleteCoopMeResyncOutcome(value.outcome),
  },
  BIOME_PICK: {
    surfaceClass: "op:biome",
    logicalPhases: ["BIOME_SELECT"],
    validatePayload: value =>
      isPlainObject(value)
      && integer(value.sourceBiomeId)
      && integer(value.biomeId)
      && integer(value.nodeIndex)
      && integer(value.nextWave),
  },
  CATCH_FULL: {
    surfaceClass: "op:catchFull",
    logicalPhases: ["TURN_RESOLVE"],
    validatePayload: value =>
      promptOrDecision(
        value,
        payload => typeof payload.pokemonName === "string" && integer(payload.speciesId),
        payload => integer(payload.speciesId) && integer(payload.partySlot),
      ),
  },
  COLO_PICK: {
    surfaceClass: "op:colosseum",
    logicalPhases: ["INTERACTION"],
    validatePayload: value =>
      isPlainObject(value)
      && integer(value.round)
      && (value.type === "board"
        ? Array.isArray(value.labels) && value.labels.every(label => typeof label === "string")
        : value.type === "decision" && integer(value.index)),
  },
  CROSSROADS_PICK: {
    surfaceClass: "op:biome",
    logicalPhases: ["BIOME_SELECT"],
    validatePayload: value =>
      isPlainObject(value) && integer(value.optionIndex) && (value.optionIndex === 0 || value.optionIndex === 1),
  },
  LEARN_MOVE: {
    surfaceClass: "op:learnMove",
    logicalPhases: ["TURN_RESOLVE"],
    validatePayload: value =>
      promptOrDecision(
        value,
        payload => integer(payload.partySlot) && integer(payload.moveId) && integer(payload.maxMoveCount),
        payload =>
          integer(payload.partySlot)
          && integer(payload.moveId)
          && integer(payload.forgetSlot)
          && integer(payload.maxMoveCount),
      ),
  },
  LEARN_MOVE_BATCH: {
    surfaceClass: "op:learnMove",
    logicalPhases: ["TURN_RESOLVE"],
    validatePayload: value =>
      promptOrDecision(
        value,
        payload =>
          integer(payload.partySlot) && integerArray(payload.learnableIds) && typeof payload.ownerIsGuest === "boolean",
        payload =>
          integer(payload.partySlot)
          && Array.isArray(payload.assignments)
          && payload.assignments.every(
            assignment => Array.isArray(assignment) && assignment.length === 2 && assignment.every(integer),
          )
          && typeof payload.fallback === "boolean",
      ),
  },
  ME_BUTTON: {
    surfaceClass: "op:me",
    logicalPhases: ["MYSTERY_ENCOUNTER"],
    validatePayload: value => isPlainObject(value) && integer(value.button),
  },
  ME_PICK: {
    surfaceClass: "op:me",
    logicalPhases: ["MYSTERY_ENCOUNTER"],
    validatePayload: value => isPlainObject(value) && integer(value.optionIndex),
  },
  ME_PRESENT: {
    surfaceClass: "op:me",
    logicalPhases: ["MYSTERY_ENCOUNTER"],
    validatePayload: value =>
      isPlainObject(value)
      && typeof value.present === "boolean"
      && (value.presentation === undefined || outcome(value.presentation)),
  },
  ME_SUB: {
    surfaceClass: "op:me",
    logicalPhases: ["MYSTERY_ENCOUNTER"],
    validatePayload: value => isPlainObject(value) && integer(value.value),
  },
  ME_TERMINAL: {
    surfaceClass: "op:me",
    logicalPhases: ["MYSTERY_ENCOUNTER"],
    validatePayload: isCompleteCoopMeTerminalPayload,
  },
  QUIZ_ANSWER: {
    surfaceClass: "op:me",
    logicalPhases: ["MYSTERY_ENCOUNTER"],
    validatePayload: value => isPlainObject(value) && integer(value.questionIndex) && integer(value.choice),
  },
  REVIVAL: {
    surfaceClass: "op:revival",
    logicalPhases: ["TURN_RESOLVE"],
    validatePayload: value =>
      promptOrDecision(
        value,
        payload => integer(payload.fieldIndex),
        payload => integer(payload.fieldIndex) && integer(payload.partySlot) && integer(payload.speciesId),
      ),
  },
  REWARD: {
    surfaceClass: "op:reward",
    logicalPhases: ["REWARD_SELECT"],
    validatePayload: rewardPayload,
  },
  REWARD_PRESENT: {
    surfaceClass: "op:reward",
    logicalPhases: ["REWARD_SELECT"],
    validatePayload: value => rewardPresentationPayload(value, "reward"),
  },
  SHOP_PRESENT: {
    surfaceClass: "op:reward",
    logicalPhases: ["SHOP"],
    validatePayload: value => rewardPresentationPayload(value, "market"),
  },
  SHOP_BUY: {
    surfaceClass: "op:reward",
    logicalPhases: ["SHOP"],
    validatePayload: shopPayload,
  },
  STORMGLASS_PRESENT: {
    surfaceClass: "op:stormglass",
    logicalPhases: ["INTERACTION"],
    validatePayload: value =>
      isPlainObject(value)
      && Array.isArray(value.options)
      && value.options.length > 0
      && value.options.every(
        option =>
          isPlainObject(option)
          && integer(option.weatherIndex)
          && option.weatherIndex >= 0
          && integer(option.weather)
          && option.weather >= 0,
      ),
  },
  STORMGLASS: {
    surfaceClass: "op:stormglass",
    logicalPhases: ["INTERACTION"],
    validatePayload: value => isPlainObject(value) && integer(value.weatherIndex) && integer(value.weather),
  },
} as const satisfies Record<CoopV2InteractionOperationKind, CoopV2InteractionRegistration>;

export const COOP_V2_INTERACTION_SURFACES = [
  ...new Set(Object.values(COOP_V2_INTERACTION_REGISTRY).map(registration => registration.surfaceClass)),
] as readonly CoopV2InteractionSurfaceClass[];

function interactionRegistration(kind: CoopOperationKind): CoopV2InteractionRegistration | null {
  return kind === "FAINT_SWITCH" || kind === "WAVE_ADVANCE" ? null : COOP_V2_INTERACTION_REGISTRY[kind];
}

type CoopV2InteractionEnvelopeDisposition = "unrelated" | "telemetry" | "mechanical";

/**
 * Input proposals and cursor/button observations are not settled mechanical results. They remain
 * non-authoritative telemetry/proposal carriers and must never consume a global V2 revision. The next
 * committed presentation or terminal result is the mechanical entry that subsumes them.
 */
function interactionEnvelopeDisposition(envelope: CoopAuthoritativeEnvelopeV1): CoopV2InteractionEnvelopeDisposition {
  const operation = envelope.pendingOperation;
  if (operation == null || interactionRegistration(operation.kind) == null) {
    return "unrelated";
  }
  if (
    operation.kind === "ME_PICK"
    || operation.kind === "ME_SUB"
    || operation.kind === "ME_BUTTON"
    || operation.kind === "QUIZ_ANSWER"
  ) {
    return "telemetry";
  }
  return "mechanical";
}

/** Whether an old operation kind belongs to this cutover (wave/replacement have their own V2 entries). */
export function isCoopV2InteractionOperationEnvelope(envelope: CoopAuthoritativeEnvelopeV1): boolean {
  return interactionEnvelopeDisposition(envelope) !== "unrelated";
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function digestOfCoopV2InteractionEnvelope(material: CoopV2InteractionEnvelopeMaterial): string {
  return `interaction-envelope-v1:${fnv1a32(canonicalJson(material))}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Freeze the exact JSON image that will cross WebRTC before deriving either its digest or successor.
 *
 * `structuredClone` preserves object properties whose value is `undefined`, while JSON transport drops
 * them. Reward Leave results legitimately contain optional undefined fields, so hashing the pre-wire object
 * made the authority retain one digest and the replica receive another. Building from the round-tripped
 * image makes the locally retained entry, redeliveries, recovery tail, and remote replica byte-semantic
 * copies of one immutable carrier.
 */
function freezeInteractionWireMaterial(
  material: CoopV2InteractionEnvelopeMaterial,
): CoopV2InteractionEnvelopeMaterial | null {
  try {
    const wire = JSON.parse(JSON.stringify(material)) as unknown;
    if (
      !isPlainObject(wire)
      || wire.kind !== COOP_V2_INTERACTION_ENVELOPE_KIND
      || !isCoopOperationSurfaceClass(wire.surfaceClass as string)
      || !isPlainObject(wire.envelope)
    ) {
      return null;
    }
    return wire as unknown as CoopV2InteractionEnvelopeMaterial;
  } catch {
    return null;
  }
}

function isCompleteInteractionEnvelope(
  envelope: CoopAuthoritativeEnvelopeV1,
  surfaceClass: CoopOperationSurfaceClass,
  context?: CoopFrameContextV2,
): boolean {
  const operation = envelope.pendingOperation;
  const parsed = operation == null ? null : parseCoopOperationId(operation.id);
  const registration = operation == null ? null : interactionRegistration(operation.kind);
  return (
    envelope.version === 1
    && Number.isSafeInteger(envelope.sessionEpoch)
    && envelope.sessionEpoch > 0
    && Number.isSafeInteger(envelope.revision)
    && envelope.revision > 0
    && Number.isSafeInteger(envelope.wave)
    && envelope.wave >= 0
    && Number.isSafeInteger(envelope.turn)
    && envelope.turn >= 0
    && operation != null
    && interactionEnvelopeDisposition(envelope) === "mechanical"
    && operation.status === "applied"
    && registration != null
    && registration.surfaceClass === surfaceClass
    && registration.logicalPhases.includes(envelope.logicalPhase)
    && registration.validatePayload(operation.payload)
    && embeddedAuthorityStateMatchesEnvelope(operation.kind, operation.payload, envelope.authoritativeState)
    && parsed != null
    && parsed.epoch === envelope.sessionEpoch
    && parsed.kind === operation.kind
    && parsed.owner === operation.owner
    && isCoopOperationSurfaceClass(surfaceClass)
    && isCompleteCoopV2InteractionAuthorityState(envelope)
    && (context == null || context.sessionEpoch === envelope.sessionEpoch)
  );
}

/**
 * Validate an interaction's immutable state coordinate independently from its operation address.
 *
 * Mystery is one transaction at wave N / turn 0, including terminals authored after an encounter battle
 * or no-battle effect has advanced `Battle.turn`. The ME_TERMINAL payload and common envelope must still
 * carry the exact later engine image. Every other interaction remains address-exact.
 */
export function isCompleteCoopV2InteractionAuthorityState(envelope: CoopAuthoritativeEnvelopeV1): boolean {
  const state = envelope.authoritativeState;
  return envelope.pendingOperation?.kind === "ME_TERMINAL"
    ? state.wave === envelope.wave && isCompleteCoopOperationAuthorityState(state, state.wave, state.turn)
    : isCompleteCoopOperationAuthorityState(state, envelope.wave, envelope.turn);
}

/**
 * Some terminal interactions embed the comprehensive Mystery result as well as the common authoritative
 * state field. They are one immutable result, not two competing images: reject the entry before it consumes
 * a V2 revision unless both copies are byte-semantically identical.
 */
function embeddedAuthorityStateMatchesEnvelope(
  operationKind: CoopOperationKind,
  payload: unknown,
  authoritativeState: CoopAuthoritativeEnvelopeV1["authoritativeState"],
): boolean {
  if (operationKind !== "BARGAIN" && operationKind !== "ME_TERMINAL") {
    return true;
  }
  if (!isPlainObject(payload)) {
    return false;
  }
  const outcomeValue = payload.outcome;
  if (!isPlainObject(outcomeValue) || !isPlainObject(outcomeValue.authoritativeState)) {
    return false;
  }
  return canonicalJson(outcomeValue.authoritativeState) === canonicalJson(authoritativeState);
}

type ProjectableControl = NonNullable<CoopNextControl>;

function successorWait(
  envelope: CoopAuthoritativeEnvelopeV1,
  allowedKinds: Extract<ProjectableControl, { kind: "AWAIT_SUCCESSOR" }>["allowedKinds"],
  allowNextWaveStart: boolean,
  coordinate: Readonly<{ wave: number; turn: number }> = envelope,
  allowedInteractionAddresses?: Extract<ProjectableControl, { kind: "AWAIT_SUCCESSOR" }>["allowedInteractionAddresses"],
  allowedControlAddresses?: Extract<ProjectableControl, { kind: "AWAIT_SUCCESSOR" }>["allowedControlAddresses"],
): ProjectableControl {
  const operation = envelope.pendingOperation;
  if (operation == null) {
    throw new Error("Cannot build an interaction successor wait without a committed operation");
  }
  return {
    kind: "AWAIT_SUCCESSOR",
    afterOperationId: operation.id,
    epoch: envelope.sessionEpoch,
    wave: coordinate.wave,
    turn: coordinate.turn,
    allowedKinds,
    ...(allowedInteractionAddresses == null ? {} : { allowedInteractionAddresses }),
    ...(allowedControlAddresses == null ? {} : { allowedControlAddresses }),
    allowNextWaveStart,
    expectedOperationId: null,
  };
}

function sharedInteraction(
  surfaceClass: Exclude<CoopOperationSurfaceClass, "op:faintSwitch" | "op:wave">,
  operationId: string,
  ownerSeatId: number,
  epoch: number,
  wave: number,
  turn: number,
  operationKind: CoopV2InteractionOperationKind,
  successorOperationKinds: readonly CoopV2InteractionOperationKind[],
  successorOperationIds: readonly string[] | null = null,
): ProjectableControl {
  return {
    kind: "SHARED_INTERACTION",
    surfaceClass,
    operationId,
    ownerSeatId,
    epoch,
    wave,
    turn,
    operationKind,
    successor: {
      operationKinds: [...successorOperationKinds],
      operationIds: successorOperationIds == null ? null : [...successorOperationIds],
    },
  };
}

/** Re-address one deterministic interaction result at the presentation's exact event coordinate. */
function operationIdAtSameAddress(operationId: string, operationKind: CoopV2InteractionOperationKind): string | null {
  const parsed = parseCoopOperationId(operationId);
  return parsed == null ? null : makeCoopOperationId(parsed.epoch, parsed.owner, parsed.pinnedSeq, operationKind);
}

/** A serialized prompt whose decision address is prompt+offset can enumerate every permitted result exactly. */
function operationIdsAfterPrompt(
  operationId: string,
  operationKind: CoopV2InteractionOperationKind,
  offsets: readonly number[],
): readonly string[] | null {
  const parsed = parseCoopOperationId(operationId);
  return parsed == null
    ? null
    : offsets.map(offset => makeCoopOperationId(parsed.epoch, parsed.owner, parsed.pinnedSeq + offset, operationKind));
}

/**
 * Total legacy-envelope -> typed successor registry. It is deliberately closed over every interaction kind:
 * adding a kind to V2_INTERACTION_KINDS without a successor arm fails the entry build instead of publishing
 * a nullable/local continuation.
 */
export function successorOfCoopV2InteractionEnvelope(
  surfaceClass: CoopOperationSurfaceClass,
  envelope: CoopAuthoritativeEnvelopeV1,
): ProjectableControl | null {
  const operation = envelope.pendingOperation;
  if (
    operation == null
    || !isCoopV2InteractionOperationEnvelope(envelope)
    || surfaceClass === "op:faintSwitch"
    || surfaceClass === "op:wave"
  ) {
    return null;
  }
  const payload = isPlainObject(operation.payload) ? operation.payload : null;
  const wait = (
    allowedKinds: Extract<ProjectableControl, { kind: "AWAIT_SUCCESSOR" }>["allowedKinds"],
    allowNextWaveStart: boolean,
    allowedInteractionAddresses?: Extract<
      ProjectableControl,
      { kind: "AWAIT_SUCCESSOR" }
    >["allowedInteractionAddresses"],
  ): ProjectableControl =>
    successorWait(envelope, allowedKinds, allowNextWaveStart, envelope, allowedInteractionAddresses);
  const shared = (
    cls: Exclude<CoopOperationSurfaceClass, "op:faintSwitch" | "op:wave">,
    operationKind: CoopV2InteractionOperationKind,
    operationId: string,
    ownerSeatId: number,
    successorOperationKinds: readonly CoopV2InteractionOperationKind[],
    successorOperationIds: readonly string[] | null = null,
  ): ProjectableControl =>
    sharedInteraction(
      cls,
      operationId,
      ownerSeatId,
      envelope.sessionEpoch,
      envelope.wave,
      envelope.turn,
      operationKind,
      successorOperationKinds,
      successorOperationIds,
    );

  switch (operation.kind) {
    case "ABILITY_PRESENT": {
      const resultOperationId = operationIdAtSameAddress(operation.id, "ABILITY_PICK");
      return resultOperationId == null
        ? null
        : shared("op:ability", "ABILITY_PRESENT", operation.id, operation.owner, ["ABILITY_PICK"], [resultOperationId]);
    }
    case "BARGAIN_PRESENT":
      if (!Array.isArray(payload?.sins) || payload.sins.length === 0) {
        return wait(["INTERACTION_COMMIT"], false);
      }
      {
        const resultOperationId = operationIdAtSameAddress(operation.id, "BARGAIN");
        return resultOperationId == null
          ? null
          : shared("op:bargain", "BARGAIN_PRESENT", operation.id, operation.owner, ["BARGAIN"], [resultOperationId]);
      }
    case "STORMGLASS_PRESENT": {
      const resultOperationId = operationIdAtSameAddress(operation.id, "STORMGLASS");
      return resultOperationId == null
        ? null
        : shared(
            "op:stormglass",
            "STORMGLASS_PRESENT",
            operation.id,
            operation.owner,
            ["STORMGLASS"],
            [resultOperationId],
          );
    }
    case "REWARD":
      // Lock/check/transfer and paid shop rows complete one immutable mutation but deliberately keep the
      // same reward phase actionable. The result entry itself re-authorizes that exact phase generation;
      // reward picks, rerolls, and terminal skips close it and must await a separately-authored successor.
      return payload?.terminal !== true
        && (payload?.label === "shop"
          || payload?.label === "check"
          || payload?.label === "transfer"
          || payload?.label === "lock")
        ? shared("op:reward", "REWARD", operation.id, operation.owner, ["REWARD", "REWARD_PRESENT"])
        : wait(
            ["INTERACTION_COMMIT", "CONTROL_COMMIT", "WAVE_ADVANCE", "TERMINAL_COMMIT"],
            payload?.terminal === true,
            payload?.terminal === true && rewardSurfaceIdentity(payload.rewardSurface)
              ? [{ surfaceClass: "op:me", operationKind: "ME_TERMINAL", wave: envelope.wave, turn: 0 }]
              : undefined,
          );
    case "SHOP_BUY":
      return payload?.terminal === false
        ? shared("op:reward", "SHOP_BUY", operation.id, operation.owner, ["SHOP_BUY", "SHOP_PRESENT"])
        : wait(["INTERACTION_COMMIT", "CONTROL_COMMIT", "WAVE_ADVANCE", "TERMINAL_COMMIT"], payload?.terminal === true);
    case "REWARD_PRESENT":
      return shared("op:reward", "REWARD_PRESENT", operation.id, operation.owner, ["REWARD"]);
    case "SHOP_PRESENT":
      return shared("op:reward", "SHOP_PRESENT", operation.id, operation.owner, ["SHOP_BUY"]);
    case "BIOME_PICK":
      return wait(["INTERACTION_COMMIT", "CONTROL_COMMIT", "WAVE_ADVANCE", "TERMINAL_COMMIT"], true);
    case "CROSSROADS_PICK": {
      if (payload?.optionIndex !== 1) {
        return wait(["INTERACTION_COMMIT", "CONTROL_COMMIT", "WAVE_ADVANCE", "TERMINAL_COMMIT"], true);
      }
      const parsed = parseCoopOperationId(operation.id);
      const pinned = parsed == null ? -1 : parsed.pinnedSeq - COOP_CROSSROADS_SEQ_BASE;
      if (parsed == null || pinned < 0 || pinned > COOP_MAX_REACHABLE_COUNTER || parsed.owner !== operation.owner) {
        return null;
      }
      return {
        kind: "SHARED_INTERACTION",
        surfaceClass: "op:biome",
        operationId: makeCoopOperationId(
          envelope.sessionEpoch,
          operation.owner,
          COOP_BIOME_PICK_SEQ_BASE + pinned,
          "BIOME_PICK",
        ),
        ownerSeatId: operation.owner,
        epoch: envelope.sessionEpoch,
        wave: envelope.wave,
        turn: envelope.turn,
        operationKind: "BIOME_PICK",
        successor: {
          operationKinds: ["BIOME_PICK"],
          operationIds: [
            makeCoopOperationId(
              envelope.sessionEpoch,
              operation.owner,
              COOP_BIOME_PICK_SEQ_BASE + pinned,
              "BIOME_PICK",
            ),
          ],
        },
      };
    }
    case "REVIVAL": {
      if (payload?.type !== "prompt") {
        return wait(["TURN_COMMIT", "INTERACTION_COMMIT", "CONTROL_COMMIT", "WAVE_ADVANCE", "TERMINAL_COMMIT"], false);
      }
      const resultOperationIds = operationIdsAfterPrompt(operation.id, "REVIVAL", [1, 2, 3, 4, 5, 6]);
      return resultOperationIds == null
        ? null
        : shared("op:revival", "REVIVAL", operation.id, operation.owner, ["REVIVAL"], resultOperationIds);
    }
    case "CATCH_FULL": {
      if (payload?.type !== "prompt") {
        return wait(["TURN_COMMIT", "INTERACTION_COMMIT", "CONTROL_COMMIT", "WAVE_ADVANCE", "TERMINAL_COMMIT"], false);
      }
      const resultOperationIds = operationIdsAfterPrompt(operation.id, "CATCH_FULL", [1]);
      return resultOperationIds == null
        ? null
        : shared("op:catchFull", "CATCH_FULL", operation.id, operation.owner, ["CATCH_FULL"], resultOperationIds);
    }
    case "LEARN_MOVE":
    case "LEARN_MOVE_BATCH": {
      if (payload?.type !== "prompt") {
        return wait(["TURN_COMMIT", "INTERACTION_COMMIT", "CONTROL_COMMIT", "WAVE_ADVANCE", "TERMINAL_COMMIT"], false);
      }
      const resultOperationIds = operationIdsAfterPrompt(operation.id, operation.kind, [1]);
      return resultOperationIds == null
        ? null
        : shared("op:learnMove", operation.kind, operation.id, operation.owner, [operation.kind], resultOperationIds);
    }
    case "ME_PRESENT": {
      if (payload?.present !== true) {
        return wait(["INTERACTION_COMMIT", "CONTROL_COMMIT", "WAVE_ADVANCE", "TERMINAL_COMMIT"], false);
      }
      const presentation = payload != null && isPlainObject(payload.presentation) ? payload.presentation : null;
      const subPrompt = presentation != null && isPlainObject(presentation.subPrompt) ? presentation.subPrompt : null;
      const parsed = parseCoopOperationId(operation.id);
      const seq = parsed == null ? -1 : Math.floor(parsed.pinnedSeq / 8000);
      const pinned = seq - COOP_ME_PUMP_SEQ_BASE;
      if (parsed == null || parsed.kind !== "ME_PRESENT" || pinned < 0 || pinned > COOP_MAX_REACHABLE_COUNTER) {
        return null;
      }
      const inputOwnerSeatId = coopInteractionOwnerSeat(pinned);
      const meSuccessorKinds = [
        "ME_PRESENT",
        "ME_TERMINAL",
        "BARGAIN_PRESENT",
        "COLO_PICK",
        "REWARD_PRESENT",
        "SHOP_PRESENT",
      ] as const;
      if (subPrompt?.kind === "quiz") {
        return shared("op:me", "QUIZ_ANSWER", operation.id, inputOwnerSeatId, meSuccessorKinds);
      }
      if (subPrompt?.kind === "catchFull") {
        return shared("op:catchFull", "CATCH_FULL", operation.id, inputOwnerSeatId, meSuccessorKinds);
      }
      return shared("op:me", "ME_PRESENT", operation.id, inputOwnerSeatId, meSuccessorKinds);
    }
    case "ME_PICK":
    case "ME_SUB":
    case "ME_BUTTON":
    case "QUIZ_ANSWER":
      return wait(["INTERACTION_COMMIT", "CONTROL_COMMIT", "WAVE_ADVANCE", "TERMINAL_COMMIT"], false);
    case "ME_TERMINAL": {
      const destination = payload != null && isPlainObject(payload.destination) ? payload.destination : null;
      return successorWait(
        envelope,
        ["INTERACTION_COMMIT", "CONTROL_COMMIT", "WAVE_ADVANCE", "TERMINAL_COMMIT"],
        destination?.kind === "continue",
        envelope.authoritativeState,
        undefined,
        destination?.kind === "battle"
          && typeof destination.hostTurn === "number"
          && Number.isSafeInteger(destination.hostTurn)
          && destination.hostTurn > 0
          ? [
              {
                materialKind: "command-open",
                wave: envelope.authoritativeState.wave,
                turn: destination.hostTurn,
                // The command-open capture mints a later monotonic state tick after entry effects, so its
                // operation id is not knowable at the terminal commit. The complete material kind+address
                // remains exact; null permits only the id at that one stated coordinate.
                operationId: null,
              },
            ]
          : undefined,
      );
    }
    case "COLO_PICK": {
      if (payload?.type !== "board") {
        return wait(["INTERACTION_COMMIT", "CONTROL_COMMIT", "WAVE_ADVANCE", "TERMINAL_COMMIT"], false);
      }
      const resultOperationIds = operationIdsAfterPrompt(operation.id, "COLO_PICK", [1]);
      return resultOperationIds == null
        ? null
        : shared("op:colosseum", "COLO_PICK", operation.id, operation.owner, ["COLO_PICK"], resultOperationIds);
    }
    case "ABILITY_PICK":
    case "BARGAIN":
    case "STORMGLASS":
      return wait(["INTERACTION_COMMIT", "CONTROL_COMMIT", "WAVE_ADVANCE", "TERMINAL_COMMIT"], false);
    case "FAINT_SWITCH":
    case "WAVE_ADVANCE":
      return null;
  }
}

/**
 * Whether an interaction entry closes a real executable result phase before entering an ordered wait.
 * `AWAIT_SUCCESSOR` alone is not enough to answer this: absence presentations (`ME_PRESENT:false`) and an
 * empty Bargain offer deliberately install a no-input wait and therefore have no result picker to settle.
 * Keeping this distinction closed here makes authority admission and replica acknowledgement use the same
 * semantic rule instead of duplicating operation-kind guesses.
 */
export function requiresCoopV2InteractionTerminalProof(
  surfaceClass: CoopOperationSurfaceClass,
  envelope: CoopAuthoritativeEnvelopeV1,
): boolean {
  const operation = envelope.pendingOperation;
  const successor = successorOfCoopV2InteractionEnvelope(surfaceClass, envelope);
  if (operation == null || successor?.kind !== "AWAIT_SUCCESSOR") {
    return false;
  }
  return operation.kind !== "ME_PRESENT" && operation.kind !== "BARGAIN_PRESENT";
}

export function buildCoopV2InteractionEnvelopeEntry(input: {
  readonly context: CoopFrameContextV2;
  readonly surfaceClass: CoopOperationSurfaceClass;
  readonly envelope: CoopAuthoritativeEnvelopeV1;
}): Omit<CoopAuthorityEntry, "revision"> | null {
  if (!isCompleteInteractionEnvelope(input.envelope, input.surfaceClass, input.context)) {
    return null;
  }
  const operation = input.envelope.pendingOperation;
  if (operation == null) {
    return null;
  }
  const material = freezeInteractionWireMaterial({
    kind: COOP_V2_INTERACTION_ENVELOPE_KIND,
    surfaceClass: input.surfaceClass,
    envelope: input.envelope,
  });
  const wireOperation = material?.envelope.pendingOperation;
  if (
    material == null
    || wireOperation == null
    || !isCompleteInteractionEnvelope(material.envelope, material.surfaceClass, input.context)
  ) {
    return null;
  }
  const nextControl = successorOfCoopV2InteractionEnvelope(material.surfaceClass, material.envelope);
  if (nextControl == null || !validateNextControl(nextControl).ok) {
    return null;
  }
  return {
    context: input.context,
    operationId: wireOperation.id,
    kind: "INTERACTION_COMMIT",
    material: {
      digest: digestOfCoopV2InteractionEnvelope(material),
      payload: material,
    },
    nextControl,
    subsumes: [],
  };
}

export function decodeCoopV2InteractionEnvelope(entry: CoopAuthorityEntry): CoopV2InteractionEnvelopeMaterial | null {
  if (entry.kind !== "INTERACTION_COMMIT" || !isPlainObject(entry.material.payload)) {
    return null;
  }
  const payload = entry.material.payload;
  if (
    payload.kind !== COOP_V2_INTERACTION_ENVELOPE_KIND
    || !isCoopOperationSurfaceClass(payload.surfaceClass as string)
    || !isPlainObject(payload.envelope)
  ) {
    return null;
  }
  const material = payload as unknown as CoopV2InteractionEnvelopeMaterial;
  const expectedControl = successorOfCoopV2InteractionEnvelope(material.surfaceClass, material.envelope);
  if (
    !isCompleteInteractionEnvelope(material.envelope, material.surfaceClass, entry.context)
    || material.envelope.pendingOperation?.id !== entry.operationId
    || digestOfCoopV2InteractionEnvelope(material) !== entry.material.digest
    || expectedControl == null
    || !controlsEqual(expectedControl, entry.nextControl)
  ) {
    return null;
  }
  return material;
}

export class CoopV2InteractionCutover {
  private readonly harness: CoopAuthorityV2Shadow;
  private disposed = false;

  constructor(harness: CoopAuthorityV2Shadow) {
    this.harness = harness;
  }

  get authenticatedFrameContext(): CoopFrameContextV2 {
    return this.harness.authenticatedFrameContext;
  }

  /** Commit one complete, settled interaction result as the sole retained authority. */
  commitHostEnvelope(
    surfaceClass: CoopOperationSurfaceClass,
    envelope: CoopAuthoritativeEnvelopeV1,
  ): CoopAuthorityEntry | null {
    if (this.disposed) {
      return null;
    }
    const entry = buildCoopV2InteractionEnvelopeEntry({
      context: this.authenticatedFrameContext,
      surfaceClass,
      envelope,
    });
    if (entry == null) {
      return null;
    }
    const committed = this.harness.tapInteraction({
      entry,
      legacyDigest: entry.material.digest,
      legacyImage: entry,
    });
    if (committed == null) {
      return null;
    }
    return committed;
  }

  dispose(): void {
    this.disposed = true;
  }
}

export type CoopV2InteractionCommitResult = "not-cutover" | "committed" | "failed";

let activeCutover: CoopV2InteractionCutover | null = null;
const cutoverByDurability = new WeakMap<CoopDurabilityManager, CoopV2InteractionCutover>();

export function setActiveCoopV2InteractionCutover(cutover: CoopV2InteractionCutover): void {
  activeCutover = cutover;
}

export function clearActiveCoopV2InteractionCutover(cutover?: CoopV2InteractionCutover): void {
  if (cutover == null || activeCutover === cutover) {
    activeCutover = null;
  }
}

export function bindCoopV2InteractionCutover(
  durability: CoopDurabilityManager,
  cutover: CoopV2InteractionCutover,
): void {
  cutoverByDurability.set(durability, cutover);
}

export function unbindCoopV2InteractionCutover(
  durability: CoopDurabilityManager,
  cutover?: CoopV2InteractionCutover,
): void {
  if (cutover == null || cutoverByDurability.get(durability) === cutover) {
    cutoverByDurability.delete(durability);
  }
}

export function isCoopV2InteractionCutoverActive(durability?: CoopDurabilityManager | null): boolean {
  return (durability == null ? activeCutover : cutoverByDurability.get(durability)) != null;
}

/**
 * Common old-journal seam: commit eligible interaction results into V2. A
 * negotiated cutover never falls back to `op:global` after a failed V2 commit.
 */
export function commitCoopV2InteractionEnvelope(
  surfaceClass: CoopOperationSurfaceClass,
  envelope: CoopAuthoritativeEnvelopeV1,
  durability?: CoopDurabilityManager | null,
): CoopV2InteractionCommitResult {
  const disposition = interactionEnvelopeDisposition(envelope);
  if (disposition === "unrelated") {
    return "not-cutover";
  }
  const cutover = durability == null ? activeCutover : cutoverByDurability.get(durability);
  if (cutover == null) {
    return "not-cutover";
  }
  // The authority accepted this proposal/observation, but it is deliberately absent from the mechanical
  // log. A later complete presentation or terminal result carries the progression revision.
  if (disposition === "telemetry") {
    return "committed";
  }
  return cutover.commitHostEnvelope(surfaceClass, envelope) == null ? "failed" : "committed";
}
