/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - Migration B adapter: the ONE faint/replacement transaction.
//
// This module REPLACES the legacy faint-switch carriers (coop-faint-switch-
// operation.ts + the co-op branches of switch-phase.ts / coop-guest-faint-switch-
// phase.ts / showdown-enemy-faint-switch-phase.ts / coop-push-replacement-
// checkpoint-phase.ts) with a single typed authority-v2 progression step. It
// imports ONLY authority-v2 foundation types + engine-free helpers; it touches
// NO legacy co-op netcode at runtime, holds NO module-global mutable state, and
// reads NO ambient runtime (every capability arrives on the passed
// CoopRuntimeContext). Its whole import graph is type-only, so it runs in the
// node-pure vitest lane.
//
// WHY THIS EXISTS (the live faint-stall class it makes unrepresentable):
//   The legacy carrier addressed a replacement through a SPARSE positional number
//   array (`data[]`). A short legacy base left an index HOLE that survived the
//   JSON round-trip as `null`, and the guest applier's `data.every(Number.isFinite)`
//   then HARD-REJECTED every host-owned replacement op - a permanent faint stall
//   (the densify fix in coop-faint-switch-operation.ts). It also resolved the
//   picked mon by a blind SLOT INDEX, so a party-order divergence summoned the
//   WRONG species (#799). And it retained the replacement through TWO barriers
//   (the durability journal AND the battle stream) whose boundary verdicts ran
//   under whatever ambient runtime happened to be installed.
//
//   The authority-v2 transaction removes all three by CONSTRUCTION:
//     - Identity is a typed {@link ReplacementProposal} - every coordinate is a
//       named, finite-integer field; a hole or non-finite value is not a valid
//       proposal and cannot be built. No positional array, so no index can be a
//       hole.
//     - The picked mon carries its `speciesId` as a first-class field (the #799
//       identity resolution promoted out of `data[1]`), so the authoritative
//       image names the species, never a bare slot.
//     - Retention is the ONE authority log (foundation decision 2); this adapter
//       only shapes the entry + its typed material.
// =============================================================================

import { isValidOperationId } from "#data/elite-redux/coop/authority-v2/authority-entry";
import type {
  CoopAuthoritativeMaterial,
  CoopAuthorityEntry,
  CoopCommandControlTarget,
  CoopFrameContextV2,
  CoopNextControl,
  CoopRuntimeContext,
  CoopTimerOwner,
} from "#data/elite-redux/coop/authority-v2/contract";
import {
  controlIdOf,
  type ProjectableControl,
  validateNextControl,
} from "#data/elite-redux/coop/authority-v2/next-control";
import type { ApplyMaterialFn } from "#data/elite-redux/coop/authority-v2/replica";
import type { CoopSwitchPresentation } from "#data/elite-redux/coop/coop-transport";

// ---------------------------------------------------------------------------
// Identity - the typed proposal (no positional arrays, no hole-able payloads)
// ---------------------------------------------------------------------------

/**
 * The immutable event-source address of ONE faint that needs a replacement. Every
 * field is a named finite integer, so the sparse-array hole that permanently
 * stalled the legacy carrier is unrepresentable here: there is no positional slot
 * to leave undefined. `occurrence` is the authority-issued per-turn faint sequence
 * (0-based) - it makes a same-turn double-KO's two faints two DISTINCT addresses.
 */
export interface ReplacementSourceAddress {
  /** Session epoch (positive) - a superseded epoch's frame is a stale reject upstream. */
  readonly epoch: number;
  /** 1-based wave index. */
  readonly wave: number;
  /** 1-based turn index within the wave. */
  readonly turn: number;
  /** Authority-issued per-turn faint sequence (0-based); distinguishes chained faints. */
  readonly occurrence: number;
  /** The player field slot that fainted (0-based). */
  readonly fieldIndex: number;
}

/**
 * The chosen replacement, carrying the mon's SPECIES identity as a first-class
 * field. Promoting `speciesId` out of the legacy `data[1]` is the #799 fix made
 * structural: the authority resolves the pick by identity, never by a blind slot
 * index that a party-order divergence would point at the wrong mon.
 */
export interface ReplacementSelection {
  /** The party slot the replacement was drawn from (0-based, on the bench). */
  readonly partySlot: number;
  /** The species id of the picked mon (positive) - the identity the authority commits. */
  readonly speciesId: number;
}

