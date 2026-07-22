/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - explicit control-open boundary.
//
// A wave/interaction result may finish before the next executable command
// surface exists.  In that case its successor is AWAIT_SUCCESSOR, never a
// locally-derived CommandPhase.  The authority commits this entry only from the
// real post-entry-effects CommandPhase chokepoint.  It carries the complete
// immutable state observed there and states the exact aggregate command
// frontier that both ordinary delivery and recovery project.
// =============================================================================

import type {
  CoopAuthorityEntry,
  CoopFrameContextV2,
  CoopNextControl,
} from "#data/elite-redux/coop/authority-v2/contract";
import { controlsEqual, validateNextControl } from "#data/elite-redux/coop/authority-v2/next-control";
import type { CoopAuthoritativeBattleStateV1 } from "#data/elite-redux/coop/coop-transport";

export interface CoopCommandOpenMaterialV2 {
  readonly kind: "command-open";
  readonly wave: number;
  readonly turn: number;
  /** Complete authoritative image after encounter/entry effects and before human input. */
  readonly authoritativeState: CoopAuthoritativeBattleStateV1;
}

/**
 * Complete projection capsule for the deterministic every-five-wave Crossroads picker.
 *
 * Crossroads has no separate `*_PRESENT` result: its Stay/Leave options are static, but opening the
 * actionable handler is still a mechanical control boundary. Keeping the exact result operation and
 * constructor source wave in this CONTROL_COMMIT lets ordinary delivery and recovery install the same
 * generation without deriving it from a local phase queue.
 */
export interface CoopCrossroadsControlProjectionV2 {
  readonly kind: "crossroads";
  readonly sourceWave: number;
}

/**
 * Complete projection capsule for a NATURAL biome-end World-Map pick with no preceding Crossroads.
 *
 * Like Crossroads, a natural biome pick has no separate `*_PRESENT` result: its revealed routes are already
 * on the map, but opening the actionable ER_MAP owner handler is still a mechanical control boundary that
 * must be authored ahead of input. A chained crossroads-Leave instead authors the same BIOME_PICK control as
 * its interaction RESULT successor; both decode to the identical `biome` interaction projection.
 */
export interface CoopBiomeControlProjectionV2 {
  readonly kind: "biome";
  readonly sourceWave: number;
}

export type CoopInteractionControlProjectionV2 = CoopCrossroadsControlProjectionV2 | CoopBiomeControlProjectionV2;

/** A real shared-interaction chokepoint authored after the preceding result entered an ordered wait. */
export interface CoopInteractionOpenMaterialV2 {
  readonly kind: "interaction-open";
  readonly wave: number;
  readonly turn: number;
  /** Complete state at the exact pre-input boundary. */
  readonly authoritativeState: CoopAuthoritativeBattleStateV1;
  /** The exact executable control this material opens; included in the digest, not merely beside it. */
  readonly control: Extract<CoopNextControl, { kind: "SHARED_INTERACTION" }>;
  /** Closed phase-construction material used by recovery. */
  readonly projection: CoopInteractionControlProjectionV2;
}

export type CoopControlOpenMaterialV2 = CoopCommandOpenMaterialV2 | CoopInteractionOpenMaterialV2;

/**
 * Presentation phases whose completion callback is itself the structural path to CommandPhase.
 *
 * A faster authority can publish command-open while a slower replica is still sliding the next encounter
 * onto the field. Applying the command image at that instant runs the absolute field projector, which
 * deliberately kills battler tweens; Phaser then also drops the encounter tween's completion callback and
 * the replica can never create the real CommandPhase needed to prove the control. Keep the DATA entry
 * retained until that local presentation reaches its own command boundary. This is ordering, not a timeout
 * or local successor guess: the same immutable entry is retried there.
 */
const COMMAND_OPEN_PRESENTATION_BARRIERS = new Set(["EncounterPhase", "NewBiomeEncounterPhase", "NextEncounterPhase"]);

export function commandOpenMaterialMustWaitForPresentation(phaseName: string | null | undefined): boolean {
  return phaseName != null && COMMAND_OPEN_PRESENTATION_BARRIERS.has(phaseName);
}

