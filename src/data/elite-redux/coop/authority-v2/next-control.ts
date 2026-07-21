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

import type {
  CoopCommandControlTarget,
  CoopNextControl,
  CoopReplacementControlAddress,
} from "#data/elite-redux/coop/authority-v2/contract";
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
    case "REPLACEMENT":
      return (
        `REPLACEMENT/${encodeURIComponent(control.operationId)}/s${control.ownerSeatId}`
        + `/e${control.epoch}/w${control.wave}/t${control.turn}`
        + `/o${control.occurrence}/f${control.fieldIndex}`
        + `/remaining:${control.remaining
          .map(
            target =>
              `${encodeURIComponent(target.operationId)}:s${target.ownerSeatId}:e${target.epoch}:w${target.wave}`
              + `:t${target.turn}:o${target.occurrence}:f${target.fieldIndex}`,
          )
          .join(",")}`
      );
    case "SHARED_INTERACTION":
      return (
        `SHARED_INTERACTION/${encodeURIComponent(control.surfaceClass)}`
        + `/${encodeURIComponent(control.operationKind)}`
        + `/${encodeURIComponent(control.operationId)}/s${control.ownerSeatId}`
        + `/e${control.epoch}/w${control.wave}/t${control.turn}`
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
        + `/interactionAddresses:${canonicalAllowedInteractionAddresses(control.allowedInteractionAddresses)}`
        + `/nextWave:${control.allowNextWaveStart ? "1" : "0"}`
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
  nextMaterial: unknown,
): boolean {
  if (
    wait.afterOperationId !== predecessorOperationId
    || wait.epoch !== sessionEpoch
    || !wait.allowedKinds.includes(nextKind)
    || (wait.expectedOperationId != null && wait.expectedOperationId !== nextOperationId)
  ) {
    return false;
  }
  const address = mechanicalAddressOf(nextKind, sessionEpoch, nextMaterial);
  if (address == null) {
    return false;
  }
  if (address.epoch !== wait.epoch) {
    return false;
  }
  const interactionOperationKind = interactionOperationKindOfEntry({
    kind: nextKind,
    material: { payload: nextMaterial },
  });
  const interactionMaterial = objectRecord(nextMaterial);
  if (
    nextKind === "INTERACTION_COMMIT"
    && interactionOperationKind != null
    && wait.allowedInteractionAddresses?.some(
      allowed =>
        allowed.wave === wait.wave
        && allowed.surfaceClass === interactionMaterial?.surfaceClass
        && allowed.operationKind === interactionOperationKind
        && allowed.wave === address.wave
        && allowed.turn === address.turn,
    )
  ) {
    return true;
  }
  // A turn result parks at turn N before the engine finishes its post-effects settlement. A surviving
  // battle authors CONTROL_COMMIT for turn N+1. Victory/GameOver can likewise capture its complete
  // immutable WAVE_ADVANCE/TERMINAL_COMMIT state after the engine has advanced that settlement turn.
  //
  // Only the exact broad wait emitted by the TURN_COMMIT adapter receives this bounded N-or-N+1 rule.
  // Interaction/replacement waits stay exact, and arbitrary N+2 drift remains fail-closed.
  const controlOnly = wait.allowedKinds.length === 1 && wait.allowedKinds[0] === "CONTROL_COMMIT";
  const turnBoundaryKinds: readonly AuthorityEntryKind[] = [
    "CONTROL_COMMIT",
    "REPLACEMENT_COMMIT",
    "INTERACTION_COMMIT",
    "WAVE_ADVANCE",
    "TERMINAL_COMMIT",
  ];
  const turnBoundaryWait =
    wait.allowedKinds.length === turnBoundaryKinds.length
    && turnBoundaryKinds.every(kind => wait.allowedKinds.includes(kind));
  if (address.wave === wait.wave + 1) {
    // Battle-open control and settled wave/terminal material are authored at turn 1. A mystery encounter
    // is the one mechanical surface that legitimately opens before that battle turn exists: its complete
    // ME_PRESENT interaction image is captured at wave N+1 / turn 0. The predecessor must still explicitly
    // grant both the wave crossing and INTERACTION_COMMIT, so this does not admit an arbitrary pre-turn
    // command, replacement, wave, or terminal entry.
    const preTurnMystery =
      address.turn === 0
      && interactionOperationKindOfEntry({ kind: nextKind, material: { payload: nextMaterial } }) === "ME_PRESENT";
    return wait.allowNextWaveStart && (address.turn === 1 || preTurnMystery);
  }
  if (address.wave !== wait.wave) {
    return false;
  }
  if (nextKind === "CONTROL_COMMIT" && !controlOnly) {
    return broadWaitAllowsControlCommitTurn(
      nextMaterial,
      address.turn,
      wait.turn,
      wait.allowedKinds.includes("TURN_COMMIT"),
    );
  }
  if (turnBoundaryWait && (nextKind === "WAVE_ADVANCE" || nextKind === "TERMINAL_COMMIT")) {
    return address.turn === wait.turn || address.turn === wait.turn + 1;
  }
  return address.turn === wait.turn;
}