/**
 * One replacement proposal for a single faint address. `selected == null` is the
 * explicit "no legal replacement" terminal (the legacy RESOLUTION_NONE), NOT a
 * missing field - the absence is a first-class value, not a hole. Identity is
 * complete on its own: the address + owner seat + the identity-carrying selection.
 */
export interface ReplacementProposal {
  readonly sourceAddress: ReplacementSourceAddress;
  /** The seat that owns the fainted slot (seat ids authorize ownership, never host/guest role). */
  readonly ownerSeatId: number;
  /** The picked replacement, or `null` for an explicit no-legal-replacement resolution. */
  readonly selected: ReplacementSelection | null;
}

/**
 * How the authority RESOLVED the proposal:
 *   - "owner-pick"    - the owning seat chose within its window.
 *   - "fallback-auto" - the owner window ({@link COOP_REPLACEMENT_OWNER_WINDOW_MS}
 *                       of "humanInput" active time) elapsed and the authority
 *                       auto-picked a legal replacement.
 * The mode is recorded in the authoritative image but does NOT change the
 * operation's identity - the authority may legally commit a different fallback
 * result under the same proposal window (the legacy "retryKey identifies the
 * WINDOW, not the result" rule, now typed).
 */
export type ReplacementResolutionMode = "owner-pick" | "fallback-auto";

/**
 * The successor control the AUTHORITY states after this replacement (foundation
 * decision 4 - the authority states, the replica projects). Modelled explicitly
 * per occurrence so a multi-faint chain is unambiguous:
 *   - "resume-command-frontier" - the last faint in the chain resolved; resume
 *                          every independently-controlled active battler.
 *   - "next-replacement" - another faint remains in the SAME turn; the current
 *                          post-summon result installs the next exact executable
 *                          picker plus the immutable remainder of the chain.
 *   - "ordered-wait"     - the replacement is the final material result, but the
 *                          next authority lives at a deliberately different typed
 *                          address (for example Mystery battle -> ME_TERMINAL t0).
 *   - "terminal"         - no executable control follows the replacement; the
 *                          entry waits explicitly for interaction/wave/terminal authority.
 */
export type ReplacementSuccessor =
  | {
      readonly kind: "resume-command-frontier";
      /** Exact post-summon control address. A faint sourced at turn N can materialize after TurnInit opens N+1. */
      readonly epoch: number;
      readonly wave: number;
      readonly turn: number;
      readonly commands: readonly CoopCommandControlTarget[];
    }
  | {
      readonly kind: "next-replacement";
      readonly control: Extract<CoopNextControl, { kind: "REPLACEMENT" }>;
    }
  | {
      readonly kind: "ordered-wait";
      readonly control: Extract<CoopNextControl, { kind: "AWAIT_SUCCESSOR" }>;
    }
  | { readonly kind: "terminal" };

/**
 * The complete post-summon authority carrier needed by a LIVE replacement cutover.
 *
 * The typed proposal identifies which replacement the authority resolved, but identity alone cannot
 * materialize the resulting battle: the party reorder, active field, HP/status, moves/PP, held items,
 * arena state, and checksum all belong to the post-summon engine image. These values deliberately remain
 * opaque here, exactly like the turn adapter's cutover companions; the engine adapter validates their
 * concrete shapes before it can sign materialApplied.
 */
export interface ReplacementAuthorityCarrier {
  readonly checkpoint: unknown;
  readonly checksum: unknown;
  readonly preimage: unknown;
  readonly fullField: unknown;
  readonly authoritativeState: unknown;
  readonly epoch: unknown;
  readonly wave: unknown;
  readonly turn: unknown;
  /** Exact summon animation authored by this replacement, or explicit null for a sealed empty slot. */
  readonly presentation?: CoopSwitchPresentation | null;
}

/**
 * The authoritative replacement IMAGE - the typed, digestible material the log
 * retains and the replica installs. It is the resolved proposal plus the
 * resolution mode. A shadow-only image omits `authorityCarrier`; a live cutover
 * includes the complete post-summon carrier, and every companion is covered by
 * the same material digest. The log treats it as opaque JSON, while the replica
 * decodes and validates it before touching engine state.
 */
export interface ReplacementCommitImage {
  readonly sourceAddress: ReplacementSourceAddress;
  readonly ownerSeatId: number;
  readonly resolution: ReplacementResolutionMode;
  readonly selected: ReplacementSelection | null;
  readonly authorityCarrier?: ReplacementAuthorityCarrier;
}

