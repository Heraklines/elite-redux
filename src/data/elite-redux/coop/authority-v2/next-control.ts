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
import type { CoopOperationKind } from "#data/elite-redux/coop/coop-operation-envelope";
import type { CoopOperationSurfaceClass } from "#data/elite-redux/coop/coop-operation-surface-registry";

/** Every committed {@linkcode CoopNextControl} is projectable; nullable recovery frontier zero is separate. */
export type ProjectableControl = CoopNextControl;

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
    case "REWARD":
      return `REWARD/${encodeURIComponent(control.operationId)}/s${control.ownerSeatId}`;
    case "BIOME":
      return `BIOME/${encodeURIComponent(control.operationId)}/s${control.ownerSeatId}`;
    case "MYSTERY":
      return `MYSTERY/${encodeURIComponent(control.operationId)}/s${control.ownerSeatId}`;
    case "SHARED_INTERACTION":
      return (
        `SHARED_INTERACTION/${encodeURIComponent(control.surfaceClass)}`
        + `/${encodeURIComponent(control.operationKind)}`
        + `/${encodeURIComponent(control.operationId)}/s${control.ownerSeatId}`
        + `/results:${canonicalInteractionKinds(control.successor.operationKinds).join(",")}`
        + `/resultIds:${
          control.successor.operationIds == null
            ? "*"
            : canonicalOpaqueIds(control.successor.operationIds).map(encodeURIComponent).join(",")
        }`
      );
    case "AWAIT_SUCCESSOR":
      return (
        `AWAIT_SUCCESSOR/${encodeURIComponent(control.afterOperationId)}`
        + `/e${control.epoch}/w${control.wave}/t${control.turn}`
        + `/${canonicalSuccessorKinds(control.allowedKinds).join(",")}`
        + `/next:${control.expectedOperationId == null ? "*" : encodeURIComponent(control.expectedOperationId)}`
      );
    case "TERMINAL":
      return `TERMINAL/${encodeURIComponent(control.terminalId)}`;
  }
}

// ---------------------------------------------------------------------------
// Equality / address-compatibility
// ---------------------------------------------------------------------------

/**
 * Structural equality of two stated controls (recovery frontier zero may be `null`). Because
 * {@linkcode controlIdOf} is a complete encoding, address equality IS structural
 * equality for two non-null controls - so this is exact, not a heuristic.
 */
