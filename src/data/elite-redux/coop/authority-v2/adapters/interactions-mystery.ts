/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - Interactions lane 2: MYSTERY-ENCOUNTER + CATCH-FULL +
// REVIVAL adapter (INTERACTION_COMMIT entries).
//
// This module is the authority-v2 replacement for three legacy interaction
// carriers:
//   - coop-me-operation.ts (owner-ordinal adoption; the 8M/9M present /
//     pick / sub / outcome / terminal machinery),
//   - coop-catch-full-operation.ts (party-full keep/release),
//   - coop-revival-operation.ts (fainted-slot revival pick).
//
// It imports NOTHING at runtime from any legacy co-op netcode - only the v2
// contract TYPES + the engine-free foundation helpers (next-control /
// authority-entry). It holds NO module-global mutable state, reads NO ambient
// runtime (every capability arrives on the passed CoopRuntimeContext or as an
// explicit argument), and adds NO retry loop (redelivery/leases live in the
// authority log). The whole import graph is type-only, so it runs in the
// node-pure vitest lane.
//
// FOUR SURFACES, each with a builder + a replica applier seam (digest-verified;
// the owner install closes any open watcher surface) + a shadow-parity seam:
//
//  (1) ME OPTION PICK - owner-seat addressed; HOST-owned and GUEST-owned are
//      SYMMETRIC by seat (no host/guest branch - the seat id authorizes). The
//      BATTLE-HANDOFF is stated as an EXPLICIT material field: the legacy
//      "terminal-without-trailing-resync" class (#693, a battle-spawning option
//      that fired a 9M terminal with no trailing 8M meResync) is no longer an
//      implicit shape a replica must infer - a battle-handoff pick CLOSES the ME
//      window by itself and states its battle successor, while a non-handoff
//      pick keeps the window open for the terminal to close.
//
//  (2) ME OUTCOME / TERMINAL - ONE entry that states the encounter's resolution
//      (leave / battle / battle-settled) and SUBSUMES the unretired ME waits on
//      its window via the log's `subsumes` mechanism. A replica holding a stale
//      ME option-pick wait is retired by ordinary log order - there is NO abort
//      predicate and NO second retention ledger.
//
//  (3) CATCH-FULL KEEP/RELEASE - the party-full decision (keep-into-slot vs
//      release), owner-seat addressed.
//
//  (4) REVIVAL PICK - the fainted-field-slot revival pick (party slot + species
//      identity), owner-seat addressed.
//
// MAJOR-3 DESIGNED OUT (mid-ME interaction-counter suppression):
//   The legacy path kept an embedded reward advance out of an open ME window
//   ONLY by delivery pacing (timing) - a fragile invariant held by luck. Here
//   the ME window is expressed as MATERIAL STATE (an open window owns exactly
//   its interaction counter), and the invariant is STRUCTURAL: an
//   embedded-advance builder addressed INSIDE an open ME window is REJECTED at
//   build time ({@link buildMysteryEmbeddedAdvanceEntry} throws). A reward
//   advance therefore cannot commit inside the encounter no matter how delivery
//   is paced - the window's own material forbids it.
// =============================================================================

import { isValidOperationId } from "#data/elite-redux/coop/authority-v2/authority-entry";
import type {
  CoopAuthoritativeMaterial,
  CoopAuthorityEntry,
  CoopAuthorityEntryKind,
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

/** The entry kind every surface in this adapter commits. */
export const INTERACTION_COMMIT_KIND: CoopAuthorityEntryKind = "INTERACTION_COMMIT";

/** Thrown by the authority-side builders on malformed input: an authority must NEVER commit a malformed entry. */
export class CoopInteractionBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoopInteractionBuildError";
  }
}

// ---------------------------------------------------------------------------
// Addressing - a named finite-integer coordinate per interaction (no positional
// arrays, so the legacy sparse-payload hole class is unrepresentable).
// ---------------------------------------------------------------------------

/**
 * The immutable address of ONE interaction decision. `interactionSeq` is the
 * pinned interaction counter (monotonic across whole interactions; for an ME it
 * is stable for the WHOLE encounter - the multi-step encoding rides `step`).
 * `ownerSeatId` is the seat that owns the decision - a seat id authorizes, never
 * a host/guest role, so a host-owned and a guest-owned interaction are symmetric
 * by construction.
 */
