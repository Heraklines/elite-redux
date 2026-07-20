/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - Interactions lane 3: the LEARN-MOVE / ABILITY / BARGAIN /
// COLOSSEUM / STORMGLASS interaction adapter.
//
// This is the v2 successor of five legacy per-surface interaction carriers:
//   - coop-learn-move-operation.ts  (single learn-move prompt + decision AND the
//     ER batch level-up panel: one typed decision SET per party slot),
//   - coop-ability-operation.ts     (the ability-picker owner choice),
//   - coop-bargain-operation.ts     (Giratina's bargain owner choice),
//   - coop-colosseum-operation.ts   (the between-rounds board/decision control
//     transaction with its immutable before-image ROLLBACK), and
//   - coop-stormglass-operation.ts  (the one-time weather choice).
//
// Every one of those surfaces is expressed here as ONE typed INTERACTION_COMMIT
// entry in the ONE revision order (frozen decision 1). It imports NOTHING at
// runtime from any legacy co-op netcode module - only the v2 contract types + the
// foundation lane helpers (next-control / authority-entry / replica). Every
// contract import is TYPE-only; the value imports (`controlIdOf`,
// `validateNextControl`, `isValidOperationId`) are themselves engine-free, so the
// whole adapter runs in the node-pure vitest lane with a recording sink.
//
// It holds NO module-global mutable state, reads NO ambient runtime
// (getCoopRuntime / globalScene), and owns NO timers or retry loops - retries
// belong to the log/leases (contract ownership rules), so a surface here is a pure
// builder + a pure applier seam + a pure shadow-parity descriptor.
//
// THREE SEAMS per surface (mirroring the turn-command / faint-replacement /
// wave-terminal adapters exactly):
//
//  (1) AUTHORITY - an owner-seat-addressed builder assembles an INTERACTION_COMMIT
//      commit-input from a typed choice. The MATERIAL is the typed choice image,
//      fingerprinted by a deterministic digest; the stated nextControl is an
//      OPTIONAL caller-supplied successor (default null: the interaction resolves
//      and retires at materialApplied). The guest never derives it.
//
//  (2) REPLICA - a material applier seam ADOPTS the typed image through an injected
//      sink, verifying the material digest before it installs. The COLOSSEUM board
//      keeps its legacy before-image ROLLBACK as an applier-seam contract:
//      adopt-or-restore, digest-verified - a rejected adopt restores the immutable
//      before-image so failure is externally indistinguishable from no attempt.
//
//  (3) SHADOW - a pure descriptor of the committed entry (surface + owner seat +
//      digest + successor address) and a comparator, so a dual-run shadow can prove
//      the AUTHORITATIVE statement equals what a legacy derivation produced.
// =============================================================================

import { isValidOperationId } from "#data/elite-redux/coop/authority-v2/authority-entry";
import type {
  CoopAuthoritativeMaterial,
  CoopAuthorityEntry,
  CoopFrameContextV2,
  CoopNextControl,
  CoopRuntimeContext,
} from "#data/elite-redux/coop/authority-v2/contract";
import {
  controlIdOf,
  type ProjectableControl,
  validateNextControl,
} from "#data/elite-redux/coop/authority-v2/next-control";
import type { ApplyMaterialFn } from "#data/elite-redux/coop/authority-v2/replica";

// ===========================================================================
// Shared constants
// ===========================================================================

/** The single entry kind every surface in this adapter commits. */
export const INTERACTION_COMMIT_KIND = "INTERACTION_COMMIT" as const;

/**
 * The maximum party slot (0-based, six-mon party). Every learn-move / batch
 * surface addresses a party slot in [0, 6).
 */
export const COOP_INTERACTION_MAX_PARTY_SLOTS = 6;

/**
 * The inclusive maximum Colosseum round, preserved from the legacy stride math
 * (`floor((STRIDE - 2) / 2)` with STRIDE = 100). A board/decision beyond it is a
 * malformed material and cannot be built or decoded.
 */
export const COOP_INTERACTION_COLOSSEUM_MAX_ROUND = 49;

/** The count of one-time Stormglass weather choices (legacy `weatherIndex` bound). */
export const COOP_INTERACTION_STORMGLASS_WEATHER_COUNT = 5;

// ===========================================================================
// Typed material - the concrete choice image each surface carries
// ===========================================================================