// ---------------------------------------------------------------------------
// Validation - a hole / non-finite value is not a representable proposal
// ---------------------------------------------------------------------------

/** A structural verdict; the reason names the exact offending field. */
export type ReplacementValidation = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const VALID: ReplacementValidation = { ok: true };

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** Validate a source address: 1-based epoch/wave/turn, 0-based occurrence/fieldIndex, all finite. */
export function validateReplacementSourceAddress(address: unknown): ReplacementValidation {
  if (!isPlainObject(address)) {
    return { ok: false, reason: "sourceAddress is not an object" };
  }
  if (!isPositiveInt(address.epoch)) {
    return { ok: false, reason: `sourceAddress.epoch must be a positive integer (got ${String(address.epoch)})` };
  }
  if (!isPositiveInt(address.wave)) {
    return { ok: false, reason: `sourceAddress.wave must be a positive integer (got ${String(address.wave)})` };
  }
  if (!isPositiveInt(address.turn)) {
    return { ok: false, reason: `sourceAddress.turn must be a positive integer (got ${String(address.turn)})` };
  }
  if (!isNonNegativeInt(address.occurrence)) {
    return {
      ok: false,
      reason: `sourceAddress.occurrence must be a non-negative integer (got ${String(address.occurrence)})`,
    };
  }
  if (!isNonNegativeInt(address.fieldIndex)) {
    return {
      ok: false,
      reason: `sourceAddress.fieldIndex must be a non-negative integer (got ${String(address.fieldIndex)})`,
    };
  }
  return VALID;
}

/** Validate a selection: a non-negative party slot and a positive species id, or explicit `null`. */
export function validateReplacementSelection(selected: unknown): ReplacementValidation {
  if (selected === null) {
    return VALID;
  }
  if (!isPlainObject(selected)) {
    return { ok: false, reason: "selected must be an object or null" };
  }
  if (!isNonNegativeInt(selected.partySlot)) {
    return {
      ok: false,
      reason: `selected.partySlot must be a non-negative integer (got ${String(selected.partySlot)})`,
    };
  }
  if (!isPositiveInt(selected.speciesId)) {
    return { ok: false, reason: `selected.speciesId must be a positive integer (got ${String(selected.speciesId)})` };
  }
  return VALID;
}

/**
 * Validate a whole proposal. Because every coordinate is a named finite-integer
 * field, a non-finite value (NaN / Infinity / undefined) or a hole is REJECTED
 * here - there is no positional array in which a hole could hide, so the legacy
 * sparse-payload faint-stall class is unrepresentable by construction.
 */
export function validateReplacementProposal(proposal: unknown): ReplacementValidation {
  if (!isPlainObject(proposal)) {
    return { ok: false, reason: "proposal is not an object" };
  }
  const addressCheck = validateReplacementSourceAddress(proposal.sourceAddress);
  if (!addressCheck.ok) {
    return addressCheck;
  }
  if (!isNonNegativeInt(proposal.ownerSeatId)) {
    return {
      ok: false,
      reason: `proposal.ownerSeatId must be a non-negative integer (got ${String(proposal.ownerSeatId)})`,
    };
  }
  return validateReplacementSelection(proposal.selected);
}

/** Boolean convenience over {@link validateReplacementProposal}. */
export function isValidReplacementProposal(proposal: unknown): proposal is ReplacementProposal {
  return validateReplacementProposal(proposal).ok;
}

// ---------------------------------------------------------------------------
// Digest - deterministic + identical on every client
// ---------------------------------------------------------------------------

/**
 * Canonical, key-sorted JSON of a plain value. Deterministic across clients so
 * the same image always digests identically (the log proves a re-delivery is
 * the same image by digest equality). Only the plain JSON shapes this module
 * emits (objects / numbers / strings / null) are expected.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  const record = value as Record<string, unknown>;
  const parts = Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${parts.join(",")}}`;
}

/** FNV-1a 32-bit over a string; rendered as 8 lowercase hex digits. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * The deterministic digest of an authoritative replacement image. Prefixed +
 * length-tagged so it is a stable, wire-safe, bounded token (contract: a digest
 * must be a non-empty string <= 256 chars).
 */
export function replacementImageDigest(image: ReplacementCommitImage): string {
  const canonical = canonicalJson(image);
  return `rc1-${canonical.length}-${fnv1a(canonical)}`;
}

