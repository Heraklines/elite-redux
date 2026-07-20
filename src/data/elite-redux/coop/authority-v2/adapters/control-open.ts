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
import { validateNextControl } from "#data/elite-redux/coop/authority-v2/next-control";
import type { CoopAuthoritativeBattleStateV1 } from "#data/elite-redux/coop/coop-transport";

export interface CoopCommandOpenMaterialV2 {
  readonly kind: "command-open";
  readonly wave: number;
  readonly turn: number;
  /** Complete authoritative image after encounter/entry effects and before human input. */
  readonly authoritativeState: CoopAuthoritativeBattleStateV1;
}

export interface BuildCommandOpenEntryInput {
  readonly context: CoopFrameContextV2;
  readonly operationId: string;
  readonly material: CoopCommandOpenMaterialV2;
  readonly command: Extract<CoopNextControl, { kind: "COMMAND_FRONTIER" }>;
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

export function commandOpenMaterialDigest(material: CoopCommandOpenMaterialV2): string {
  return `command-open:${fnv1a32(canonicalJson(material))}`;
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