/** The closed set of interaction surface discriminants. */
export type CoopInteractionSurface =
  | "learn-move/prompt"
  | "learn-move/decision"
  | "learn-move-batch/prompt"
  | "learn-move-batch/decision"
  | "ability-pick"
  | "bargain"
  | "colosseum/board"
  | "colosseum/decision"
  | "stormglass";

/** The learn-move PROMPT image: the host presents one learnable move to the owner seat. */
export interface LearnMovePromptMaterial {
  readonly surface: "learn-move/prompt";
  readonly ownerSeatId: number;
  readonly partySlot: number;
  readonly moveId: number;
  readonly maxMoveCount: number;
}

/** The learn-move DECISION image: the owner's resolved forget-slot for one learnable move. */
export interface LearnMoveDecisionMaterial {
  readonly surface: "learn-move/decision";
  readonly ownerSeatId: number;
  readonly partySlot: number;
  readonly moveId: number;
  /** The overwritten move slot, or a decline sentinel (any safe integer - the engine owns the meaning). */
  readonly forgetSlot: number;
  readonly maxMoveCount: number;
}

/** The batch level-up PROMPT image: every learnable move offered for one party slot at once. */
export interface LearnMoveBatchPromptMaterial {
  readonly surface: "learn-move-batch/prompt";
  readonly ownerSeatId: number;
  readonly partySlot: number;
  readonly learnableIds: readonly number[];
  readonly ownerIsGuest: boolean;
}

/**
 * The batch level-up DECISION image: ONE typed decision SET per party slot - the
 * owner's `[learnableId, forgetSlot]` assignments plus the fallback flag. This is
 * the ER batch panel resolved as a single authoritative material, never a stream
 * of per-move decisions.
 */
export interface LearnMoveBatchDecisionMaterial {
  readonly surface: "learn-move-batch/decision";
  readonly ownerSeatId: number;
  readonly partySlot: number;
  /** The `[learnableId, forgetSlot]` pairs the owner assigned across the panel. */
  readonly assignments: readonly (readonly [number, number])[];
  readonly fallback: boolean;
}

/** The ability-picker choice image: the resolved literal op code + slots/ability id. */
export interface AbilityPickMaterial {
  readonly surface: "ability-pick";
  readonly ownerSeatId: number;
  /** The verbatim resolved pick data (op-code + resolved slot/ability ids). */
  readonly data: readonly number[];
}

/** The bargain choice image: the owner's picked option + the opaque host-stated resolved outcome blob. */
export interface BargainChoiceMaterial {
  readonly surface: "bargain";
  readonly ownerSeatId: number;
  /** The bargain option the owner selected (0-based). */
  readonly choiceIndex: number;
  /**
   * The host-stated resolved run-state outcome the watcher applies verbatim. OPAQUE
   * to this adapter (JSON-shaped); the log never inspects it and only the digest
   * fingerprints it. A stormglass/reward outcome is a value, not an engine handle.
   */
  readonly outcome: unknown;
}

/** The Colosseum BOARD image: one host-stated between-rounds board for a pinned gauntlet. */
export interface ColosseumBoardMaterial {
  readonly surface: "colosseum/board";
  readonly ownerSeatId: number;
  /** The pinned interaction counter the gauntlet rides. */
  readonly pinned: number;
  readonly round: number;
  readonly labels: readonly string[];
}

/** The Colosseum DECISION image: the owner's picked board index for a pinned round. */
export interface ColosseumDecisionMaterial {
  readonly surface: "colosseum/decision";
  readonly ownerSeatId: number;
  readonly pinned: number;
  readonly round: number;
  /** The picked board column (0 or 1). */
  readonly index: 0 | 1;
}

/** The Stormglass choice image: the host-resolved one-time weather selection. */
export interface StormglassChoiceMaterial {
  readonly surface: "stormglass";
  readonly ownerSeatId: number;
  readonly weatherIndex: number;
  readonly weather: number;
}

/** The union of every interaction material this adapter commits + adopts. */
export type CoopInteractionMaterial =
  | LearnMovePromptMaterial
  | LearnMoveDecisionMaterial
  | LearnMoveBatchPromptMaterial
  | LearnMoveBatchDecisionMaterial
  | AbilityPickMaterial
  | BargainChoiceMaterial
  | ColosseumBoardMaterial
  | ColosseumDecisionMaterial
  | StormglassChoiceMaterial;

/** A committed INTERACTION_COMMIT material narrows the opaque contract payload to a typed image. */
export interface CoopInteractionCommitMaterial extends CoopAuthoritativeMaterial {
  readonly payload: CoopInteractionMaterial;
}