// ---------------------------------------------------------------------------
// Operation identity - addresses the proposal WINDOW, not the result
// ---------------------------------------------------------------------------

/**
 * The stable operationId for a replacement window. It encodes the address + owner
 * seat ONLY (never the resolution or the picked mon), so the authority can commit
 * either an owner-pick or a fallback-auto result under the SAME identity - the
 * legacy "retryKey identifies the proposal window, not its proposed result" rule,
 * now a typed string address instead of a delimiter-joined number tuple.
 */
export function replacementOperationId(address: ReplacementSourceAddress, ownerSeatId: number): string {
  return `RC/e${address.epoch}/w${address.wave}/t${address.turn}/o${address.occurrence}/f${address.fieldIndex}/s${ownerSeatId}`;
}

// ---------------------------------------------------------------------------
// Image + successor construction
// ---------------------------------------------------------------------------

/**
 * Build the authoritative image from a RESOLVED proposal + its resolution mode.
 * Throws on an invalid proposal (a malformed image must never be committed) -
 * the caller resolves the pick first, so by the time it reaches here the proposal
 * is the authority's final answer for the window.
 */
export function toReplacementCommitImage(
  proposal: ReplacementProposal,
  resolution: ReplacementResolutionMode,
  authorityCarrier?: ReplacementAuthorityCarrier,
): ReplacementCommitImage {
  const check = validateReplacementProposal(proposal);
  if (!check.ok) {
    throw new Error(`[authority-v2/faint-replacement] invalid proposal: ${check.reason}`);
  }
  const baseImage = {
    sourceAddress: {
      epoch: proposal.sourceAddress.epoch,
      wave: proposal.sourceAddress.wave,
      turn: proposal.sourceAddress.turn,
      occurrence: proposal.sourceAddress.occurrence,
      fieldIndex: proposal.sourceAddress.fieldIndex,
    },
    ownerSeatId: proposal.ownerSeatId,
    resolution,
    selected:
      proposal.selected == null
        ? null
        : { partySlot: proposal.selected.partySlot, speciesId: proposal.selected.speciesId },
  };
  if (authorityCarrier === undefined) {
    return baseImage;
  }
  const presentation = decodeReplacementPresentation(authorityCarrier.presentation);
  if (presentation === undefined) {
    throw new Error("[authority-v2/faint-replacement] live authority carrier has invalid replacement presentation");
  }
  return {
    ...baseImage,
    authorityCarrier: {
      checkpoint: authorityCarrier.checkpoint,
      checksum: authorityCarrier.checksum,
      preimage: authorityCarrier.preimage,
      fullField: authorityCarrier.fullField,
      authoritativeState: authorityCarrier.authoritativeState,
      epoch: authorityCarrier.epoch,
      wave: authorityCarrier.wave,
      turn: authorityCarrier.turn,
      presentation,
    },
  };
}

/**
 * Map an authority-stated successor onto a canonical {@link CoopNextControl}. The
 * successor rides the CURRENT faint's epoch/wave/turn (a same-turn resume / the
 * next same-turn faint); only the occurrence + field + actor change. Non-executable
 * successors are explicit ordered waits, never nullable local-continuation holes.
 */