export function controlsEqual(a: CoopNextControl | null, b: CoopNextControl | null): boolean {
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

/** Whether the immediate next mechanical entry satisfies an explicit address-constrained successor wait. */
export function successorWaitAllows(
  wait: Extract<ProjectableControl, { kind: "AWAIT_SUCCESSOR" }>,
  predecessorOperationId: string,
  nextKind: AuthorityEntryKind,
  nextOperationId: string,
  sessionEpoch: number,
): boolean {
  return (
    wait.afterOperationId === predecessorOperationId
    && wait.epoch === sessionEpoch
    && wait.allowedKinds.includes(nextKind)
    && (wait.expectedOperationId == null || wait.expectedOperationId === nextOperationId)
  );
}

/** Extract the closed operation subtype carried by the live V2 interaction-envelope material. */
export function interactionOperationKindOfEntry(entry: {
  readonly kind: AuthorityEntryKind;
  readonly material: { readonly payload: unknown };
}): V2InteractionOperationKind | null {
  if (
    entry.kind !== "INTERACTION_COMMIT"
    || entry.material.payload == null
    || typeof entry.material.payload !== "object"
  ) {
    return null;
  }
  const wrapper = entry.material.payload as Record<string, unknown>;
  const envelope = wrapper.envelope;
  if (envelope == null || typeof envelope !== "object") {
    return null;
  }
  const operation = (envelope as Record<string, unknown>).pendingOperation;
  if (operation == null || typeof operation !== "object") {
    return null;
  }
  const kind = (operation as Record<string, unknown>).kind;
  return typeof kind === "string" && kind in V2_INTERACTION_OPERATION_SURFACES
    ? (kind as V2InteractionOperationKind)
    : null;
}

/**
 * One total predecessor-control -> immediate-entry admission rule, shared by the authority log and the
 * replica control ledger. No executable control can be silently skipped by an unrelated later entry.
 */
export function controlAllowsSuccessorEntry(
  control: ProjectableControl,
  predecessorOperationId: string,
  next: {
    readonly kind: AuthorityEntryKind;
    readonly operationId: string;
    readonly context: { readonly sessionEpoch: number };
    readonly material: { readonly payload: unknown };
  },
): boolean {
  switch (control.kind) {
    case "AWAIT_SUCCESSOR":
      return successorWaitAllows(
        control,
        predecessorOperationId,
        next.kind,
        next.operationId,
        next.context.sessionEpoch,
      );
    case "COMMAND_FRONTIER":
      return next.kind === "TURN_COMMIT";
    case "SHARED_INTERACTION": {
      const resultKind = interactionOperationKindOfEntry(next);
      return (
        next.kind === "INTERACTION_COMMIT"
        && resultKind != null
        && control.successor.operationKinds.includes(resultKind)
        && (control.successor.operationIds == null || control.successor.operationIds.includes(next.operationId))
      );
    }
    case "REWARD":
    case "BIOME":
    case "MYSTERY":
      return next.kind === "INTERACTION_COMMIT";
    case "TERMINAL":
      return false;
  }
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
  if (control.kind === "TERMINAL" || control.kind === "AWAIT_SUCCESSOR") {
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

/**
 * The exact partition of a complete command frontier this replica seat must install.
 *
 * The authority entry always states every human actor, but each authenticated replica signs only the
 * controls owned by its numeric seat. Authority-log retirement requires a receipt from every required peer,
 * so the union of seat-scoped receipts proves the complete frontier without making one renderer fabricate
 * another player's input surface. This is the N-seat rule: adding players adds peer partitions, not fake
 * command phases on every browser.
 */
export function commandTargetsOwnedBySeat(
  control: Extract<ProjectableControl, { kind: "COMMAND_FRONTIER" }>,
  localSeatId: number,
): readonly CoopCommandControlTarget[] {
  return canonicalCommandTargets(control.commands.filter(command => command.ownerSeatId === localSeatId));
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
  }
  return issues;
}

function interactionIssues(control: Record<string, unknown>): string[] {
  const issues: string[] = [];
  addIssue(issues, "operationId", isNonEmptyString(control.operationId));
  addIssue(issues, "ownerSeatId", isNonNegativeInt(control.ownerSeatId));
  return issues;
}

type V2InteractionSurface = Exclude<CoopOperationSurfaceClass, "op:faintSwitch" | "op:wave">;

const V2_INTERACTION_SURFACES: Readonly<Record<V2InteractionSurface, true>> = {
  "op:ability": true,
  "op:bargain": true,
  "op:biome": true,
  "op:catchFull": true,
  "op:colosseum": true,
  "op:learnMove": true,
  "op:me": true,
  "op:revival": true,
  "op:reward": true,
  "op:stormglass": true,
};

type V2InteractionOperationKind = Exclude<CoopOperationKind, "FAINT_SWITCH" | "WAVE_ADVANCE">;

const V2_INTERACTION_OPERATION_SURFACES: Readonly<Record<V2InteractionOperationKind, readonly V2InteractionSurface[]>> =
  {
    ABILITY_PRESENT: ["op:ability"],
    ABILITY_PICK: ["op:ability"],
    BARGAIN_PRESENT: ["op:bargain"],
    BARGAIN: ["op:bargain"],
    BIOME_PICK: ["op:biome"],
    CATCH_FULL: ["op:catchFull"],
    COLO_PICK: ["op:colosseum"],
    CROSSROADS_PICK: ["op:biome"],
    LEARN_MOVE: ["op:learnMove"],
    LEARN_MOVE_BATCH: ["op:learnMove"],
    ME_BUTTON: ["op:me"],
    ME_PICK: ["op:me"],
    ME_PRESENT: ["op:me"],
    ME_SUB: ["op:me"],
    ME_TERMINAL: ["op:me", "op:reward", "op:biome"],
    QUIZ_ANSWER: ["op:me"],
    REVIVAL: ["op:revival"],
    REWARD: ["op:reward"],
    REWARD_PRESENT: ["op:reward"],
    SHOP_BUY: ["op:reward"],
    SHOP_PRESENT: ["op:reward"],
    STORMGLASS_PRESENT: ["op:stormglass"],
    STORMGLASS: ["op:stormglass"],
  };

function sharedInteractionIssues(control: Record<string, unknown>): string[] {
  const issues = interactionIssues(control);
  if (typeof control.surfaceClass !== "string" || !(control.surfaceClass in V2_INTERACTION_SURFACES)) {
    issues.push("surfaceClass");
  }
  if (typeof control.operationKind !== "string" || !(control.operationKind in V2_INTERACTION_OPERATION_SURFACES)) {
    issues.push("operationKind");
  } else if (
    typeof control.surfaceClass === "string"
    && control.surfaceClass in V2_INTERACTION_SURFACES
    && !V2_INTERACTION_OPERATION_SURFACES[control.operationKind as V2InteractionOperationKind].includes(
      control.surfaceClass as V2InteractionSurface,
    )
  ) {
    issues.push("surfaceClass/operationKind");
  }
  if (!isPlainObject(control.successor)) {
    issues.push("successor");
    return issues;
  }
  if (!Array.isArray(control.successor.operationKinds) || control.successor.operationKinds.length === 0) {
    issues.push("successor.operationKinds");
  } else {
    const seenKinds = new Set<string>();
    for (const [index, kind] of control.successor.operationKinds.entries()) {
      if (typeof kind !== "string" || !(kind in V2_INTERACTION_OPERATION_SURFACES)) {
        issues.push(`successor.operationKinds[${index}]`);
      } else if (seenKinds.has(kind)) {
        issues.push(`successor.operationKinds[${index}]: duplicate`);
      }
      if (typeof kind === "string") {
        seenKinds.add(kind);
      }
    }
  }
  if (control.successor.operationIds !== null) {
    if (!Array.isArray(control.successor.operationIds) || control.successor.operationIds.length === 0) {
      issues.push("successor.operationIds");
    } else {
      const seenIds = new Set<string>();
      for (const [index, operationId] of control.successor.operationIds.entries()) {
        if (!isNonEmptyString(operationId)) {
          issues.push(`successor.operationIds[${index}]`);
        } else if (seenIds.has(operationId)) {
          issues.push(`successor.operationIds[${index}]: duplicate`);
        }
        if (typeof operationId === "string") {
          seenIds.add(operationId);
        }
      }
    }
  }
  return issues;
}

const AUTHORITY_ENTRY_KINDS = [
  "TURN_COMMIT",
  "REPLACEMENT_COMMIT",
  "INTERACTION_COMMIT",
  "CONTROL_COMMIT",
  "WAVE_ADVANCE",
  "TERMINAL_COMMIT",
] as const;

type AuthorityEntryKind = (typeof AUTHORITY_ENTRY_KINDS)[number];

const AUTHORITY_ENTRY_KIND_ORDER: Readonly<Record<AuthorityEntryKind, number>> = {
  TURN_COMMIT: 0,
  REPLACEMENT_COMMIT: 1,
  INTERACTION_COMMIT: 2,
  CONTROL_COMMIT: 3,
  WAVE_ADVANCE: 4,
  TERMINAL_COMMIT: 5,
};

function isAuthorityEntryKind(value: unknown): value is AuthorityEntryKind {
  return typeof value === "string" && value in AUTHORITY_ENTRY_KIND_ORDER;
}

function canonicalSuccessorKinds(kinds: readonly AuthorityEntryKind[]): readonly AuthorityEntryKind[] {
  return [...new Set(kinds)].sort((a, b) => AUTHORITY_ENTRY_KIND_ORDER[a] - AUTHORITY_ENTRY_KIND_ORDER[b]);
}

function canonicalInteractionKinds(
  kinds: readonly V2InteractionOperationKind[],
): readonly V2InteractionOperationKind[] {
  return [...new Set(kinds)].sort();
}

function canonicalOpaqueIds(ids: readonly string[]): readonly string[] {
  return [...new Set(ids)].sort();
}

function successorWaitIssues(control: Record<string, unknown>): string[] {
  const issues: string[] = [];
  addIssue(issues, "afterOperationId", isNonEmptyString(control.afterOperationId));
  addIssue(issues, "epoch", isPositiveInt(control.epoch));
  addIssue(issues, "wave", isNonNegativeInt(control.wave));
  addIssue(issues, "turn", isNonNegativeInt(control.turn));
  if (!Array.isArray(control.allowedKinds) || control.allowedKinds.length === 0) {
    issues.push("allowedKinds");
  } else {
    const seen = new Set<string>();
    for (const [index, kind] of control.allowedKinds.entries()) {
      if (!isAuthorityEntryKind(kind)) {
        issues.push(`allowedKinds[${index}]`);
      } else if (seen.has(kind)) {
        issues.push(`allowedKinds[${index}]: duplicate`);
      }
      if (typeof kind === "string") {
        seen.add(kind);
      }
    }
  }
  if (control.expectedOperationId !== null && !isNonEmptyString(control.expectedOperationId)) {
    issues.push("expectedOperationId");
  }
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
    case "REWARD":
    case "BIOME":
    case "MYSTERY":
      return interactionIssues(control);
    case "SHARED_INTERACTION":
      return sharedInteractionIssues(control);
    case "AWAIT_SUCCESSOR":
      return successorWaitIssues(control);
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