export interface CoopV2LocalPresentationInputProof {
  readonly sessionEpoch: number;
  readonly wave: number;
  readonly turn: number;
  readonly phaseName: string;
  /** True only for the active MESSAGE handler with an armed ACTION/CANCEL continuation. */
  readonly messageHandlerActionable: boolean;
}

/**
 * Whether an ordered wait explicitly grants a non-mechanical action-only presentation its local input lease.
 *
 * A terminal reward may first show the same-address LevelUpPhase produced by its already-committed Rare
 * Candy result, then show the N+1/t1 NextEncounterPhase intro before CONTROL_COMMIT can exist. Freezing
 * either action-only message creates a cycle: the presentation waits for V2 control while V2 control waits
 * for the presentation to reach the next ordered boundary. `allowNextWaveStart` is the authority's explicit
 * permission to leave the terminal interaction and grants only those two exact bridges. No arbitrary
 * same-wave message, choice handler, or wait without that permission is admitted.
 */
export function successorWaitAllowsLocalPresentationInput(
  wait: Extract<ProjectableControl, { kind: "AWAIT_SUCCESSOR" }>,
  proof: CoopV2LocalPresentationInputProof,
): boolean {
  if (!wait.allowNextWaveStart || proof.sessionEpoch !== wait.epoch || !proof.messageHandlerActionable) {
    return false;
  }
  const sameAddressLevelUp = proof.wave === wait.wave && proof.turn === wait.turn && proof.phaseName === "LevelUpPhase";
  const nextWaveIntro = proof.wave === wait.wave + 1 && proof.turn === 1 && proof.phaseName === "NextEncounterPhase";
  return sameAddressLevelUp || nextWaveIntro;
}

interface MechanicalAddress {
  readonly epoch: number;
  readonly wave: number;
  readonly turn: number;
}

function broadWaitAllowsControlCommitTurn(
  nextMaterial: unknown,
  nextTurn: number,
  waitTurn: number,
  allowSameTurnCommand: boolean,
): boolean {
  const controlMaterial = objectRecord(nextMaterial);
  // CONTROL_COMMIT closes two different authority boundaries:
  //
  // - ordinary command-open is authored after settlement advances into the next turn;
  // - a TURN_RESOLVE prompt decision can return to the still-open command turn;
  // - interaction-open authorizes a real picker (currently Crossroads) at the
  //   same settlement address as the interaction result that led to it.
  //
  // TURN_RESOLVE decisions are the only broad waits that also authorize TURN_COMMIT. That closed
  // distinction grants their command-open the same-turn edge without allowing an ordinary reward/shop
  // terminal to reopen its completed command turn. Treating interaction-open as command-open likewise
  // rejected a legitimate reward -> Crossroads successor even though the reward's wait explicitly
  // allowed CONTROL_COMMIT.
  // Unknown material remains fail-closed here; the adapter performs the full
  // digest/schema validation if admission succeeds.
  const expectedTurn =
    controlMaterial?.kind === "interaction-open"
      ? waitTurn
      : controlMaterial?.kind === "command-open"
        ? waitTurn + (allowSameTurnCommand ? 0 : 1)
        : null;
  return expectedTurn != null && nextTurn === expectedTurn;
}

function safeCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Decode the common mechanical coordinate every committed entry already carries in its immutable payload.
 * Admission uses this before a successor can consume its predecessor, so right-kind/wrong-wave entries fail
 * closed even when an adapter-specific applier would only discover the mismatch later.
 */