export function successorControl(
  address: ReplacementSourceAddress,
  sourceOperationId: string,
  successor: ReplacementSuccessor,
): CoopNextControl {
  switch (successor.kind) {
    case "resume-command-frontier":
      return {
        kind: "COMMAND_FRONTIER",
        epoch: successor.epoch,
        wave: successor.wave,
        turn: successor.turn,
        commands: successor.commands,
      };
    case "next-replacement":
      return successor.control;
    case "ordered-wait":
      if (
        successor.control.afterOperationId !== sourceOperationId
        || successor.control.epoch !== address.epoch
        || successor.control.wave !== address.wave
        || successor.control.turn !== address.turn
      ) {
        throw new Error("[authority-v2/faint-replacement] ordered successor wait is not bound to the replacement");
      }
      return successor.control;
    case "terminal":
      return {
        kind: "AWAIT_SUCCESSOR",
        afterOperationId: sourceOperationId,
        epoch: address.epoch,
        wave: address.wave,
        turn: address.turn,
        // A replacement with no immediate command frontier was authored before the engine could know which
        // boundary comes next: a SURVIVING battle opens the refilled slot's next turn through an explicit
        // CONTROL_COMMIT command-open, while a WON wave / game-over crosses via WAVE_ADVANCE / TERMINAL_COMMIT,
        // and a further same-turn faint via REPLACEMENT_COMMIT. Omitting CONTROL_COMMIT made this wait REJECT
        // the surviving battle's turn N+1 command-open (successorWaitAllows -> !allowedKinds.includes -> false),
        // so a mid-wave replacement whose wave continues (e.g. a second same-wave faint that suppressed the
        // immediate frontier) deadlocked with the command-open never admissible - recovery then correctly
        // failed closed ("material could not be applied exactly"). This mirrors the sibling turn-command
        // no-immediate-frontier wait (turn-command.ts) EXACTLY; broadWaitAllowsControlCommitTurn still pins a
        // command-open to turn N+1 and the settlement N/N+1 rule still governs WAVE_ADVANCE/TERMINAL_COMMIT, so
        // the genuine won-wave/terminal case is unchanged. allowNextWaveStart stays false: a same-wave resume.
        allowedKinds: ["CONTROL_COMMIT", "REPLACEMENT_COMMIT", "INTERACTION_COMMIT", "WAVE_ADVANCE", "TERMINAL_COMMIT"],
        allowNextWaveStart: false,
        expectedOperationId: null,
      };
  }
}

// ---------------------------------------------------------------------------
// AUTHORITY - build the one committed replacement entry
// ---------------------------------------------------------------------------

/** Inputs for {@link buildReplacementCommitEntry}. */
export interface BuildReplacementCommitEntryInput {
  /** The authenticated frame context stamped on the entry (foundation decision 3). */
  readonly context: CoopFrameContextV2;
  /** The resolved proposal (owner-picked or auto-picked). */
  readonly proposal: ReplacementProposal;
  /** How it was resolved. */
  readonly resolution: ReplacementResolutionMode;
  /** Complete post-summon carrier for live cutover; omitted by shadow-only parity taps. */
  readonly authorityCarrier?: ReplacementAuthorityCarrier;
  /** The authority-stated successor control. */
  readonly successor: ReplacementSuccessor;
  /** Revisions this entry explicitly subsumes (supersession by log order); default none. */
  readonly subsumes?: readonly number[];
  /** Override the derived operationId; default {@link replacementOperationId}. */
  readonly operationId?: string;
}

/**
 * Build the ONE authoritative REPLACEMENT_COMMIT entry for a resolved faint. The
 * result is the exact `Omit<CoopAuthorityEntry, "revision">` the foundation
 * {@linkcode CoopAuthorityLog.commit} accepts - it assigns the global revision.
 *
 * The entry carries:
 *   - a typed, digested authoritative image as `material`,
 *   - the authority-stated `nextControl` (COMMAND same-turn resume for the last
 *     faint, REPLACEMENT for the next occurrence in a chain, or null),
 *   - a stable window-addressing operationId.
 *
 * Throws on a structurally impossible entry (invalid proposal, malformed
 * operationId, or a successor that would encode an invalid control) - such an
 * entry must never enter the log, where it could stall retirement.
 */
export function buildReplacementCommitEntry(
  input: BuildReplacementCommitEntryInput,
): Omit<CoopAuthorityEntry, "revision"> {
  const image = toReplacementCommitImage(input.proposal, input.resolution, input.authorityCarrier);
  const operationId = input.operationId ?? replacementOperationId(image.sourceAddress, image.ownerSeatId);
  if (!isValidOperationId(operationId)) {
    throw new Error(`[authority-v2/faint-replacement] invalid operationId ${String(operationId)}`);
  }

  const nextControl = successorControl(image.sourceAddress, operationId, input.successor);
  const controlCheck = validateNextControl(nextControl as ProjectableControl);
  if (!controlCheck.ok) {
    throw new Error(`[authority-v2/faint-replacement] invalid successor control: ${controlCheck.reason}`);
  }

  const material: CoopAuthoritativeMaterial = {
    digest: replacementImageDigest(image),
    payload: image,
  };

  return {
    context: input.context,
    operationId,
    kind: "REPLACEMENT_COMMIT",
    material,
    nextControl,
    subsumes: input.subsumes == null ? [] : [...input.subsumes],
  };
}

// ---------------------------------------------------------------------------
// Owner window - the 60s human-input fallback deadline (foundation scheduler)
// ---------------------------------------------------------------------------