/** Thrown by the owner-seat-addressed builders on malformed input: an authority never commits a malformed entry. */
export class CoopInteractionBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoopInteractionBuildError";
  }
}

// ===========================================================================
// Validation - a malformed field is not a representable material
// ===========================================================================

/** A structural verdict; the reason names the exact offending field. */
export type InteractionValidation = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const VALID: InteractionValidation = { ok: true };

function isSafeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isPositiveInt(value: unknown): value is number {
  return isSafeInt(value) && value > 0;
}

function isNonNegativeInt(value: unknown): value is number {
  return isSafeInt(value) && value >= 0;
}

function isPartySlot(value: unknown): value is number {
  return isNonNegativeInt(value) && value < COOP_INTERACTION_MAX_PARTY_SLOTS;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isSafeIntArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isSafeInt);
}

function isAssignmentArray(value: unknown): value is (readonly [number, number])[] {
  return Array.isArray(value) && value.every(pair => Array.isArray(pair) && pair.length === 2 && pair.every(isSafeInt));
}

function isRound(value: unknown): value is number {
  return isNonNegativeInt(value) && value <= COOP_INTERACTION_COLOSSEUM_MAX_ROUND;
}

/**
 * Validate a typed interaction material. Because every surface is a named, closed
 * shape with finite-integer coordinates, a hole / non-finite value / bad enum is
 * rejected here on BOTH the build side and the adopt side (one shared guard, so
 * the two can never disagree on what is representable).
 */
export function validateInteractionMaterial(value: unknown): InteractionValidation {
  if (!isPlainObject(value)) {
    return { ok: false, reason: "material is not an object" };
  }
  if (!isNonNegativeInt(value.ownerSeatId)) {
    return { ok: false, reason: `ownerSeatId must be a non-negative integer (got ${String(value.ownerSeatId)})` };
  }
  const validate = SURFACE_VALIDATORS[value.surface as CoopInteractionSurface];
  return validate == null
    ? { ok: false, reason: `unknown interaction surface ${String(value.surface)}` }
    : validate(value);
}

/** Per-surface field validators, keyed by discriminant, so the top-level dispatch stays flat. */
const SURFACE_VALIDATORS: Record<CoopInteractionSurface, (m: Record<string, unknown>) => InteractionValidation> = {
  "learn-move/prompt": m =>
    firstFailure(
      partySlotField(m.partySlot),
      positiveIntField("moveId", m.moveId),
      safeIntField("maxMoveCount", m.maxMoveCount),
    ),
  "learn-move/decision": m =>
    firstFailure(
      partySlotField(m.partySlot),
      positiveIntField("moveId", m.moveId),
      safeIntField("forgetSlot", m.forgetSlot),
      safeIntField("maxMoveCount", m.maxMoveCount),
    ),
  "learn-move-batch/prompt": m =>
    firstFailure(
      partySlotField(m.partySlot),
      isSafeIntArray(m.learnableIds) ? null : { ok: false, reason: "learnableIds must be an integer array" },
      typeof m.ownerIsGuest === "boolean" ? null : { ok: false, reason: "ownerIsGuest must be a boolean" },
    ),
  "learn-move-batch/decision": m =>
    firstFailure(
      partySlotField(m.partySlot),
      isAssignmentArray(m.assignments)
        ? null
        : { ok: false, reason: "assignments must be an array of [learnableId, forgetSlot] integer pairs" },
      typeof m.fallback === "boolean" ? null : { ok: false, reason: "fallback must be a boolean" },
    ),
  "ability-pick": m => (isSafeIntArray(m.data) ? VALID : { ok: false, reason: "data must be an integer array" }),
  bargain: m =>
    firstFailure(
      nonNegativeIntField("choiceIndex", m.choiceIndex),
      m.outcome === undefined ? { ok: false, reason: "outcome must be present (a JSON-shaped value)" } : null,
    ),
  "colosseum/board": m =>
    firstFailure(
      nonNegativeIntField("pinned", m.pinned),
      roundField(m.round),
      Array.isArray(m.labels) && m.labels.every(label => typeof label === "string")
        ? null
        : { ok: false, reason: "labels must be a string array" },
    ),
  "colosseum/decision": m =>
    firstFailure(
      nonNegativeIntField("pinned", m.pinned),
      roundField(m.round),
      m.index === 0 || m.index === 1 ? null : { ok: false, reason: "index must be 0 or 1" },
    ),
  stormglass: m =>
    firstFailure(
      isNonNegativeInt(m.weatherIndex) && m.weatherIndex < COOP_INTERACTION_STORMGLASS_WEATHER_COUNT
        ? null
        : { ok: false, reason: `weatherIndex must be in [0, ${COOP_INTERACTION_STORMGLASS_WEATHER_COUNT})` },
      nonNegativeIntField("weather", m.weather),
    ),
};

