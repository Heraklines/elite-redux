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

import type { CoopNextControl } from "#data/elite-redux/coop/authority-v2/contract";

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
    case "COMMAND":
      return `COMMAND/e${control.epoch}/w${control.wave}/t${control.turn}/s${control.ownerSeatId}/p${control.pokemonId}`;
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
export function controlOwnerSeatId(control: ProjectableControl): number | null {
  return control.kind === "TERMINAL" ? null : control.ownerSeatId;
}

// ---------------------------------------------------------------------------
// Validation guards
// ---------------------------------------------------------------------------

/** A structural validation verdict; the reason names the exact malformed field. */
export type ControlValidation = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const OK: ControlValidation = { ok: true };

function isInt(value: number): boolean {
  return Number.isSafeInteger(value);
}

/** A 1-based mechanical coordinate (epoch / wave / turn) must be a positive integer. */
function isPositiveInt(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/** A seat id / field index / occurrence is a non-negative integer. */
function isNonNegativeInt(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isNonEmptyString(value: string): boolean {
  return typeof value === "string" && value.length > 0;
}

/**
 * Validate that a stated control is STRUCTURALLY well-formed - the guard the
 * projector runs first so a malformed address is a named "rejected" (structural
 * impossibility) rather than a mid-projection engine crash. This checks SHAPE
 * only (finite coordinates, non-empty ids); it does NOT decide whether the
 * control is APPROPRIATE (the authority already did) and does not touch the
 * engine.
 */
export function validateNextControl(control: ProjectableControl): ControlValidation {
  switch (control.kind) {
    case "COMMAND":
      return firstFailure(
        positiveIntField("COMMAND", "epoch", control.epoch),
        positiveIntField("COMMAND", "wave", control.wave),
        positiveIntField("COMMAND", "turn", control.turn),
        nonNegativeIntField("COMMAND", "ownerSeatId", control.ownerSeatId),
        positiveIntField("COMMAND", "pokemonId", control.pokemonId),
      );
    case "REPLACEMENT":
      return firstFailure(
        positiveIntField("REPLACEMENT", "epoch", control.epoch),
        positiveIntField("REPLACEMENT", "wave", control.wave),
        positiveIntField("REPLACEMENT", "turn", control.turn),
        nonNegativeIntField("REPLACEMENT", "occurrence", control.occurrence),
        nonNegativeIntField("REPLACEMENT", "fieldIndex", control.fieldIndex),
        nonNegativeIntField("REPLACEMENT", "ownerSeatId", control.ownerSeatId),
      );
    case "REWARD":
    case "BIOME":
    case "MYSTERY":
      return firstFailure(
        nonEmptyStringField(control.kind, "operationId", control.operationId),
        nonNegativeIntField(control.kind, "ownerSeatId", control.ownerSeatId),
      );
    case "TERMINAL":
      return firstFailure(nonEmptyStringField("TERMINAL", "terminalId", control.terminalId));
  }
}

/** Return the first failing field verdict, or {@link OK} when every field passed. */
function firstFailure(...checks: (ControlValidation | null)[]): ControlValidation {
  for (const check of checks) {
    if (check != null) {
      return check;
    }
  }
  return OK;
}

/** A positive-integer field check: `null` when it passes, else a named failure. */
function positiveIntField(kind: ControlKind, field: string, value: number): ControlValidation | null {
  return isPositiveInt(value)
    ? null
    : { ok: false, reason: `${kind} ${field} must be a positive integer (got ${value})` };
}

/** A non-negative-integer field check: `null` when it passes, else a named failure. */
function nonNegativeIntField(kind: ControlKind, field: string, value: number): ControlValidation | null {
  return isNonNegativeInt(value)
    ? null
    : { ok: false, reason: `${kind} ${field} must be a non-negative integer (got ${value})` };
}

/** A non-empty-string field check: `null` when it passes, else a named failure. */
function nonEmptyStringField(kind: ControlKind, field: string, value: string): ControlValidation | null {
  return isNonEmptyString(value) ? null : { ok: false, reason: `${kind} ${field} must be a non-empty string` };
}

/** Boolean convenience over {@linkcode validateNextControl}. */
export function isValidNextControl(control: ProjectableControl): boolean {
  return validateNextControl(control).ok;
}

/**
 * Whether an int-typed wire value is safe to treat as a coordinate. Exported for
 * the projector's own seat/field-index guards so both halves share one notion of
 * "a usable integer" (avoids a projector rejecting a value this module accepts).
 */
export function isUsableInteger(value: number): boolean {
  return isInt(value);
}
