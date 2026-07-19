/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op authority-v2 Lane 3 - CANONICAL NEXT-CONTROL helpers (engine-free).
//
// Frozen decision 4 (contract.ts): "ONE canonical next-control representation -
// CoopNextControl. The authority STATES the successor control; the replica
// PROJECTS it. The guest never derives control from its local phase queue."
//
// This module is the PURE half of that decision: it turns a host-stated
// CoopNextControl into a stable string ADDRESS (controlId), decides equality /
// address-compatibility between two stated controls, and validates that a
// stated control is structurally well-formed BEFORE any engine touches it. It
// imports ONLY types (all `import type`, erased at runtime), so its whole import
// graph is engine/DOM-free and it runs in the node-pure vitest lane.
//
// NOTHING here reads globalScene or getCoopRuntime, and NOTHING here decides
// WHICH control is appropriate - the authority already did. These are the
// address + guard primitives the projector (control-projector.ts) and the
// replica pipeline (replica.ts) build on.
// =============================================================================

import type { CoopCommandControlTarget, CoopNextControl } from "#data/elite-redux/coop/authority-v2/contract";

/** A control that can actually be projected: any non-null {@linkcode CoopNextControl}. */
export type ProjectableControl = NonNullable<CoopNextControl>;

/** The discriminant of a projectable control. */
export type ControlKind = ProjectableControl["kind"];

// ---------------------------------------------------------------------------
// controlId - the stable string address of a stated control
// ---------------------------------------------------------------------------

/**
 * Derive the STABLE, canonical string address of a stated control. The address
 * is a COMPLETE encoding of the control (every field is present), so two
 * controls share an address IFF they are structurally identical - which is what
 * makes it sound as the receipt's `controlId` and as the projector's
 * already-installed key.
 *
 * Opaque string fields (operationId / terminalId) are percent-encoded so a
 * delimiter or reserved character inside an id can never collide two distinct
 * addresses into one (or split one across two). The scheme is deterministic and
 * identical on every client, so the host's receipt controlId matches the
 * replica's projected controlId byte-for-byte.
 */
export function controlIdOf(control: ProjectableControl): string {
  switch (control.kind) {
    case "COMMAND_FRONTIER":
      return (
        `COMMAND_FRONTIER/e${control.epoch}/w${control.wave}/t${control.turn}`
        + `/${canonicalCommandTargets(control.commands)
          .map(target => `f${target.fieldIndex}:s${target.ownerSeatId}:p${target.pokemonId}`)
          .join(",")}`
      );
    case "REPLACEMENT":
      return (
        `REPLACEMENT/e${control.epoch}/w${control.wave}/t${control.turn}`
        + `/o${control.occurrence}/f${control.fieldIndex}/s${control.ownerSeatId}`
      );
    case "REWARD":
      return `REWARD/${encodeURIComponent(control.operationId)}/s${control.ownerSeatId}`;
    case "BIOME":
      return `BIOME/${encodeURIComponent(control.operationId)}/s${control.ownerSeatId}`;
    case "MYSTERY":
      return `MYSTERY/${encodeURIComponent(control.operationId)}/s${control.ownerSeatId}`;
    case "TERMINAL":
      return `TERMINAL/${encodeURIComponent(control.terminalId)}`;
  }
}

// ---------------------------------------------------------------------------
// Equality / address-compatibility
// ---------------------------------------------------------------------------

/**
 * Structural equality of two stated controls (either may be `null`). Because
 * {@linkcode controlIdOf} is a complete encoding, address equality IS structural
 * equality for two non-null controls - so this is exact, not a heuristic.
 */
export function controlsEqual(a: CoopNextControl, b: CoopNextControl): boolean {
  if (a == null || b == null) {
    return a == null && b == null;
  }
  return a.kind === b.kind && controlIdOf(a) === controlIdOf(b);
}

/**
 * Whether two stated controls target the SAME address (the same successor
 * control surface). Identical to {@linkcode controlsEqual} for non-null inputs;
 * named separately because the projector reasons in terms of addresses (an
 * already-installed surface is "the same address", not "an equal object").
 */