function roundField(value: unknown): InteractionValidation | null {
  return isRound(value) ? null : { ok: false, reason: `round must be in [0, ${COOP_INTERACTION_COLOSSEUM_MAX_ROUND}]` };
}

/** Boolean convenience over {@link validateInteractionMaterial}. */
export function isValidInteractionMaterial(value: unknown): value is CoopInteractionMaterial {
  return validateInteractionMaterial(value).ok;
}

function firstFailure(...checks: (InteractionValidation | null)[]): InteractionValidation {
  for (const check of checks) {
    if (check != null && !check.ok) {
      return check;
    }
  }
  return VALID;
}

function partySlotField(value: unknown): InteractionValidation | null {
  return isPartySlot(value)
    ? null
    : {
        ok: false,
        reason: `partySlot must be an integer in [0, ${COOP_INTERACTION_MAX_PARTY_SLOTS}) (got ${String(value)})`,
      };
}

function positiveIntField(field: string, value: unknown): InteractionValidation | null {
  return isPositiveInt(value)
    ? null
    : { ok: false, reason: `${field} must be a positive integer (got ${String(value)})` };
}

function safeIntField(field: string, value: unknown): InteractionValidation | null {
  return isSafeInt(value) ? null : { ok: false, reason: `${field} must be a safe integer (got ${String(value)})` };
}

function nonNegativeIntField(field: string, value: unknown): InteractionValidation | null {
  return isNonNegativeInt(value)
    ? null
    : { ok: false, reason: `${field} must be a non-negative integer (got ${String(value)})` };
}

// ===========================================================================
// Deterministic digest (canonical JSON + FNV-1a 64) - identical on every client
// ===========================================================================

/**
 * Fingerprint an interaction material into its stable digest. Deterministic
 * (canonical key ordering + FNV-1a 64) and prefixed with the surface, so an
 * identical image on any client yields an identical digest and a duplicate
 * redelivery is provably the same material. Exposed so the replica applier + the
 * shadow seam agree on the exact scheme.
 */
export function interactionMaterialDigest(material: CoopInteractionMaterial): string {
  return `ic1-${material.surface}-${fnv1a64(canonicalize(material))}`;
}

// ===========================================================================
// (1) AUTHORITY - owner-seat-addressed builders (one per surface)
// ===========================================================================

/** The base input every owner-seat-addressed builder shares. */
export interface BuildInteractionEntryBase {
  /** The authenticated frame context stamped on the entry (mandatory, decision 3). */
  readonly context: CoopFrameContextV2;
  /** The stable wire identity of this interaction operation. */
  readonly operationId: string;
  /** The seat that owns this interaction surface (seat ids authorize ownership, never host/guest role). */
  readonly ownerSeatId: number;
  /** The successor control the authority states after this interaction. Missing/null fails construction. */
  readonly successor: CoopNextControl;
  /** Revisions this commit explicitly subsumes (supersession by log order); default none. */
  readonly subsumes?: readonly number[];
}

/** The learn-move (single) choice: a prompt presentation or the resolved forget-slot decision. */
export type LearnMoveChoice =
  | { readonly phase: "prompt"; readonly partySlot: number; readonly moveId: number; readonly maxMoveCount: number }
  | {
      readonly phase: "decision";
      readonly partySlot: number;
      readonly moveId: number;
      readonly forgetSlot: number;
      readonly maxMoveCount: number;
    };

/** The batch level-up choice: the whole-slot prompt or the ONE typed decision set per party slot. */
export type LearnMoveBatchChoice =
  | {
      readonly phase: "prompt";
      readonly partySlot: number;
      readonly learnableIds: readonly number[];
      readonly ownerIsGuest: boolean;
    }
  | {
      readonly phase: "decision";
      readonly partySlot: number;
      readonly assignments: readonly (readonly [number, number])[];
      readonly fallback: boolean;
    };