/**
 * How long the owning seat has to pick before the authority auto-resolves. This
 * is the FINAL maintainer decision preserved verbatim from the legacy
 * `getCoopFaintSwitchWaitMs()` (60s), now consumed as "humanInput" ACTIVE time so
 * a suspended tab / disconnect pauses the window instead of burning it.
 */
export const COOP_REPLACEMENT_OWNER_WINDOW_MS = 60_000;

/** The scheduler time class the owner window consumes (a human is deliberating). */
export const COOP_REPLACEMENT_OWNER_WINDOW_TIME_CLASS = "humanInput" as const;

/** The addressed timer owner for one replacement's owner window. */
export function replacementOwnerWindowOwner(address: ReplacementSourceAddress, ownerSeatId: number): CoopTimerOwner {
  return {
    ownerId: `authority-v2:faint-replacement:${replacementOperationId(address, ownerSeatId)}`,
    address: `authority-v2/faint-replacement/${replacementOperationId(address, ownerSeatId)}`,
    reason: `owner seat ${ownerSeatId} replacement window for ${replacementOperationId(address, ownerSeatId)}`,
  };
}

/**
 * Arm the owner window on the runtime scheduler (never a raw setTimeout). When
 * {@link COOP_REPLACEMENT_OWNER_WINDOW_MS} of "humanInput" ACTIVE time elapses
 * without the owner picking, `onFallback` fires and the authority commits a
 * fallback-auto entry. The returned handle cancels the window when the owner
 * picks first (the pick + the fallback are mutually exclusive). The timer is
 * owner-addressed, so teardown / lease release cancels it by owner - it is a
 * single bounded deadline, NOT a retry loop.
 */
export function armReplacementOwnerWindow(
  ctx: CoopRuntimeContext,
  address: ReplacementSourceAddress,
  ownerSeatId: number,
  onFallback: () => void,
): () => void {
  const owner = replacementOwnerWindowOwner(address, ownerSeatId);
  return ctx.scheduler.schedule(
    owner,
    COOP_REPLACEMENT_OWNER_WINDOW_MS,
    COOP_REPLACEMENT_OWNER_WINDOW_TIME_CLASS,
    onFallback,
  );
}

// ---------------------------------------------------------------------------
// REPLICA - the applier seam + the anti-softlock picker close
// ---------------------------------------------------------------------------

/**
 * A locally-open replacement picker (the owner's modal, or a non-owner's await)
 * bound to exactly one source address. A committed entry for that address ADOPTS
 * the authoritative pick through this seam and closes the picker. `adopt` MUST be
 * idempotent + non-throwing (a redelivered entry re-applies): it is the
 * projector-level authority-close that replaces the legacy journal side channel.
 */
export interface OpenReplacementPicker {
  readonly address: ReplacementSourceAddress;
  /** Close the picker and adopt the committed pick. Idempotent; must not throw. */
  adopt(image: ReplacementCommitImage): void;
}

/**
 * The narrow replica-side engine seam this adapter installs onto. A real session
 * adapts its BattleScene into this; the node-pure lane passes a fake that records
 * which verbs fired. NO globalScene / getCoopRuntime read lives behind it - the
 * concrete adapter captures the scene from the passed context.
 */
export interface ReplacementApplierSurface {
  /**
   * The open local picker for this address, or `null`. The committed entry closes
   * it (adopts the pick) so an idle owner's lingering modal can never softlock -
   * the authority-close is part of the ordered material apply, not a side channel.
   */
  openPickerFor(address: ReplacementSourceAddress): OpenReplacementPicker | null;
  /**
   * Install the authoritative replacement image into engine state (summon the
   * committed mon, or seal the no-replacement slot). Returns whether it installed
   * - a `false` stops the pipeline before it would sign materialApplied.
   */
  installReplacementImage(image: ReplacementCommitImage): boolean;
}

/**
 * Decode + verify an entry's material back into a typed image. Returns `null`
 * when the entry is not a well-formed REPLACEMENT_COMMIT or its digest does not
 * match the payload (a tampered / mismatched redelivery), so the replica applier
 * rejects it instead of installing unverified state.
 */