function mechanicalAddressOf(
  kind: AuthorityEntryKind,
  contextEpoch: number,
  material: unknown,
): MechanicalAddress | null {
  const payload = objectRecord(material);
  if (payload == null) {
    return null;
  }
  let epoch: unknown = contextEpoch;
  let wave: unknown;
  let turn: unknown;
  switch (kind) {
    case "TURN_COMMIT":
      epoch = payload.epoch ?? contextEpoch;
      wave = payload.wave;
      turn = payload.turn;
      break;
    case "REPLACEMENT_COMMIT": {
      const source = objectRecord(payload.sourceAddress);
      if (source == null) {
        return null;
      }
      epoch = source.epoch;
      wave = source.wave;
      turn = source.turn;
      break;
    }
    case "INTERACTION_COMMIT": {
      const envelope = objectRecord(payload.envelope);
      if (envelope == null) {
        return null;
      }
      epoch = envelope.sessionEpoch;
      wave = envelope.wave;
      turn = envelope.turn;
      break;
    }
    case "CONTROL_COMMIT":
      wave = payload.wave;
      turn = payload.turn;
      break;
    case "WAVE_ADVANCE":
    case "TERMINAL_COMMIT":
      wave = payload.wave;
      turn = payload.turn;
      break;
  }
  return safeCoordinate(epoch) && epoch > 0 && safeCoordinate(wave) && safeCoordinate(turn)
    ? { epoch, wave, turn }
    : null;
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

const TURN_RESOLVE_PROMPT_SURFACES = {
  CATCH_FULL: "op:catchFull",
  LEARN_MOVE: "op:learnMove",
  LEARN_MOVE_BATCH: "op:learnMove",
  REVIVAL: "op:revival",
} as const;

/**
 * A command frontier normally closes on TURN_COMMIT, but four closed interaction surfaces can be
 * discovered while that same turn is settling. Their immutable prompt must enter the mechanical log
 * before the player can answer it; requiring TURN_COMMIT first creates an impossible cycle.
 *
 * This is deliberately stricter than "any interaction at the same coordinate": only a registered
 * TURN_RESOLVE prompt whose envelope id is the Authority V2 entry id may interrupt command control.
 * Decisions, presentation interactions, and unknown future kinds remain rejected until their predecessor
 * explicitly states them.
 */
function isExactTurnResolvePromptEntry(next: {
  readonly kind: AuthorityEntryKind;
  readonly operationId: string;
  readonly material: { readonly payload: unknown };
}): boolean {
  if (next.kind !== "INTERACTION_COMMIT") {
    return false;
  }
  const wrapper = objectRecord(next.material.payload);
  const envelope = objectRecord(wrapper?.envelope);
  const operation = objectRecord(envelope?.pendingOperation);
  const payload = objectRecord(operation?.payload);
  const operationKind = operation?.kind;
  return (
    wrapper?.kind === "OPERATION_ENVELOPE_V1"
    && envelope?.logicalPhase === "TURN_RESOLVE"
    && operation?.id === next.operationId
    && typeof operationKind === "string"
    && operationKind in TURN_RESOLVE_PROMPT_SURFACES
    && wrapper.surfaceClass === TURN_RESOLVE_PROMPT_SURFACES[operationKind as keyof typeof TURN_RESOLVE_PROMPT_SURFACES]
    && operation.status === "applied"
    && payload?.type === "prompt"
  );
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
        next.material.payload,
      );
    case "COMMAND_FRONTIER": {
      const address = mechanicalAddressOf(next.kind, next.context.sessionEpoch, next.material.payload);
      return (
        (next.kind === "TURN_COMMIT" || isExactTurnResolvePromptEntry(next))
        && address?.epoch === control.epoch
        && address.wave === control.wave
        && address.turn === control.turn
      );
    }
    case "REPLACEMENT": {
      const address = mechanicalAddressOf(next.kind, next.context.sessionEpoch, next.material.payload);
      return (
        next.kind === "REPLACEMENT_COMMIT"
        && next.operationId === control.operationId
        && address?.epoch === control.epoch
        && address.wave === control.wave
        && address.turn === control.turn
      );
    }
    case "SHARED_INTERACTION": {
      const resultKind = interactionOperationKindOfEntry(next);
      const address = mechanicalAddressOf(next.kind, next.context.sessionEpoch, next.material.payload);
      return (
        next.kind === "INTERACTION_COMMIT"
        && resultKind != null
        && address?.epoch === control.epoch
        && address.wave === control.wave
        && address.turn === control.turn
        && control.successor.operationKinds.includes(resultKind)
        && (control.successor.operationIds == null || control.successor.operationIds.includes(next.operationId))
      );
    }
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

/** Stable address of one executable replacement head, independent of its not-yet-active immutable tail. */
export function replacementControlTargetId(target: CoopReplacementControlAddress): string {
  return (
    `REPLACEMENT_TARGET/${encodeURIComponent(target.operationId)}/s${target.ownerSeatId}`
    + `/e${target.epoch}/w${target.wave}/t${target.turn}/o${target.occurrence}/f${target.fieldIndex}`
  );
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

function replacementControlIssues(control: Record<string, unknown>): string[] {
  const issues = interactionIssues(control);
  addIssue(issues, "epoch", isPositiveInt(control.epoch));
  addIssue(issues, "wave", isPositiveInt(control.wave));
  addIssue(issues, "turn", isPositiveInt(control.turn));
  addIssue(issues, "occurrence", isNonNegativeInt(control.occurrence));
  addIssue(issues, "fieldIndex", isNonNegativeInt(control.fieldIndex));
  if (!Array.isArray(control.remaining)) {
    issues.push("remaining");
    return issues;
  }
  const headEpoch = control.epoch;
  const headWave = control.wave;
  const headTurn = control.turn;
  let priorOccurrence = control.occurrence;
  const operationIds = new Set<string>(
    typeof control.operationId === "string" && control.operationId.length > 0 ? [control.operationId] : [],
  );
  for (const [index, target] of control.remaining.entries()) {
    if (!isPlainObject(target)) {
      issues.push(`remaining[${index}]`);
      continue;
    }
    addIssue(issues, `remaining[${index}].operationId`, isNonEmptyString(target.operationId));
    addIssue(issues, `remaining[${index}].ownerSeatId`, isNonNegativeInt(target.ownerSeatId));
    addIssue(issues, `remaining[${index}].epoch`, isPositiveInt(target.epoch));
    addIssue(issues, `remaining[${index}].wave`, isPositiveInt(target.wave));
    addIssue(issues, `remaining[${index}].turn`, isPositiveInt(target.turn));
    addIssue(issues, `remaining[${index}].occurrence`, isNonNegativeInt(target.occurrence));
    addIssue(issues, `remaining[${index}].fieldIndex`, isNonNegativeInt(target.fieldIndex));
    if (target.epoch !== headEpoch || target.wave !== headWave || target.turn !== headTurn) {
      issues.push(`remaining[${index}]: boundary`);
    }
    if (
      isNonNegativeInt(target.occurrence)
      && (!isNonNegativeInt(priorOccurrence) || target.occurrence <= priorOccurrence)
    ) {
      issues.push(`remaining[${index}].occurrence: order`);
    }
    if (isNonNegativeInt(target.occurrence)) {
      priorOccurrence = target.occurrence;
    }
    if (isNonEmptyString(target.operationId)) {
      if (operationIds.has(target.operationId)) {
        issues.push(`remaining[${index}].operationId: duplicate`);
      }
      operationIds.add(target.operationId);
    }
  }
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
  addIssue(issues, "epoch", isPositiveInt(control.epoch));
  addIssue(issues, "wave", isNonNegativeInt(control.wave));
  addIssue(issues, "turn", isNonNegativeInt(control.turn));
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

function canonicalAllowedInteractionAddresses(
  addresses: Extract<ProjectableControl, { kind: "AWAIT_SUCCESSOR" }>["allowedInteractionAddresses"],
): string {
  if (addresses == null) {
    return "*";
  }
  return [...addresses]
    .map(
      address =>
        `${encodeURIComponent(address.surfaceClass)}:${encodeURIComponent(address.operationKind)}`
        + `:w${address.wave}:t${address.turn}`,
    )
    .sort()
    .join(",");
}

function successorWaitIssues(control: Record<string, unknown>): string[] {
  const issues: string[] = [];
  addIssue(issues, "afterOperationId", isNonEmptyString(control.afterOperationId));
  addIssue(issues, "epoch", isPositiveInt(control.epoch));
  addIssue(issues, "wave", isNonNegativeInt(control.wave));
  addIssue(issues, "turn", isNonNegativeInt(control.turn));
  addIssue(issues, "allowNextWaveStart", typeof control.allowNextWaveStart === "boolean");
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
  if (control.allowedInteractionAddresses !== undefined) {
    if (
      !Array.isArray(control.allowedInteractionAddresses)
      || control.allowedInteractionAddresses.length === 0
      || !Array.isArray(control.allowedKinds)
      || !control.allowedKinds.includes("INTERACTION_COMMIT")
    ) {
      issues.push("allowedInteractionAddresses");
    } else {
      const seen = new Set<string>();
      for (const [index, candidate] of control.allowedInteractionAddresses.entries()) {
        if (!isPlainObject(candidate)) {
          issues.push(`allowedInteractionAddresses[${index}]`);
          continue;
        }
        const operationKind = candidate.operationKind;
        const surfaceClass = candidate.surfaceClass;
        const key = `${String(surfaceClass)}:${String(operationKind)}:${String(candidate.wave)}:${String(candidate.turn)}`;
        if (
          typeof operationKind !== "string"
          || !(operationKind in V2_INTERACTION_OPERATION_SURFACES)
          || typeof surfaceClass !== "string"
          || !(surfaceClass in V2_INTERACTION_SURFACES)
          || !V2_INTERACTION_OPERATION_SURFACES[operationKind as V2InteractionOperationKind].includes(
            surfaceClass as V2InteractionSurface,
          )
          || !isNonNegativeInt(candidate.wave)
          || candidate.wave !== control.wave
          || !isNonNegativeInt(candidate.turn)
        ) {
          issues.push(`allowedInteractionAddresses[${index}]`);
        } else if (seen.has(key)) {
          issues.push(`allowedInteractionAddresses[${index}]: duplicate`);
        }
        seen.add(key);
      }
    }
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
    case "REPLACEMENT":
      return replacementControlIssues(control);
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
