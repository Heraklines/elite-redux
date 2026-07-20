/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - Lane 2, entry identity + immutability (authority-entry).
//
// Engine-free identity helpers for one CoopAuthorityEntry (contract.ts). NO
// Phaser, NO globalScene, NO engine values - only the type-only contract import.
//
// An entry is the atom of the ONE global revision order (frozen decision 1). It
// is exactly-once and immutable once committed; the log retains a FROZEN copy so
// a caller that reuses/mutates its source object can never rewrite what a later
// redelivery transmits. These helpers are the single place that:
//   - validates the operationId shape (a stable, wire-safe identity string),
//   - checks the material digest is present (the log treats material as opaque
//     but a digest MUST exist so duplicate/tamper detection is possible),
//   - deep-freezes an entry (the immutability guard), and
//   - compares two entries for the same-revision / same-identity relation used by
//     duplicate classification and receipt matching.
// =============================================================================

import type {
  CoopAuthorityEntry,
  CoopAuthorityReceipt,
  CoopFrameContextV2,
  CoopNextControl,
} from "#data/elite-redux/coop/authority-v2/contract";
import { isValidNextControl as isCanonicalNextControl } from "#data/elite-redux/coop/authority-v2/next-control";

/** Max length of a wire operationId - bounds the identity so a malformed frame cannot balloon memory. */
export const COOP_OPERATION_ID_MAX_LENGTH = 256;

/** Defensive recursion bound for one mechanical wire image. */
const COOP_WIRE_JSON_MAX_DEPTH = 128;

/** Matches any ASCII control character (C0 range + DEL) - forbidden in a wire-safe identity token. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control chars is the explicit intent.
const CONTROL_CHAR = /[\u0000-\u001f\u007f]/;

/**
 * Whether an operationId is a well-formed identity string: a non-empty, bounded, single-line token with
 * no control characters. The log never parses it - it is opaque - but it MUST be a stable wire-safe key
 * (it addresses receipts + lease owners), so a blank / oversized / newline-bearing id is rejected.
 */
export function isValidOperationId(operationId: unknown): operationId is string {
  return (
    typeof operationId === "string"
    && operationId.length > 0
    && operationId.length <= COOP_OPERATION_ID_MAX_LENGTH
    && !CONTROL_CHAR.test(operationId)
  );
}

/** A revision is a positive, safe integer in the ONE global ordering domain (frozen decision 1). */
export function isValidRevision(revision: unknown): revision is number {
  return Number.isSafeInteger(revision) && (revision as number) > 0;
}

/**
 * Whether the material digest is present + well-formed. The log treats the payload as opaque, but a
 * non-empty, bounded digest MUST exist: it is the ONLY thing that lets duplicate re-delivery be proven
 * identical (a resend can never smuggle a conflicting payload under an already-admitted revision).
 */
export function hasValidDigest(entry: { readonly material?: { readonly digest?: unknown } }): boolean {
  const digest = entry.material?.digest;
  return typeof digest === "string" && digest.length > 0 && digest.length <= COOP_OPERATION_ID_MAX_LENGTH;
}

/**
 * Whether a value survives the protocol's JSON carrier byte-for-byte as the same data model.
 *
 * `structuredClone` is deliberately NOT the definition of a wire value: it preserves `undefined`, sparse
 * array holes, non-finite numbers, Maps, Dates, and other shapes which JSON/WebRTC either drops, rewrites,
 * or rejects. Authority digests and application must describe the exact image the peer receives, so every
 * mechanical entry is rejected before it consumes a revision unless the complete entry is JSON-stable.
 */
export function isWireStableJsonValue(value: unknown): boolean {
  return isWireStableJsonValueAt(value, new Set<object>(), 0);
}

function isWireStableJsonValueAt(value: unknown, ancestors: Set<object>, depth: number): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value !== "object" || depth > COOP_WIRE_JSON_MAX_DEPTH) {
    return false;
  }
  if (ancestors.has(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    return false;
  }

  ancestors.add(value);
  try {
    return Array.isArray(value)
      ? isWireStableJsonArray(value, ancestors, depth + 1)
      : isWireStableJsonRecord(value, ancestors, depth + 1);
  } finally {
    ancestors.delete(value);
  }
}

function isWireStableJsonArray(value: unknown[], ancestors: Set<object>, depth: number): boolean {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes("length") || Object.keys(value).length !== value.length) {
    return false;
  }
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor == null
      || !descriptor.enumerable
      || !("value" in descriptor)
      || !isWireStableJsonValueAt(descriptor.value, ancestors, depth)
    ) {
      return false;
    }
  }
  return true;
}

function isWireStableJsonRecord(value: object, ancestors: Set<object>, depth: number): boolean {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor == null
      || !descriptor.enumerable
      || !("value" in descriptor)
      || !isWireStableJsonValueAt(descriptor.value, ancestors, depth)
    ) {
      return false;
    }
  }
  return true;
}