export interface BuildCommandOpenEntryInput {
  readonly context: CoopFrameContextV2;
  readonly operationId: string;
  readonly material: CoopCommandOpenMaterialV2;
  readonly command: Extract<CoopNextControl, { kind: "COMMAND_FRONTIER" }>;
  readonly subsumes?: readonly number[];
}

export interface BuildInteractionOpenEntryInput {
  readonly context: CoopFrameContextV2;
  readonly operationId: string;
  readonly material: CoopInteractionOpenMaterialV2;
  readonly subsumes?: readonly number[];
}

function isPositiveSafeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Strict enough to prevent a checkpoint-shaped or tick-zero placeholder from
 * entering the mechanical log. Concrete engine adoption performs its own full
 * schema validation as well.
 */
export function isCompleteCommandOpenState(
  value: unknown,
  wave?: number,
  turn?: number,
): value is CoopAuthoritativeBattleStateV1 {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    value.version === 1
    && isPositiveSafeInt(value.tick)
    && isPositiveSafeInt(value.wave)
    && isPositiveSafeInt(value.turn)
    && (wave == null || value.wave === wave)
    && (turn == null || value.turn === turn)
    && Array.isArray(value.playerParty)
    && Array.isArray(value.enemyParty)
    && Array.isArray(value.field)
    && Array.isArray(value.arenaTags)
    && Array.isArray(value.pokeballCounts)
    && Array.isArray(value.playerModifiers)
    && Array.isArray(value.enemyModifiers)
  );
}

export function isCompleteCommandOpenMaterial(value: unknown): value is CoopCommandOpenMaterialV2 {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    value.kind === "command-open"
    && isPositiveSafeInt(value.wave)
    && isPositiveSafeInt(value.turn)
    && isCompleteCommandOpenState(value.authoritativeState, value.wave, value.turn)
  );
}

/** Validate the complete, recoverable Crossroads / natural-biome control-open image. */
export function isCompleteInteractionOpenMaterial(value: unknown): value is CoopInteractionOpenMaterialV2 {
  if (!isPlainObject(value) || !isPlainObject(value.control) || !isPlainObject(value.projection)) {
    return false;
  }
  const control = value.control as unknown as Extract<CoopNextControl, { kind: "SHARED_INTERACTION" }>;
  // A control-open opens exactly one deterministic biome-surface picker: the every-five-waves Crossroads or
  // a natural biome-end World-Map pick. The projection kind and the control's operation/successor kind must
  // agree; every other field is validated identically for both, so neither can borrow the other's proof.
  const expectedOperationKind =
    value.projection.kind === "crossroads"
      ? "CROSSROADS_PICK"
      : value.projection.kind === "biome"
        ? "BIOME_PICK"
        : null;
  return (
    value.kind === "interaction-open"
    && isPositiveSafeInt(value.wave)
    && isPositiveSafeInt(value.turn)
    && isCompleteCommandOpenState(value.authoritativeState, value.wave, value.turn)
    && expectedOperationKind != null
    && control.kind === "SHARED_INTERACTION"
    && control.surfaceClass === "op:biome"
    && control.operationKind === expectedOperationKind
    && isPositiveSafeInt(control.epoch)
    && control.wave === value.wave
    && control.turn === value.turn
    && validateNextControl(control).ok
    && control.successor.operationKinds.length === 1
    && control.successor.operationKinds[0] === expectedOperationKind
    && control.successor.operationIds?.length === 1
    && control.successor.operationIds[0] === control.operationId
    && isPositiveSafeInt(value.projection.sourceWave)
    && value.projection.sourceWave === value.wave
  );
}

export function commandOpenMaterialDigest(material: CoopCommandOpenMaterialV2): string {
  return `command-open:${fnv1a32(canonicalJson(material))}`;
}

export function interactionOpenMaterialDigest(material: CoopInteractionOpenMaterialV2): string {
  return `interaction-open:${fnv1a32(canonicalJson(material))}`;
}