export interface CoopInteractionAddress {
  /** Session epoch (positive) - a superseded epoch's frame is a stale reject upstream. */
  readonly epoch: number;
  /** 1-based wave index. */
  readonly wave: number;
  /** 1-based turn index within the wave. */
  readonly turn: number;
  /** The pinned interaction counter (0-based, monotonic across whole interactions). */
  readonly interactionSeq: number;
  /** The seat that owns the decision (0-based). */
  readonly ownerSeatId: number;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** A structural verdict; the reason names the exact offending field. */
export type CoopInteractionValidation = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const VALID: CoopInteractionValidation = { ok: true };

/** Validate an interaction address: 1-based epoch/wave/turn, 0-based interactionSeq/ownerSeatId, all finite. */
export function validateInteractionAddress(address: unknown): CoopInteractionValidation {
  if (!isPlainObject(address)) {
    return { ok: false, reason: "address is not an object" };
  }
  if (!isPositiveInt(address.epoch)) {
    return { ok: false, reason: `address.epoch must be a positive integer (got ${String(address.epoch)})` };
  }
  if (!isPositiveInt(address.wave)) {
    return { ok: false, reason: `address.wave must be a positive integer (got ${String(address.wave)})` };
  }
  if (!isPositiveInt(address.turn)) {
    return { ok: false, reason: `address.turn must be a positive integer (got ${String(address.turn)})` };
  }
  if (!isNonNegativeInt(address.interactionSeq)) {
    return {
      ok: false,
      reason: `address.interactionSeq must be a non-negative integer (got ${String(address.interactionSeq)})`,
    };
  }
  if (!isNonNegativeInt(address.ownerSeatId)) {
    return {
      ok: false,
      reason: `address.ownerSeatId must be a non-negative integer (got ${String(address.ownerSeatId)})`,
    };
  }
  return VALID;
}

function cloneAddress(address: CoopInteractionAddress): CoopInteractionAddress {
  return {
    epoch: address.epoch,
    wave: address.wave,
    turn: address.turn,
    interactionSeq: address.interactionSeq,
    ownerSeatId: address.ownerSeatId,
  };
}

// ---------------------------------------------------------------------------
// The ME window - material state that makes MAJOR-3 structural.
// ---------------------------------------------------------------------------

/**
 * An OPEN mystery-encounter window. It OWNS exactly its `interactionSeq` for the
 * whole encounter (the legacy "one pinned counter spans present -> pick -> ...
 * -> terminal" rule, now first-class). While a window is open, no non-ME
 * interaction may be addressed at its owned counter - the structural successor
 * of the legacy mid-ME counter suppression that delivery pacing alone held.
 */
export interface CoopMysteryWindow {
  readonly epoch: number;
  readonly wave: number;
  /** The interaction counter this window owns for its whole lifetime. */
  readonly interactionSeq: number;
  /** The seat that opened the window (drives the encounter). */
  readonly ownerSeatId: number;
}

/** Open the ME window an option-pick address describes (a non-handoff pick opens/keeps it). */
export function openMysteryWindow(address: CoopInteractionAddress): CoopMysteryWindow {
  return {
    epoch: address.epoch,
    wave: address.wave,
    interactionSeq: address.interactionSeq,
    ownerSeatId: address.ownerSeatId,
  };
}

/**
 * Whether an address falls INSIDE an open ME window - the same epoch + wave and
 * the window's OWNED interaction counter. This is the exact "an embedded advance
 * cannot commit inside the encounter" predicate: the window holds its counter
 * from the pick through the terminal, so any non-ME interaction addressed at that
 * counter while the window is open is an embedded advance.
 */
export function addressInsideOpenWindow(window: CoopMysteryWindow, address: CoopInteractionAddress): boolean {
  return (
    address.epoch === window.epoch && address.wave === window.wave && address.interactionSeq === window.interactionSeq
  );
}

// ---------------------------------------------------------------------------
// Typed material - one discriminated union over the four surfaces + the embedded
// advance the window forbids. The log treats material as opaque; this adapter
// defines + validates the concrete shape on both the build and adopt sides.
// ---------------------------------------------------------------------------

/** The ME outcome an outcome/terminal entry states. */
export type CoopMysteryOutcome = "leave" | "battle" | "battle-settled";

/** The party-full decision a catch-full entry states. */
export type CoopCatchFullDecision = "keep" | "release";

/** ME option-pick material - owner-seat addressed; the battle-handoff is an EXPLICIT field. */
export interface CoopMysteryOptionPickMaterial {
  readonly kind: "me-option-pick";
  readonly address: CoopInteractionAddress;
  /** The option the owner picked (0-based). */
  readonly optionIndex: number;
  /** The per-encounter step (0 = top-level pick; >0 = a sub-pick / button / quiz ordinal). */
  readonly step: number;
  /**
   * The terminal-without-trailing-resync class, now EXPLICIT. `true` = this pick
   * spawns a battle and CLOSES the window by itself (no trailing ME resync -
   * #693); `false` = a normal pick that keeps the window open for the terminal.
   */
  readonly battleHandoff: boolean;
  /** The window state this pick leaves: "closed" for a battle-handoff, "open" otherwise. */
  readonly window: "open" | "closed";
}

/** ME outcome/terminal material - the ONE entry that resolves + closes the encounter. */
export interface CoopMysteryTerminalMaterial {
  readonly kind: "me-terminal";
  readonly address: CoopInteractionAddress;
  readonly outcome: CoopMysteryOutcome;
  /** A terminal always closes the window. */
  readonly window: "closed";
}

/**
 * The embedded reward-advance material the open ME window FORBIDS. It exists so
 * the rejection is a real, typed build path (a between-encounter reward advance
 * that a mis-paced legacy session could have slipped inside the ME) - not merely
 * an assertion in a comment.
 */
export interface CoopMysteryEmbeddedAdvanceMaterial {
  readonly kind: "me-embedded-advance";
  readonly address: CoopInteractionAddress;
}

/** Catch-full keep/release material. `partySlot` is -1 for release, 0..5 for keep-into-slot. */
export interface CoopCatchFullMaterial {
  readonly kind: "catch-full";
  readonly address: CoopInteractionAddress;
  readonly decision: CoopCatchFullDecision;
  /** -1 for release; the 0-based party slot the caught mon replaces for keep. */
  readonly partySlot: number;
  /** The species id of the caught mon (positive) - the identity the authority commits. */
  readonly speciesId: number;
}

/** Revival pick material - the fainted field slot + the chosen party slot + its identity. */
export interface CoopRevivalMaterial {
  readonly kind: "revival";
  readonly address: CoopInteractionAddress;
  /** The fainted player field slot being revived into (0-based). */
  readonly fieldIndex: number;
  /** The party slot the revive was drawn from (0-based). */
  readonly partySlot: number;
  /** The species id of the revived mon (positive) - the identity the authority commits. */
  readonly speciesId: number;
}

/** The typed material any interaction entry in this adapter carries. */
export type CoopInteractionMaterial =
  | CoopMysteryOptionPickMaterial
  | CoopMysteryTerminalMaterial
  | CoopMysteryEmbeddedAdvanceMaterial
  | CoopCatchFullMaterial
  | CoopRevivalMaterial;

/** The interaction kinds this adapter commits. */
export type CoopInteractionKind = CoopInteractionMaterial["kind"];

// ---------------------------------------------------------------------------
// Deterministic material digest (canonical JSON + FNV-1a). Identical on every
// client, so a redelivered entry proves identical and the replica confirms the
// digest of the material it adopts.
// ---------------------------------------------------------------------------

/**
 * Stable canonical JSON of a plain-JSON value: object keys sorted at every depth
 * so two structurally-equal payloads serialize byte-identically. Arrays keep
 * their order (it is meaningful).
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

/** FNV-1a 32-bit over a string; rendered as 8 lowercase hex digits. */
function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * The deterministic digest of an interaction material. Prefixed with the
 * material kind so two surfaces can never collide on a shared hash, and
 * length-tagged so it is a stable, wire-safe, bounded token.
 */
export function interactionMaterialDigest(material: CoopInteractionMaterial): string {
  const canonical = canonicalJson(material);
  return `ix1-${material.kind}-${canonical.length}-${fnv1a32(canonical)}`;
}

// ---------------------------------------------------------------------------
// Material validation (the shape is proven on BOTH the build side and the adopt
// side - the log payload is opaque, so this is the only shape guarantee).
// ---------------------------------------------------------------------------

/** Whether a value is a complete ME option-pick material. */
export function isValidMysteryOptionPickMaterial(value: unknown): value is CoopMysteryOptionPickMaterial {
  if (!isPlainObject(value) || value.kind !== "me-option-pick") {
    return false;
  }
  if (!validateInteractionAddress(value.address).ok) {
    return false;
  }
  if (!isNonNegativeInt(value.optionIndex) || !isNonNegativeInt(value.step)) {
    return false;
  }
  if (typeof value.battleHandoff !== "boolean") {
    return false;
  }
  // A battle-handoff pick CLOSES the window; a normal pick keeps it open. The two are cross-checked so a
  // malformed pick that claims a handoff but an open window (or vice versa) is not a representable material.
  return value.window === (value.battleHandoff ? "closed" : "open");
}

/** Whether a value is a complete ME outcome/terminal material. */
export function isValidMysteryTerminalMaterial(value: unknown): value is CoopMysteryTerminalMaterial {
  if (!isPlainObject(value) || value.kind !== "me-terminal") {
    return false;
  }
  if (!validateInteractionAddress(value.address).ok) {
    return false;
  }
  if (value.outcome !== "leave" && value.outcome !== "battle" && value.outcome !== "battle-settled") {
    return false;
  }
  return value.window === "closed";
}

/** Whether a value is a complete embedded-advance material. */
export function isValidMysteryEmbeddedAdvanceMaterial(value: unknown): value is CoopMysteryEmbeddedAdvanceMaterial {
  return isPlainObject(value) && value.kind === "me-embedded-advance" && validateInteractionAddress(value.address).ok;
}

/** Whether a value is a complete catch-full material. */
export function isValidCatchFullMaterial(value: unknown): value is CoopCatchFullMaterial {
  if (!isPlainObject(value) || value.kind !== "catch-full") {
    return false;
  }
  if (!validateInteractionAddress(value.address).ok) {
    return false;
  }
  if (!isPositiveInt(value.speciesId)) {
    return false;
  }
  if (value.decision === "release") {
    return value.partySlot === -1;
  }
  return value.decision === "keep" && isNonNegativeInt(value.partySlot) && value.partySlot < 6;
}

/** Whether a value is a complete revival material. */
export function isValidRevivalMaterial(value: unknown): value is CoopRevivalMaterial {
  if (!isPlainObject(value) || value.kind !== "revival") {
    return false;
  }
  if (!validateInteractionAddress(value.address).ok) {
    return false;
  }
  return (
    isNonNegativeInt(value.fieldIndex)
    && value.fieldIndex < 4
    && isNonNegativeInt(value.partySlot)
    && value.partySlot < 6
    && isPositiveInt(value.speciesId)
  );
}

/** Whether a value is any complete interaction material this adapter owns. */
export function isValidInteractionMaterial(value: unknown): value is CoopInteractionMaterial {
  return (
    isValidMysteryOptionPickMaterial(value)
    || isValidMysteryTerminalMaterial(value)
    || isValidMysteryEmbeddedAdvanceMaterial(value)
    || isValidCatchFullMaterial(value)
    || isValidRevivalMaterial(value)
  );
}

// ---------------------------------------------------------------------------
// Operation identity - a stable, wire-safe address per interaction (kind + coord).
// ---------------------------------------------------------------------------

function addrRoot(address: CoopInteractionAddress): string {
  return `e${address.epoch}/w${address.wave}/t${address.turn}/i${address.interactionSeq}/s${address.ownerSeatId}`;
}

/** The stable operationId for an ME option-pick step (kind + address + step). */
export function mysteryOptionPickOperationId(address: CoopInteractionAddress, step: number): string {
  return `IX/MEPICK/${addrRoot(address)}/n${step}`;
}

/** The stable operationId for an ME outcome/terminal (one per window). */
export function mysteryTerminalOperationId(address: CoopInteractionAddress): string {
  return `IX/METERM/${addrRoot(address)}`;
}

/** The stable operationId for an embedded advance addressed at an interaction counter. */
export function mysteryEmbeddedAdvanceOperationId(address: CoopInteractionAddress): string {
  return `IX/MEADV/${addrRoot(address)}`;
}

/** The stable operationId for a catch-full keep/release decision. */
export function catchFullOperationId(address: CoopInteractionAddress): string {
  return `IX/CATCHFULL/${addrRoot(address)}`;
}

/** The stable operationId for a revival pick (address + the fainted field slot). */
export function revivalOperationId(address: CoopInteractionAddress, fieldIndex: number): string {
  return `IX/REVIVAL/${addrRoot(address)}/f${fieldIndex}`;
}

// ---------------------------------------------------------------------------
// Successor-control helpers.
// ---------------------------------------------------------------------------

function validateSuccessor(control: CoopNextControl): void {
  const check = validateNextControl(control as ProjectableControl);
  if (!check.ok) {
    throw new CoopInteractionBuildError(`successor control is malformed: ${check.reason}`);
  }
}

function makeMaterial(material: CoopInteractionMaterial): CoopAuthoritativeMaterial {
  return { digest: interactionMaterialDigest(material), payload: material };
}

function normalizeSubsumes(subsumes: readonly number[] | undefined): readonly number[] {
  if (subsumes == null || subsumes.length === 0) {
    return [];
  }
  const seen = new Set<number>();
  for (const revision of subsumes) {
    if (!(Number.isSafeInteger(revision) && revision > 0)) {
      throw new CoopInteractionBuildError(`subsumes revision must be a positive safe integer (got ${revision})`);
    }
    seen.add(revision);
  }
  return [...seen].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// AUTHORITY builders. Each returns an Omit<CoopAuthorityEntry, "revision"> ready
// for CoopAuthorityLog.commit (which assigns the global revision). The builders
// THROW on malformed input - an authority must never commit a malformed entry.
// ---------------------------------------------------------------------------

/** Inputs to {@link buildMysteryOptionPickEntry}. */
export interface BuildMysteryOptionPickInput {
  readonly context: CoopFrameContextV2;
  readonly address: CoopInteractionAddress;
  /** The option the owner picked (0-based). */
  readonly optionIndex: number;
  /** The per-encounter step (default 0 = top-level pick). */
  readonly step?: number;
  /** The battle-handoff class (default false). A handoff CLOSES the window and states a battle successor. */
  readonly battleHandoff?: boolean;
  /**
   * The stated successor. For a non-handoff pick this is the ME's own MYSTERY
   * continuation (the encounter proceeds to its terminal); for a battle-handoff
   * it is the battle's COMMAND. Missing/null fails construction; use AWAIT_SUCCESSOR for an ordered wait.
   */
  readonly successor: CoopNextControl;
  /**
   * Revisions this pick subsumes - for a battle-handoff, the prior ME waits on
   * this window it closes. Compute via {@link mysteryWindowSubsumes}; default none.
   */
  readonly subsumes?: readonly number[];
  /** Override the derived operationId; default {@link mysteryOptionPickOperationId}. */
  readonly operationId?: string;
}

/**
 * The result of building an ME option-pick: the entry plus the resulting ME
 * WINDOW state. A non-handoff pick returns the OPEN window (the terminal must
 * later close it); a battle-handoff pick returns `null` (it closed the window by
 * itself - the terminal-without-trailing-resync class made explicit).
 */
export interface MysteryOptionPickResult {
  readonly entry: Omit<CoopAuthorityEntry, "revision">;
  readonly window: CoopMysteryWindow | null;
}

/**
 * Build the ONE authoritative INTERACTION_COMMIT entry for an ME option pick.
 * HOST-owned and GUEST-owned are symmetric: nothing branches on a role, only the
 * address's `ownerSeatId`. The BATTLE-HANDOFF is stated as an explicit material
 * field, so a replica never infers the terminal-without-trailing-resync class -
 * a handoff pick's material declares `battleHandoff: true` + a closed window.
 */
export function buildMysteryOptionPickEntry(input: BuildMysteryOptionPickInput): MysteryOptionPickResult {
  const addressCheck = validateInteractionAddress(input.address);
  if (!addressCheck.ok) {
    throw new CoopInteractionBuildError(`ME option-pick address invalid: ${addressCheck.reason}`);
  }
  const step = input.step ?? 0;
  if (!isNonNegativeInt(step)) {
    throw new CoopInteractionBuildError(`ME option-pick step must be a non-negative integer (got ${String(step)})`);
  }
  if (!isNonNegativeInt(input.optionIndex)) {
    throw new CoopInteractionBuildError(
      `ME option-pick optionIndex must be a non-negative integer (got ${String(input.optionIndex)})`,
    );
  }
  const battleHandoff = input.battleHandoff ?? false;
  const address = cloneAddress(input.address);
  const material: CoopMysteryOptionPickMaterial = {
    kind: "me-option-pick",
    address,
    optionIndex: input.optionIndex,
    step,
    battleHandoff,
    window: battleHandoff ? "closed" : "open",
  };
  const operationId = input.operationId ?? mysteryOptionPickOperationId(address, step);
  if (!isValidOperationId(operationId)) {
    throw new CoopInteractionBuildError(`ME option-pick operationId invalid: ${String(operationId)}`);
  }
  const successor = input.successor;
  if (successor == null) {
    throw new CoopInteractionBuildError("ME option-pick successor is required");
  }
  validateSuccessor(successor);

  const entry: Omit<CoopAuthorityEntry, "revision"> = {
    context: input.context,
    operationId,
    kind: INTERACTION_COMMIT_KIND,
    material: makeMaterial(material),
    nextControl: successor,
    subsumes: normalizeSubsumes(input.subsumes),
  };
  return { entry, window: battleHandoff ? null : openMysteryWindow(address) };
}

/** Inputs to {@link buildMysteryTerminalEntry}. */
export interface BuildMysteryTerminalInput {
  readonly context: CoopFrameContextV2;
  /** The window's address (the terminal closes the encounter opened at this address). */
  readonly address: CoopInteractionAddress;
  readonly outcome: CoopMysteryOutcome;
  /** The stated successor (battle -> COMMAND, leave/battle-settled -> REWARD | BIOME | COMMAND | AWAIT). */
  readonly successor: CoopNextControl;
  /**
   * Revisions this terminal subsumes - the unretired ME waits on its window.
   * Compute via {@link mysteryWindowSubsumes} over the log's retained frontier;
   * default none. This is how a stale ME option-pick wait is retired by log order.
   */
  readonly subsumes?: readonly number[];
  /** Override the derived operationId; default {@link mysteryTerminalOperationId}. */
  readonly operationId?: string;
}

/**
 * Build the ONE authoritative INTERACTION_COMMIT entry for an ME outcome/terminal.
 * It states the encounter's resolution and SUBSUMES the unretired ME waits on its
 * window (via `subsumes`) so a replica's stale option-pick wait is retired by
 * ordinary log order - never a bespoke abort. Always closes the window.
 */
export function buildMysteryTerminalEntry(input: BuildMysteryTerminalInput): Omit<CoopAuthorityEntry, "revision"> {
  const addressCheck = validateInteractionAddress(input.address);
  if (!addressCheck.ok) {
    throw new CoopInteractionBuildError(`ME terminal address invalid: ${addressCheck.reason}`);
  }
  if (input.outcome !== "leave" && input.outcome !== "battle" && input.outcome !== "battle-settled") {
    throw new CoopInteractionBuildError(`ME terminal outcome invalid: ${String(input.outcome)}`);
  }
  const address = cloneAddress(input.address);
  const material: CoopMysteryTerminalMaterial = {
    kind: "me-terminal",
    address,
    outcome: input.outcome,
    window: "closed",
  };
  const operationId = input.operationId ?? mysteryTerminalOperationId(address);
  if (!isValidOperationId(operationId)) {
    throw new CoopInteractionBuildError(`ME terminal operationId invalid: ${String(operationId)}`);
  }
  const successor = input.successor;
  if (successor == null) {
    throw new CoopInteractionBuildError("ME terminal successor is required");
  }
  validateSuccessor(successor);

  return {
    context: input.context,
    operationId,
    kind: INTERACTION_COMMIT_KIND,
    material: makeMaterial(material),
    nextControl: successor,
    subsumes: normalizeSubsumes(input.subsumes),
  };
}

/** Inputs to {@link buildMysteryEmbeddedAdvanceEntry}. */
export interface BuildMysteryEmbeddedAdvanceInput {
  readonly context: CoopFrameContextV2;
  readonly address: CoopInteractionAddress;
  /**
   * The CURRENTLY-open ME window, or `null` when no encounter is open. When
   * non-null AND the advance is addressed inside it, the build is REJECTED - the
   * structural MAJOR-3 guard. Pass the window returned by a non-handoff option pick.
   */
  readonly openWindow: CoopMysteryWindow | null;
  /** The stated successor (the reward/biome destination this advance heads to). */
  readonly successor: CoopNextControl;
  readonly subsumes?: readonly number[];
  readonly operationId?: string;
}

/**
 * Build an embedded reward-advance INTERACTION_COMMIT entry - and REJECT it (throw
 * {@link CoopInteractionBuildError}) when it is addressed INSIDE an open ME window.
 *
 * This is the structural expression of MAJOR-3: the legacy path kept an embedded
 * reward advance out of an open ME window only by delivery pacing (a timing
 * accident). Here the open window OWNS its interaction counter as material state,
 * so a builder cannot even produce an advance addressed at that counter while the
 * window is open - the invariant holds no matter how delivery is paced.
 */
export function buildMysteryEmbeddedAdvanceEntry(
  input: BuildMysteryEmbeddedAdvanceInput,
): Omit<CoopAuthorityEntry, "revision"> {
  const addressCheck = validateInteractionAddress(input.address);
  if (!addressCheck.ok) {
    throw new CoopInteractionBuildError(`embedded-advance address invalid: ${addressCheck.reason}`);
  }
  if (input.openWindow != null && addressInsideOpenWindow(input.openWindow, input.address)) {
    throw new CoopInteractionBuildError(
      `embedded advance rejected: addressed inside the open ME window at interactionSeq=${input.openWindow.interactionSeq}`
        + ` (wave ${input.openWindow.wave}) - the encounter must close before an advance can commit`,
    );
  }
  const address = cloneAddress(input.address);
  const material: CoopMysteryEmbeddedAdvanceMaterial = { kind: "me-embedded-advance", address };
  const operationId = input.operationId ?? mysteryEmbeddedAdvanceOperationId(address);
  if (!isValidOperationId(operationId)) {
    throw new CoopInteractionBuildError(`embedded-advance operationId invalid: ${String(operationId)}`);
  }
  const successor = input.successor;
  if (successor == null) {
    throw new CoopInteractionBuildError("embedded-advance successor is required");
  }
  validateSuccessor(successor);

  return {
    context: input.context,
    operationId,
    kind: INTERACTION_COMMIT_KIND,
    material: makeMaterial(material),
    nextControl: successor,
    subsumes: normalizeSubsumes(input.subsumes),
  };
}

/** Inputs to {@link buildCatchFullDecisionEntry}. */
export interface BuildCatchFullDecisionInput {
  readonly context: CoopFrameContextV2;
  readonly address: CoopInteractionAddress;
  readonly decision: CoopCatchFullDecision;
  /** -1 for release; the 0-based party slot the caught mon replaces for keep. */
  readonly partySlot: number;
  /** The species id of the caught mon (positive). */
  readonly speciesId: number;
  readonly successor: CoopNextControl;
  readonly subsumes?: readonly number[];
  readonly operationId?: string;
}

/** Build the authoritative INTERACTION_COMMIT entry for a party-full keep/release decision. */
export function buildCatchFullDecisionEntry(input: BuildCatchFullDecisionInput): Omit<CoopAuthorityEntry, "revision"> {
  const address = cloneAddress(input.address);
  const material: CoopCatchFullMaterial = {
    kind: "catch-full",
    address,
    decision: input.decision,
    partySlot: input.partySlot,
    speciesId: input.speciesId,
  };
  if (!isValidCatchFullMaterial(material)) {
    throw new CoopInteractionBuildError(
      `catch-full material invalid (decision=${String(input.decision)} partySlot=${String(input.partySlot)}`
        + ` speciesId=${String(input.speciesId)})`,
    );
  }
  const operationId = input.operationId ?? catchFullOperationId(address);
  if (!isValidOperationId(operationId)) {
    throw new CoopInteractionBuildError(`catch-full operationId invalid: ${String(operationId)}`);
  }
  const successor = input.successor;
  if (successor == null) {
    throw new CoopInteractionBuildError("catch-full successor is required");
  }
  validateSuccessor(successor);

  return {
    context: input.context,
    operationId,
    kind: INTERACTION_COMMIT_KIND,
    material: makeMaterial(material),
    nextControl: successor,
    subsumes: normalizeSubsumes(input.subsumes),
  };
}

/** Inputs to {@link buildRevivalPickEntry}. */
export interface BuildRevivalPickInput {
  readonly context: CoopFrameContextV2;
  readonly address: CoopInteractionAddress;
  /** The fainted player field slot being revived into (0..3). */
  readonly fieldIndex: number;
  /** The party slot the revive was drawn from (0..5). */
  readonly partySlot: number;
  /** The species id of the revived mon (positive). */
  readonly speciesId: number;
  readonly successor: CoopNextControl;
  readonly subsumes?: readonly number[];
  readonly operationId?: string;
}

/** Build the authoritative INTERACTION_COMMIT entry for a fainted-slot revival pick. */
export function buildRevivalPickEntry(input: BuildRevivalPickInput): Omit<CoopAuthorityEntry, "revision"> {
  const address = cloneAddress(input.address);
  const material: CoopRevivalMaterial = {
    kind: "revival",
    address,
    fieldIndex: input.fieldIndex,
    partySlot: input.partySlot,
    speciesId: input.speciesId,
  };
  if (!isValidRevivalMaterial(material)) {
    throw new CoopInteractionBuildError(
      `revival material invalid (fieldIndex=${String(input.fieldIndex)} partySlot=${String(input.partySlot)}`
        + ` speciesId=${String(input.speciesId)})`,
    );
  }
  const operationId = input.operationId ?? revivalOperationId(address, input.fieldIndex);
  if (!isValidOperationId(operationId)) {
    throw new CoopInteractionBuildError(`revival operationId invalid: ${String(operationId)}`);
  }
  const successor = input.successor;
  if (successor == null) {
    throw new CoopInteractionBuildError("revival successor is required");
  }
  validateSuccessor(successor);

  return {
    context: input.context,
    operationId,
    kind: INTERACTION_COMMIT_KIND,
    material: makeMaterial(material),
    nextControl: successor,
    subsumes: normalizeSubsumes(input.subsumes),
  };
}

// ---------------------------------------------------------------------------
// Window supersession helper (pure, over a log's retained frontier).
// ---------------------------------------------------------------------------

/**
 * The revisions an ME outcome/terminal for `window` subsumes: every unretired
 * INTERACTION_COMMIT entry whose material is an ME option-pick on the SAME window
 * (same epoch + wave + owned interaction counter). The encounter is over, so
 * those option-pick surfaces are moot - ordinary log order retires them when the
 * terminal is admitted (no cross-retention race, no phantom mid-ME wait). Pass
 * the log's `retained()` frontier.
 */
export function mysteryWindowSubsumes(retained: readonly CoopAuthorityEntry[], window: CoopMysteryWindow): number[] {
  const revisions: number[] = [];
  for (const entry of retained) {
    if (entry.kind !== INTERACTION_COMMIT_KIND) {
      continue;
    }
    const material = entry.material.payload;
    if (!isValidMysteryOptionPickMaterial(material)) {
      continue;
    }
    const address = material.address;
    if (
      address.epoch === window.epoch
      && address.wave === window.wave
      && address.interactionSeq === window.interactionSeq
    ) {
      revisions.push(entry.revision);
    }
  }
  return revisions.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// REPLICA: decode + verify, and the applier seam (owner install closes any open
// watcher surface). Engine touching is funneled through the injected surface,
// exactly like the faint-replacement picker-close, so the pipeline drives
// node-pure with a recording surface.
// ---------------------------------------------------------------------------

/**
 * Decode + verify an entry's material back into a typed interaction material.
 * Returns `null` when the entry is not a well-formed INTERACTION_COMMIT this
 * adapter owns, or its digest does not match the payload (a tampered / mismatched
 * redelivery), so the replica applier rejects it instead of installing unverified
 * state.
 */
export function decodeInteractionMaterial(entry: CoopAuthorityEntry): CoopInteractionMaterial | null {
  if (entry.kind !== INTERACTION_COMMIT_KIND) {
    return null;
  }
  const payload = entry.material.payload;
  if (!isValidInteractionMaterial(payload)) {
    return null;
  }
  // The digest must match the decoded material - proves the redelivery carries the exact committed material
  // (the log's tamper/duplicate guard), so we never install a payload whose digest disagrees with its contents.
  if (interactionMaterialDigest(payload) !== entry.material.digest) {
    return null;
  }
  return payload;
}

/**
 * A locally-open watcher surface (the owner's modal, or a non-owner's await)
 * bound to one interaction. A committed entry ADOPTS the authoritative decision
 * through this seam and closes the watcher. `adopt` MUST be idempotent +
 * non-throwing (a redelivered entry re-applies): it is the projector-level
 * authority-close that replaces the legacy journal side channel.
 */
export interface OpenInteractionWatcher {
  /** Close the watcher and adopt the committed decision. Idempotent; must not throw. */
  adopt(material: CoopInteractionMaterial): void;
}

/**
 * The narrow replica-side engine seam this adapter installs onto. A real session
 * adapts its BattleScene into this; the node-pure lane passes a fake that records
 * which verbs fired. NO globalScene / getCoopRuntime read lives behind it - the
 * concrete adapter captures the scene from the passed context.
 */
export interface CoopInteractionApplierSurface {
  /**
   * The open local watcher for this material's interaction, or `null`. The
   * committed entry closes it (adopts the decision) so an idle owner's lingering
   * modal - an ME option panel, a catch-full prompt, a revival prompt - can never
   * softlock; the authority-close is part of the ordered material apply, not a
   * side channel.
   */
  openWatcherFor(material: CoopInteractionMaterial): OpenInteractionWatcher | null;
  /**
   * Install the authoritative interaction decision into engine state. Returns
   * whether it installed - a `false` stops the pipeline before it would sign
   * materialApplied.
   */
  installInteraction(material: CoopInteractionMaterial): boolean;
}

/**
 * Build the replica's {@link ApplyMaterialFn} for the interactions-mystery
 * surface. In stage order (called by the foundation replica pipeline at
 * materialApplied):
 *   1. decode + verify the committed material (digest match),
 *   2. CLOSE any open local watcher for that interaction, adopting the committed
 *      decision (the anti-softlock authority-close - the idle owner's modal
 *      cannot linger),
 *   3. install the authoritative decision; its boolean is the stage's verdict.
 *
 * A committed entry thus deterministically retires a locally-open watcher through
 * the ordered pipeline - no journal side channel, no ambient runtime read.
 */
export function makeInteractionApplier(surface: CoopInteractionApplierSurface): ApplyMaterialFn {
  return (_ctx: CoopRuntimeContext, entry: CoopAuthorityEntry): boolean => {
    const material = decodeInteractionMaterial(entry);
    if (material == null) {
      return false;
    }
    // Authority-close: a committed entry closes the local watcher for its interaction and adopts the
    // committed decision, BEFORE installing, so the modal is gone the instant the authoritative image
    // lands (adopt is idempotent + non-throwing).
    const watcher = surface.openWatcherFor(material);
    if (watcher != null) {
      watcher.adopt(material);
    }
    return surface.installInteraction(material);
  };
}

// ---------------------------------------------------------------------------
// Shadow-parity seam (like the other adapters) - compare v2 output to the legacy
// path. Pure values only (no engine handle), so it can be logged, diffed, and
// compared on either client identically.
// ---------------------------------------------------------------------------

/**
 * A canonical, comparable descriptor of what the v2 adapter WOULD commit for an
 * interaction. During the shadow (parallel-run) phase before cutover, a parity
 * harness runs BOTH the legacy carrier and this adapter and asserts they resolved
 * the SAME decision - operation identity, the digested material, and the stated
 * successor address - WITHOUT either taking effect. `battleHandoff` is surfaced
 * so a shadow can specifically prove the terminal-without-trailing-resync class
 * matched.
 */
export interface CoopInteractionShadow {
  readonly operationId: string;
  readonly interactionKind: CoopInteractionKind;
  /** A stable digest of the material (byte-identical across clients). */
  readonly digest: string;
  /** The controlId of the stated successor, or `null` for a null control. */
  readonly successorControlId: string | null;
  /** Present for an ME option pick: the explicit battle-handoff class. */
  readonly battleHandoff: boolean | null;
}

/**
 * Extract the shadow descriptor from a built (or committed) interaction entry -
 * the `Omit<..., "revision">` from a builder or a committed entry (the revision
 * is not part of parity). Returns `null` when the entry is not a decodable
 * INTERACTION_COMMIT this adapter owns.
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
  const control = entry.nextControl;
  return {
    operationId: entry.operationId,
    interactionKind: payload.kind,
    digest: entry.material.digest,
    successorControlId: control == null ? null : controlIdOf(control),
    battleHandoff: payload.kind === "me-option-pick" ? payload.battleHandoff : null,
  };
}

/**
 * Whether two shadow descriptors agree (the parity assertion). Because the digest
 * is a COMPLETE encoding of the material, agreement on (operationId, interactionKind,
 * digest, successorControlId, battleHandoff) is exact structural parity - a shadow
 * run can prove the v2 adapter and the legacy carrier resolved byte-identically
 * before the cutover flips which one takes effect.
 */
export function interactionShadowsAgree(a: CoopInteractionShadow, b: CoopInteractionShadow): boolean {
  return (
    a.operationId === b.operationId
    && a.interactionKind === b.interactionKind
    && a.digest === b.digest
    && a.successorControlId === b.successorControlId
    && a.battleHandoff === b.battleHandoff
  );
}