export function decodeReplacementCommitMaterial(entry: CoopAuthorityEntry): ReplacementCommitImage | null {
  if (entry.kind !== "REPLACEMENT_COMMIT") {
    return null;
  }
  const payload = entry.material.payload;
  if (!isPlainObject(payload)) {
    return null;
  }
  const addressCheck = validateReplacementSourceAddress(payload.sourceAddress);
  if (!addressCheck.ok || !isNonNegativeInt(payload.ownerSeatId)) {
    return null;
  }
  if (payload.resolution !== "owner-pick" && payload.resolution !== "fallback-auto") {
    return null;
  }
  if (!validateReplacementSelection(payload.selected).ok) {
    return null;
  }
  const address = payload.sourceAddress as ReplacementSourceAddress;
  const selected = payload.selected as ReplacementSelection | null;
  const authorityCarrier = decodeReplacementAuthorityCarrier(payload.authorityCarrier);
  if (payload.authorityCarrier !== undefined && authorityCarrier == null) {
    return null;
  }
  const image: ReplacementCommitImage = {
    sourceAddress: {
      epoch: address.epoch,
      wave: address.wave,
      turn: address.turn,
      occurrence: address.occurrence,
      fieldIndex: address.fieldIndex,
    },
    ownerSeatId: payload.ownerSeatId,
    resolution: payload.resolution,
    selected: selected == null ? null : { partySlot: selected.partySlot, speciesId: selected.speciesId },
    ...(authorityCarrier == null ? {} : { authorityCarrier }),
  };
  // Digest must match the decoded image - proves the redelivery carries the exact
  // committed material (the log's tamper/duplicate guard), so we never install a
  // payload whose digest disagrees with its own contents.
  if (replacementImageDigest(image) !== entry.material.digest) {
    return null;
  }
  return image;
}

/**
 * Build the replica's {@link ApplyMaterialFn} for the faint-replacement surface.
 * In stage order (called by the foundation replica pipeline at materialApplied):
 *   1. decode + verify the committed image (digest match),
 *   2. CLOSE any open local picker for that address, adopting the committed pick
 *      (the anti-softlock authority-close - the idle owner's modal cannot linger),
 *   3. install the authoritative image; its boolean is the stage's verdict.
 *
 * A committed entry thus deterministically retires a locally-open picker through
 * the ordered pipeline - no journal side channel, no ambient runtime read.
 */
export function makeReplacementApplier(surface: ReplacementApplierSurface): ApplyMaterialFn {
  return (_ctx: CoopRuntimeContext, entry: CoopAuthorityEntry): boolean => {
    const image = decodeReplacementCommitMaterial(entry);
    if (image == null) {
      return false;
    }
    // Authority-close: a committed entry closes the local picker for its address
    // and adopts the committed pick, BEFORE installing, so the modal is gone the
    // instant the authoritative image lands (adopt is idempotent + non-throwing).
    const picker = surface.openPickerFor(image.sourceAddress);
    if (picker != null) {
      picker.adopt(image);
    }
    return surface.installReplacementImage(image);
  };
}

// ---------------------------------------------------------------------------
// Shadow parity seam (like Migration A) - compare v2 output to the legacy path
// ---------------------------------------------------------------------------

/**
 * A canonical, side-effect-free descriptor of what the v2 adapter WOULD commit
 * for a resolved faint. During the shadow (parallel-run) phase before cutover, a
 * parity harness runs BOTH the legacy carrier and this adapter and asserts the
 * two resolved the SAME replacement - address, identity-carrying pick, resolution
 * mode, and the stated successor - WITHOUT either taking effect. It is pure
 * values only (no engine handle), so it can be logged, diffed, and compared on
 * either client identically. This mirrors Migration A's turn-command shadow seam.
 */
export interface ReplacementShadowParity {
  readonly operationId: string;
  readonly digest: string;
  readonly sourceAddress: ReplacementSourceAddress;
  readonly ownerSeatId: number;
  readonly resolution: ReplacementResolutionMode;
  readonly selected: ReplacementSelection | null;
  /** The stable successor address (controlId), or `null` for a terminal successor. */
  readonly successorControlId: string | null;
}

function decodeReplacementAuthorityCarrier(value: unknown): ReplacementAuthorityCarrier | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const required = [
    "checkpoint",
    "checksum",
    "preimage",
    "fullField",
    "authoritativeState",
    "epoch",
    "wave",
    "turn",
    "presentation",
  ] as const;
  if (required.some(field => !(field in value))) {
    return null;
  }
  const presentation = decodeReplacementPresentation(value.presentation);
  if (presentation === undefined) {
    return null;
  }
  return {
    checkpoint: value.checkpoint,
    checksum: value.checksum,
    preimage: value.preimage,
    fullField: value.fullField,
    authoritativeState: value.authoritativeState,
    epoch: value.epoch,
    wave: value.wave,
    turn: value.turn,
    presentation,
  };
}