export function buildCommandOpenEntry(input: BuildCommandOpenEntryInput): Omit<CoopAuthorityEntry, "revision"> {
  if (typeof input.operationId !== "string" || input.operationId.length === 0) {
    throw new Error("CONTROL_COMMIT operationId must be a non-empty string");
  }
  if (!isCompleteCommandOpenMaterial(input.material)) {
    throw new Error("CONTROL_COMMIT requires a complete post-entry-effects authoritative state");
  }
  const validation = validateNextControl(input.command);
  if (!validation.ok) {
    throw new Error(`CONTROL_COMMIT command frontier is malformed: ${validation.reason}`);
  }
  if (
    input.command.epoch !== input.context.sessionEpoch
    || input.command.wave !== input.material.wave
    || input.command.turn !== input.material.turn
  ) {
    throw new Error("CONTROL_COMMIT command frontier does not match its immutable state address");
  }
  return {
    context: input.context,
    operationId: input.operationId,
    kind: "CONTROL_COMMIT",
    material: {
      digest: commandOpenMaterialDigest(input.material),
      payload: structuredClone(input.material),
    },
    nextControl: structuredClone(input.command),
    subsumes: normalizeSubsumes(input.subsumes),
  };
}

export function decodeCommandOpenEntry(entry: CoopAuthorityEntry): CoopCommandOpenMaterialV2 | null {
  if (entry.kind !== "CONTROL_COMMIT" || !isCompleteCommandOpenMaterial(entry.material.payload)) {
    return null;
  }
  const material = entry.material.payload;
  if (
    commandOpenMaterialDigest(material) !== entry.material.digest
    || entry.nextControl.kind !== "COMMAND_FRONTIER"
    || entry.nextControl.epoch !== entry.context.sessionEpoch
    || entry.nextControl.wave !== material.wave
    || entry.nextControl.turn !== material.turn
    || !validateNextControl(entry.nextControl).ok
  ) {
    return null;
  }
  return material;
}

/** Build the ordered control boundary for one deterministic shared-input phase. */
export function buildInteractionOpenEntry(input: BuildInteractionOpenEntryInput): Omit<CoopAuthorityEntry, "revision"> {
  if (typeof input.operationId !== "string" || input.operationId.length === 0) {
    throw new Error("interaction CONTROL_COMMIT operationId must be a non-empty string");
  }
  if (!isCompleteInteractionOpenMaterial(input.material)) {
    throw new Error("interaction CONTROL_COMMIT requires a complete state and recoverable projection");
  }
  if (input.material.control.epoch !== input.context.sessionEpoch) {
    throw new Error("interaction CONTROL_COMMIT control does not match its authenticated epoch");
  }
  return {
    context: input.context,
    operationId: input.operationId,
    kind: "CONTROL_COMMIT",
    material: {
      digest: interactionOpenMaterialDigest(input.material),
      payload: structuredClone(input.material),
    },
    nextControl: structuredClone(input.material.control),
    subsumes: normalizeSubsumes(input.subsumes),
  };
}

export function decodeInteractionOpenEntry(entry: CoopAuthorityEntry): CoopInteractionOpenMaterialV2 | null {
  if (entry.kind !== "CONTROL_COMMIT" || !isCompleteInteractionOpenMaterial(entry.material.payload)) {
    return null;
  }
  const material = entry.material.payload;
  if (
    interactionOpenMaterialDigest(material) !== entry.material.digest
    || entry.context.sessionEpoch !== material.control.epoch
    || !controlsEqual(material.control, entry.nextControl)
  ) {
    return null;
  }
  return material;
}

/** Decode either closed CONTROL_COMMIT material kind without guessing from its successor. */
export function decodeControlOpenEntry(entry: CoopAuthorityEntry): CoopControlOpenMaterialV2 | null {
  return decodeCommandOpenEntry(entry) ?? decodeInteractionOpenEntry(entry);
}

function normalizeSubsumes(values: readonly number[] | undefined): readonly number[] {
  if (values == null) {
    return [];
  }
  const unique = new Set<number>();
  for (const value of values) {
    if (!isPositiveSafeInt(value)) {
      throw new Error(`CONTROL_COMMIT subsumes contains invalid revision ${String(value)}`);
    }
    unique.add(value);
  }
  return [...unique].sort((a, b) => a - b);
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
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