const AUTHORITY_ENTRY_KINDS: ReadonlySet<string> = new Set([
  "TURN_COMMIT",
  "REPLACEMENT_COMMIT",
  "INTERACTION_COMMIT",
  "CONTROL_COMMIT",
  "WAVE_ADVANCE",
  "TERMINAL_COMMIT",
]);

/**
 * A shared terminal is itself a mechanical boundary, never an incidental successor of another entry kind.
 * Conversely, TERMINAL_COMMIT must close the graph with TERMINAL.
 */
export function isAuthorityEntryControlCompatible(kind: unknown, control: unknown): boolean {
  if (typeof kind !== "string" || !AUTHORITY_ENTRY_KINDS.has(kind) || !isCanonicalNextControl(control)) {
    return false;
  }
  return kind === "TERMINAL_COMMIT" ? control.kind === "TERMINAL" : control.kind !== "TERMINAL";
}

/** Whether a value is a structurally valid, non-null CoopNextControl. */
export function isValidNextControl(control: unknown): control is CoopNextControl {
  return isCanonicalNextControl(control);
}

/** Whether a value is a structurally valid CoopFrameContextV2 (mandatory on every mechanical frame, decision 3). */
export function isValidFrameContext(context: unknown): context is CoopFrameContextV2 {
  if (context == null || typeof context !== "object") {
    return false;
  }
  const c = context as Partial<CoopFrameContextV2>;
  return (
    typeof c.sessionId === "string"
    && c.sessionId.length > 0
    && typeof c.runId === "string"
    && c.runId.length > 0
    && typeof c.seatMapId === "string"
    && c.seatMapId.length > 0
    && Number.isSafeInteger(c.sessionEpoch)
    && Number.isSafeInteger(c.membershipRevision)
    && Number.isSafeInteger(c.senderSeatId)
    && Number.isSafeInteger(c.authoritySeatId)
    && Number.isSafeInteger(c.connectionGeneration)
  );
}

/**
 * Whether a value is a structurally valid CoopAuthorityEntry (a committed one - `revision` present). Used
 * to reject a malformed inbound frame at the replica boundary BEFORE it can perturb ordering state. Checks
 * identity (operationId + revision), the digest, the kind, the frame context, the successor control, and
 * JSON-wire stability of the complete entry. The payload remains mechanically opaque, but it may not carry
 * a shape whose JSON representation differs from the value used to derive its digest.
 */
export function isValidAuthorityEntry(entry: unknown): entry is CoopAuthorityEntry {
  if (entry == null || typeof entry !== "object" || !isWireStableJsonValue(entry)) {
    return false;
  }
  const candidate = entry as Partial<CoopAuthorityEntry>;
  return (
    isValidRevision(candidate.revision)
    && isValidOperationId(candidate.operationId)
    && typeof candidate.kind === "string"
    && AUTHORITY_ENTRY_KINDS.has(candidate.kind)
    && hasValidDigest(candidate as { material?: { digest?: unknown } })
    && isValidFrameContext(candidate.context)
    && isValidNextControl(candidate.nextControl)
    && isAuthorityEntryControlCompatible(candidate.kind, candidate.nextControl)
    && Array.isArray(candidate.subsumes)
    && candidate.subsumes.every(isValidRevision)
  );
}

/**
 * Whether an entry belongs to the SAME session identity as a local frame context - the immutable
 * (sessionId, runId, seatMapId) triple. A mismatch here is a hard reject (a frame from a different run
 * or seat map), NOT a stale epoch (which is a same-session generational lag, classified separately).
 */
export function isSameSessionIdentity(a: CoopFrameContextV2, b: CoopFrameContextV2): boolean {
  return a.sessionId === b.sessionId && a.runId === b.runId && a.seatMapId === b.seatMapId;
}

/**
 * Whether an entry + a receipt address the exact SAME committed operation: same revision AND same
 * operationId. Receipt intake matches on this pair so a receipt can never advance the wrong entry's stage.
 */
export function receiptMatchesEntry(receipt: CoopAuthorityReceipt, entry: CoopAuthorityEntry): boolean {
  return receipt.revision === entry.revision && receipt.operationId === entry.operationId;
}

/**
 * Deep-freeze an authority entry (the immutability guard). Once committed, an entry's identity, material,
 * successor control, and subsumption list are FROZEN, so retention holds a value no caller can rewrite.
 * Returns the same (now frozen) reference for call-site convenience.
 */
export function freezeAuthorityEntry(entry: CoopAuthorityEntry): CoopAuthorityEntry {
  deepFreeze(entry);
  return entry;
}

/** Recursively freeze a plain JSON-shaped value. Cyclic input is not expected (entries are wire values). */
function deepFreeze(value: unknown): void {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) {
    return;
  }
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
}