/** `undefined` means malformed/missing; `null` is the explicit no-summon presentation. */
function decodeReplacementPresentation(value: unknown): CoopSwitchPresentation | null | undefined {
  if (value === null) {
    return null;
  }
  if (!isPlainObject(value)) {
    return;
  }
  if (
    !isNonNegativeInt(value.bi)
    || !isNonNegativeInt(value.partySlot)
    || !isPositiveInt(value.pokemonId)
    || !isPositiveInt(value.speciesId)
    || !isNonNegativeInt(value.switchType)
    || typeof value.doReturn !== "boolean"
    || !isPlainObject(value.actor)
    || (value.actor.side !== "player" && value.actor.side !== "enemy")
    || !isPositiveInt(value.actor.pokemonId)
    || value.actor.pokemonId !== value.pokemonId
  ) {
    return;
  }
  return {
    bi: value.bi,
    partySlot: value.partySlot,
    pokemonId: value.pokemonId,
    speciesId: value.speciesId,
    switchType: value.switchType,
    doReturn: value.doReturn,
    actor: { side: value.actor.side, pokemonId: value.actor.pokemonId },
  };
}

/**
 * Derive the shadow-parity descriptor from a built REPLACEMENT_COMMIT entry (the
 * `Omit<..., "revision">` from {@link buildReplacementCommitEntry} or a committed
 * entry - the revision is not part of parity). Returns `null` when the entry is
 * not a decodable REPLACEMENT_COMMIT.
 */
export function shadowParityOfEntry(
  entry: Omit<CoopAuthorityEntry, "revision"> | CoopAuthorityEntry,
): ReplacementShadowParity | null {
  if (entry.kind !== "REPLACEMENT_COMMIT") {
    return null;
  }
  const payload = entry.material.payload;
  if (!isPlainObject(payload) || !validateReplacementSourceAddress(payload.sourceAddress).ok) {
    return null;
  }
  if (payload.resolution !== "owner-pick" && payload.resolution !== "fallback-auto") {
    return null;
  }
  if (!isNonNegativeInt(payload.ownerSeatId) || !validateReplacementSelection(payload.selected).ok) {
    return null;
  }
  const address = payload.sourceAddress as ReplacementSourceAddress;
  const selected = payload.selected as ReplacementSelection | null;
  return {
    operationId: entry.operationId,
    digest: entry.material.digest,
    sourceAddress: {
      epoch: address.epoch,
      wave: address.wave,
      turn: address.turn,
      occurrence: address.occurrence,
      fieldIndex: address.fieldIndex,
    },
    ownerSeatId: payload.ownerSeatId,
    resolution: payload.resolution,
    selected: selected == null ? null : { partySlot: selected.partySlot, speciesId: selected.speciesId },
    successorControlId: entry.nextControl == null ? null : controlIdOf(entry.nextControl),
  };
}

/**
 * Whether two shadow-parity descriptors agree (the parity assertion). Equality is
 * exact across every field, so a shadow run can prove the v2 adapter and the
 * legacy carrier resolved byte-identically before the cutover flips which one
 * takes effect.
 */
export function replacementShadowsAgree(a: ReplacementShadowParity, b: ReplacementShadowParity): boolean {
  return (
    a.operationId === b.operationId
    && a.digest === b.digest
    && a.ownerSeatId === b.ownerSeatId
    && a.resolution === b.resolution
    && a.successorControlId === b.successorControlId
    && a.sourceAddress.epoch === b.sourceAddress.epoch
    && a.sourceAddress.wave === b.sourceAddress.wave
    && a.sourceAddress.turn === b.sourceAddress.turn
    && a.sourceAddress.occurrence === b.sourceAddress.occurrence
    && a.sourceAddress.fieldIndex === b.sourceAddress.fieldIndex
    && selectionsEqual(a.selected, b.selected)
  );
}

function selectionsEqual(a: ReplacementSelection | null, b: ReplacementSelection | null): boolean {
  if (a == null || b == null) {
    return a == null && b == null;
  }
  return a.partySlot === b.partySlot && a.speciesId === b.speciesId;
}