export function sameControlAddress(a: ProjectableControl, b: ProjectableControl): boolean {
  return controlIdOf(a) === controlIdOf(b);
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

/**
 * The seat the stated control belongs to, or `null` for a TERMINAL (the shared
 * terminal freeze is owner-less - it belongs to the whole session). Seat IDs,
 * never host/guest roles, authorize ownership decisions (contract ownership
 * rules) - the projector compares this against `ctx.localSeatId`.
 */
export function controlOwnerSeatIds(control: ProjectableControl): readonly number[] {
  if (control.kind === "TERMINAL") {
    return [];
  }
  if (control.kind === "COMMAND_FRONTIER") {
    return [...new Set(control.commands.map(command => command.ownerSeatId))].sort((a, b) => a - b);
  }
  return [control.ownerSeatId];
}

/**
 * The sole owner of a single-owner surface, or `null` for shared/multi-owner
 * controls. Callers that authorize a command frontier must use
 * {@linkcode controlOwnerSeatIds}; collapsing a multi-seat frontier is unsafe.
 */
export function controlOwnerSeatId(control: ProjectableControl): number | null {
  const owners = controlOwnerSeatIds(control);
  return owners.length === 1 ? owners[0] : null;
}

/** Canonical address of one real CommandPhase proof within an aggregate frontier. */
export function commandControlTargetId(
  epoch: number,
  wave: number,
  turn: number,
  target: CoopCommandControlTarget,
): string {
  return `COMMAND_TARGET/e${epoch}/w${wave}/t${turn}/f${target.fieldIndex}:s${target.ownerSeatId}:p${target.pokemonId}`;
}

/** Stable order for hashing, wire comparison, projection, and proof aggregation. */
export function canonicalCommandTargets(
  commands: readonly CoopCommandControlTarget[],
): readonly CoopCommandControlTarget[] {
  return [...commands].sort(
    (a, b) => a.fieldIndex - b.fieldIndex || a.ownerSeatId - b.ownerSeatId || a.pokemonId - b.pokemonId,
  );
}

// ---------------------------------------------------------------------------
// Validation guards
// ---------------------------------------------------------------------------

/** A structural validation verdict; the reason names the exact malformed field. */
export type ControlValidation = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const OK: ControlValidation = { ok: true };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/** A 1-based mechanical coordinate (epoch / wave / turn) must be a positive integer. */
function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** A seat id / field index / occurrence is a non-negative integer. */
function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function addIssue(issues: string[], field: string, valid: boolean): void {
  if (!valid) {
    issues.push(field);
  }
}

function commandFrontierIssues(control: Record<string, unknown>): string[] {
  const issues: string[] = [];
  addIssue(issues, "epoch", isPositiveInt(control.epoch));
  addIssue(issues, "wave", isPositiveInt(control.wave));
  addIssue(issues, "turn", isPositiveInt(control.turn));
  if (!Array.isArray(control.commands) || control.commands.length === 0) {
    issues.push("commands");
    return issues;
  }

  const seenFields = new Set<number>();
  const seenPokemon = new Set<number>();
  for (const [index, command] of control.commands.entries()) {
    if (!isPlainObject(command)) {
      issues.push(`commands[${index}]`);
      continue;
    }
    addIssue(issues, `commands[${index}].ownerSeatId`, isNonNegativeInt(command.ownerSeatId));
    addIssue(issues, `commands[${index}].pokemonId`, isPositiveInt(command.pokemonId));
    addIssue(issues, `commands[${index}].fieldIndex`, isNonNegativeInt(command.fieldIndex));
    if (isNonNegativeInt(command.fieldIndex)) {
      if (seenFields.has(command.fieldIndex)) {
        issues.push(`commands[${index}].fieldIndex: duplicate`);
      }
      seenFields.add(command.fieldIndex);
    }
    if (isPositiveInt(command.pokemonId)) {
      if (seenPokemon.has(command.pokemonId)) {
        issues.push(`commands[${index}].pokemonId: duplicate`);
      }
      seenPokemon.add(command.pokemonId);
    }
  }
  return issues;
}

function replacementIssues(control: Record<string, unknown>): string[] {
  const issues: string[] = [];
  addIssue(issues, "epoch", isPositiveInt(control.epoch));
  addIssue(issues, "wave", isPositiveInt(control.wave));
  addIssue(issues, "turn", isPositiveInt(control.turn));
  addIssue(issues, "occurrence", isNonNegativeInt(control.occurrence));
  addIssue(issues, "fieldIndex", isNonNegativeInt(control.fieldIndex));
  addIssue(issues, "ownerSeatId", isNonNegativeInt(control.ownerSeatId));
  return issues;
}

function interactionIssues(control: Record<string, unknown>): string[] {
  const issues: string[] = [];
  addIssue(issues, "operationId", isNonEmptyString(control.operationId));
  addIssue(issues, "ownerSeatId", isNonNegativeInt(control.ownerSeatId));
  return issues;
}

function terminalIssues(control: Record<string, unknown>): string[] {
  return isNonEmptyString(control.terminalId) ? [] : ["terminalId"];
}

/**
 * Return every structural issue in an untrusted stated control. This is the ONE
 * validator shared by wire admission, authority-entry admission, and projection;
 * a new control kind or field therefore cannot be accepted by one boundary and
 * silently rejected by another.
 */
export function nextControlIssues(control: unknown): string[] {
  if (!isPlainObject(control)) {
    return ["not an object"];
  }
  switch (control.kind) {
    case "COMMAND_FRONTIER":
      return commandFrontierIssues(control);
    case "REPLACEMENT":
      return replacementIssues(control);
    case "REWARD":
    case "BIOME":
    case "MYSTERY":
      return interactionIssues(control);
    case "TERMINAL":
      return terminalIssues(control);
    default:
      return ["kind: unknown control kind"];
  }
}

/**
 * Validate that a stated control is STRUCTURALLY well formed. Accepts unknown
 * input so every admission boundary can call it without an unsafe cast.
 */
export function validateNextControl(control: unknown): ControlValidation {
  const issues = nextControlIssues(control);
  return issues.length === 0 ? OK : { ok: false, reason: issues[0] };
}

/** Boolean convenience over {@linkcode validateNextControl}. */
export function isValidNextControl(control: unknown): control is ProjectableControl {
  return validateNextControl(control).ok;
}

/**
 * Whether an int-typed wire value is safe to treat as a coordinate. Exported for
 * the projector's own seat/field-index guards so both halves share one notion of
 * "a usable integer" (avoids a projector rejecting a value this module accepts).
 */
export function isUsableInteger(value: unknown): value is number {
  return isInt(value);
}