/** The Colosseum board/decision choice for one pinned gauntlet. */
export type ColosseumBoardChoice =
  | { readonly type: "board"; readonly pinned: number; readonly round: number; readonly labels: readonly string[] }
  | { readonly type: "decision"; readonly pinned: number; readonly round: number; readonly index: 0 | 1 };

/**
 * Assemble one INTERACTION_COMMIT commit-input from an already-validated material.
 * Validates identity (operationId) + the optional successor control, computes the
 * material digest, and returns the exact `Omit<CoopAuthorityEntry, "revision">`
 * the foundation log's `commit` accepts (it assigns the one global revision).
 * Throws on a structurally impossible entry - it must never enter the log.
 */
function assembleInteractionEntry(
  base: BuildInteractionEntryBase,
  material: CoopInteractionMaterial,
): Omit<CoopAuthorityEntry, "revision"> {
  const check = validateInteractionMaterial(material);
  if (!check.ok) {
    throw new CoopInteractionBuildError(`invalid ${material.surface} material: ${check.reason}`);
  }
  if (!isValidOperationId(base.operationId)) {
    throw new CoopInteractionBuildError(`invalid operationId ${String(base.operationId)}`);
  }
  const nextControl = base.successor;
  if (nextControl == null) {
    throw new CoopInteractionBuildError("interaction successor is required; use AWAIT_SUCCESSOR for an ordered wait");
  }
  const controlCheck = validateNextControl(nextControl as ProjectableControl);
  if (!controlCheck.ok) {
    throw new CoopInteractionBuildError(`invalid successor control: ${controlCheck.reason}`);
  }
  const commitMaterial: CoopInteractionCommitMaterial = {
    digest: interactionMaterialDigest(material),
    payload: material,
  };
  return {
    context: base.context,
    operationId: base.operationId,
    kind: INTERACTION_COMMIT_KIND,
    material: commitMaterial,
    nextControl,
    subsumes: normalizeSubsumes(base.subsumes),
  };
}

/** Build the owner-seat-addressed learn-move (single) INTERACTION_COMMIT for a prompt or decision. */
export function buildLearnMoveInteractionEntry(
  input: BuildInteractionEntryBase & { readonly choice: LearnMoveChoice },
): Omit<CoopAuthorityEntry, "revision"> {
  const { choice } = input;
  const material: LearnMovePromptMaterial | LearnMoveDecisionMaterial =
    choice.phase === "prompt"
      ? {
          surface: "learn-move/prompt",
          ownerSeatId: input.ownerSeatId,
          partySlot: choice.partySlot,
          moveId: choice.moveId,
          maxMoveCount: choice.maxMoveCount,
        }
      : {
          surface: "learn-move/decision",
          ownerSeatId: input.ownerSeatId,
          partySlot: choice.partySlot,
          moveId: choice.moveId,
          forgetSlot: choice.forgetSlot,
          maxMoveCount: choice.maxMoveCount,
        };
  return assembleInteractionEntry(input, material);
}

/**
 * Build the owner-seat-addressed batch level-up INTERACTION_COMMIT. The decision
 * phase carries the ER batch panel as ONE typed decision SET (the `[learnableId,
 * forgetSlot]` assignments) for a single party slot - never a stream of per-move
 * decisions.
 */
export function buildLearnMoveBatchInteractionEntry(
  input: BuildInteractionEntryBase & { readonly choice: LearnMoveBatchChoice },
): Omit<CoopAuthorityEntry, "revision"> {
  const { choice } = input;
  const material: LearnMoveBatchPromptMaterial | LearnMoveBatchDecisionMaterial =
    choice.phase === "prompt"
      ? {
          surface: "learn-move-batch/prompt",
          ownerSeatId: input.ownerSeatId,
          partySlot: choice.partySlot,
          learnableIds: [...choice.learnableIds],
          ownerIsGuest: choice.ownerIsGuest,
        }
      : {
          surface: "learn-move-batch/decision",
          ownerSeatId: input.ownerSeatId,
          partySlot: choice.partySlot,
          // Copy each pair faithfully (do NOT truncate to length 2) so a runtime-malformed
          // arity is caught by validation instead of silently repaired.
          assignments: choice.assignments.map(pair => [...pair] as readonly [number, number]),
          fallback: choice.fallback,
        };
  return assembleInteractionEntry(input, material);
}

/** Build the owner-seat-addressed ability-picker choice INTERACTION_COMMIT. */
export function buildAbilityPickInteractionEntry(
  input: BuildInteractionEntryBase & { readonly data: readonly number[] },
): Omit<CoopAuthorityEntry, "revision"> {
  const material: AbilityPickMaterial = {
    surface: "ability-pick",
    ownerSeatId: input.ownerSeatId,
    data: [...input.data],
  };
  return assembleInteractionEntry(input, material);
}

/** Build the owner-seat-addressed bargain choice INTERACTION_COMMIT (opaque resolved outcome blob). */
export function buildBargainInteractionEntry(
  input: BuildInteractionEntryBase & { readonly choiceIndex: number; readonly outcome: unknown },
): Omit<CoopAuthorityEntry, "revision"> {
  const material: BargainChoiceMaterial = {
    surface: "bargain",
    ownerSeatId: input.ownerSeatId,
    choiceIndex: input.choiceIndex,
    outcome: input.outcome,
  };
  return assembleInteractionEntry(input, material);
}

/** Build the owner-seat-addressed Colosseum board / decision INTERACTION_COMMIT. */
export function buildColosseumBoardInteractionEntry(
  input: BuildInteractionEntryBase & { readonly board: ColosseumBoardChoice },
): Omit<CoopAuthorityEntry, "revision"> {
  const { board } = input;
  const material: ColosseumBoardMaterial | ColosseumDecisionMaterial =
    board.type === "board"
      ? {
          surface: "colosseum/board",
          ownerSeatId: input.ownerSeatId,
          pinned: board.pinned,
          round: board.round,
          labels: [...board.labels],
        }
      : {
          surface: "colosseum/decision",
          ownerSeatId: input.ownerSeatId,
          pinned: board.pinned,
          round: board.round,
          index: board.index,
        };
  return assembleInteractionEntry(input, material);
}

/** Build the owner-seat-addressed Stormglass weather choice INTERACTION_COMMIT. */
export function buildStormglassInteractionEntry(
  input: BuildInteractionEntryBase & { readonly weatherIndex: number; readonly weather: number },
): Omit<CoopAuthorityEntry, "revision"> {
  const material: StormglassChoiceMaterial = {
    surface: "stormglass",
    ownerSeatId: input.ownerSeatId,
    weatherIndex: input.weatherIndex,
    weather: input.weather,
  };
  return assembleInteractionEntry(input, material);
}

/** Dedupe + sort a subsumes list and reject any non-positive/duplicate revision (fail loud at build). */
function normalizeSubsumes(subsumes: readonly number[] | undefined): readonly number[] {
  if (subsumes == null || subsumes.length === 0) {
    return [];
  }
  const seen = new Set<number>();
  for (const revision of subsumes) {
    if (!isPositiveInt(revision)) {
      throw new CoopInteractionBuildError(
        `subsumes revision must be a positive safe integer (got ${String(revision)})`,
      );
    }
    seen.add(revision);
  }
  return [...seen].sort((a, b) => a - b);
}

// ===========================================================================
// (2) REPLICA - the material applier seam(s)
// ===========================================================================

/**
 * Decode + verify an entry's material back into a typed interaction image. Returns
 * `null` when the entry is not a well-formed INTERACTION_COMMIT or its digest does
 * not match the payload (a tampered / mismatched redelivery), so a replica applier
 * refuses it instead of installing unverified state.
 */
export function decodeInteractionMaterial(entry: CoopAuthorityEntry): CoopInteractionMaterial | null {
  if (entry.kind !== INTERACTION_COMMIT_KIND) {
    return null;
  }
  const payload = entry.material.payload;
  if (!isValidInteractionMaterial(payload)) {
    return null;
  }
  // The digest must match the decoded image - proves the redelivery carries the exact
  // committed material (the log's tamper/duplicate guard), so we never adopt a payload
  // whose digest disagrees with its own contents.
  if (interactionMaterialDigest(payload) !== entry.material.digest) {
    return null;
  }
  return payload;
}

/**
 * The narrow replica-side engine seam for the FIVE non-Colosseum surfaces. A real
 * session adapts its BattleScene into this; the node-pure lane passes a recording
 * fake. Each `adopt*` installs the verified image into engine state and returns
 * whether it installed - a `false` withholds materialApplied. NO globalScene /
 * getCoopRuntime read lives behind it: the concrete adapter captures the scene from
 * the passed context.
 */
export interface CoopInteractionSink {
  /** Adopt a learn-move (single) prompt OR decision image. */
  adoptLearnMove(ctx: CoopRuntimeContext, material: LearnMovePromptMaterial | LearnMoveDecisionMaterial): boolean;
  /** Adopt a batch level-up prompt OR the one-per-slot decision set. */
  adoptLearnMoveBatch(
    ctx: CoopRuntimeContext,
    material: LearnMoveBatchPromptMaterial | LearnMoveBatchDecisionMaterial,
  ): boolean;
  /** Adopt an ability-picker choice image. */
  adoptAbilityPick(ctx: CoopRuntimeContext, material: AbilityPickMaterial): boolean;
  /** Adopt a bargain choice image (the opaque outcome blob applied verbatim). */
  adoptBargain(ctx: CoopRuntimeContext, material: BargainChoiceMaterial): boolean;
  /** Adopt a Stormglass weather choice image. */
  adoptStormglass(ctx: CoopRuntimeContext, material: StormglassChoiceMaterial): boolean;
}

/**
 * Build the replica pipeline's {@link ApplyMaterialFn} for the five non-Colosseum
 * surfaces. It decodes + digest-verifies the committed material, then ADOPTS it
 * through the matching sink method (never derives). A Colosseum material is NOT
 * owned here (returns false) - it uses {@link createColosseumBoardApplier}, which
 * carries the before-image rollback contract.
 */
export function createInteractionApplier(sink: CoopInteractionSink): ApplyMaterialFn {
  return (ctx: CoopRuntimeContext, entry: CoopAuthorityEntry): boolean => {
    const material = decodeInteractionMaterial(entry);
    if (material == null) {
      return false;
    }
    switch (material.surface) {
      case "learn-move/prompt":
      case "learn-move/decision":
        return sink.adoptLearnMove(ctx, material);
      case "learn-move-batch/prompt":
      case "learn-move-batch/decision":
        return sink.adoptLearnMoveBatch(ctx, material);
      case "ability-pick":
        return sink.adoptAbilityPick(ctx, material);
      case "bargain":
        return sink.adoptBargain(ctx, material);
      case "stormglass":
        return sink.adoptStormglass(ctx, material);
      case "colosseum/board":
      case "colosseum/decision":
        // Not owned by this applier - the Colosseum transaction applier owns the
        // before-image rollback contract.
        return false;
    }
  };
}

/**
 * The Colosseum board applier seam - the before-image ROLLBACK contract made
 * explicit. It preserves the legacy control-transaction semantic:
 *   1. `captureBefore` snapshots the immutable coupled control state,
 *   2. `adopt` pre-applies the cursor + installs the board/decision into the live
 *      sink, returning whether it stuck (and MAY throw on a genuine engine fault),
 *   3. `restore` rolls the before-image back on ANY non-success.
 * So a rejected adopt is externally indistinguishable from no attempt.
 *
 * `TBefore` is the sink-owned snapshot type (opaque to the applier).
 */
export interface CoopColosseumBoardTransaction<TBefore = unknown> {
  /** Snapshot the coupled control state BEFORE any mutation (the immutable before-image). */
  captureBefore(): TBefore;
  /** Pre-apply the cursor + adopt into the live sink; returns whether it stuck. May throw on a real fault. */
  adopt(ctx: CoopRuntimeContext, material: ColosseumBoardMaterial | ColosseumDecisionMaterial): boolean;
  /** Restore the before-image (called on ANY non-success adopt). */
  restore(before: TBefore): void;
}

/**
 * Run the Colosseum adopt-or-restore transaction for one verified board/decision
 * image. Captures the before-image, attempts the adopt, and restores the
 * before-image on a `false` result OR a throw - the exact legacy shadow-atomic
 * seam. A throw propagates AFTER the restore (the replica pipeline classifies it
 * materialRejected), so a real engine fault is surfaced, never swallowed.
 */
export function applyColosseumBoardTransaction<TBefore>(
  ctx: CoopRuntimeContext,
  material: ColosseumBoardMaterial | ColosseumDecisionMaterial,
  transaction: CoopColosseumBoardTransaction<TBefore>,
): boolean {
  const before = transaction.captureBefore();
  let applied = false;
  try {
    applied = transaction.adopt(ctx, material);
    return applied;
  } finally {
    if (!applied) {
      transaction.restore(before);
    }
  }
}

/**
 * Build the replica pipeline's {@link ApplyMaterialFn} for the Colosseum board /
 * decision surface. Decodes + digest-verifies the committed material, then runs the
 * adopt-or-restore transaction (before-image rollback). Returns false for any
 * non-Colosseum material (those use {@link createInteractionApplier}).
 */
export function createColosseumBoardApplier<TBefore>(
  transaction: CoopColosseumBoardTransaction<TBefore>,
): ApplyMaterialFn {
  return (ctx: CoopRuntimeContext, entry: CoopAuthorityEntry): boolean => {
    const material = decodeInteractionMaterial(entry);
    if (material == null || (material.surface !== "colosseum/board" && material.surface !== "colosseum/decision")) {
      return false;
    }
    return applyColosseumBoardTransaction(ctx, material, transaction);
  };
}

// ===========================================================================
// (3) SHADOW SEAM - a pure descriptor + comparator
// ===========================================================================

/**
 * A canonical, comparable descriptor of one committed INTERACTION_COMMIT entry: the
 * surface, the owner seat, the operation identity, the material digest (which fully
 * encodes the typed choice), and the stated successor address. Two descriptors are
 * parity-equal IFF the AUTHORITY and the SHADOW agree on the exact interaction -
 * which is what a dual-run parity check asserts. Pure values only (no engine
 * handle), so it can be logged, diffed, and compared identically on either client.
 */
export interface CoopInteractionShadow {
  readonly surface: CoopInteractionSurface;
  readonly ownerSeatId: number;
  readonly operationId: string;
  readonly digest: string;
  /** The stable successor address (controlId), or `null` for a terminal interaction. */
  readonly successorControlId: string | null;
}

/**
 * Derive the shadow-parity descriptor from a built (or committed) INTERACTION_COMMIT
 * entry. Pure and total: it reads only the entry's own typed material + stated
 * control, so a shadow observer that INDEPENDENTLY built the same entry from the
 * legacy derivation produces a byte-equal descriptor iff they agree. Returns `null`
 * when the entry is not a decodable INTERACTION_COMMIT.
 */
export function shadowOfInteractionEntry(
  entry: Omit<CoopAuthorityEntry, "revision"> | CoopAuthorityEntry,
): CoopInteractionShadow | null {
  if (entry.kind !== INTERACTION_COMMIT_KIND) {
    return null;
  }
  const payload = entry.material.payload;
  if (!isValidInteractionMaterial(payload)) {
    return null;
  }
  if (interactionMaterialDigest(payload) !== entry.material.digest) {
    return null;
  }
  return {
    surface: payload.surface,
    ownerSeatId: payload.ownerSeatId,
    operationId: entry.operationId,
    digest: entry.material.digest,
    successorControlId: entry.nextControl == null ? null : controlIdOf(entry.nextControl),
  };
}

/**
 * Whether two interaction shadow descriptors agree (the parity assertion). Equality
 * is exact across every field, so a shadow run can prove the v2 adapter and the
 * legacy carrier resolved byte-identically before the cutover flips which one takes
 * effect.
 */
export function interactionShadowsAgree(a: CoopInteractionShadow, b: CoopInteractionShadow): boolean {
  return (
    a.surface === b.surface
    && a.ownerSeatId === b.ownerSeatId
    && a.operationId === b.operationId
    && a.digest === b.digest
    && a.successorControlId === b.successorControlId
  );
}

// ===========================================================================
// Internals - deterministic digest (self-contained; engine-free)
// ===========================================================================

/**
 * Deterministic stringifier: object keys ALWAYS emitted in sorted order (never
 * insertion order), arrays in their given order, numbers normalized so `1`, `1.0`,
 * and `-0` hash equal, and `undefined` neutralized. Identical on every client, so
 * two engines fingerprinting the same image produce the same digest.
 */
function canonicalize(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "number") {
    return canonNumber(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
  }
  return "null";
}

/** Normalize a number so `1`, `1.0`, `-0`, and non-finite values hash stably. */
function canonNumber(n: number): string {
  if (!Number.isFinite(n) || n === 0) {
    return "0";
  }
  if (Number.isInteger(n)) {
    return n.toString();
  }
  return n.toPrecision(12);
}

// FNV-1a 64-bit (BigInt): overflow-safe, deterministic, runs once per commit over a
// small canonical string. Same scheme as the turn-command adapter so a shadow digest
// is comparable in spirit; kept self-contained to avoid importing engine-adjacent code.
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

/** FNV-1a 64-bit over the UTF-16 code units of `s`, returned as a 16-char hex string. */
function fnv1a64(s: string): string {
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * FNV_PRIME) & MASK64;
  }
  return h.toString(16).padStart(16, "0");
}
