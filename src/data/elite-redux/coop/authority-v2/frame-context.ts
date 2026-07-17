/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - Lane 5: mandatory frame context (frozen decision 3).
//
// CoopFrameContextV2 is the ONE authenticated address stamped on every
// mechanically relevant v2 frame. This module is the sole place that CONSTRUCTS
// and strictly VALIDATES it: every field is mandatory and every field is
// range-checked (non-empty identity strings, non-negative safe-integer
// revisions/seats/generations). No optional legacy address fields exist, so a
// frame either carries a complete, well-formed context or it is rejected at the
// boundary (see protocol-validator.ts) - never validated piecemeal downstream.
//
// Engine-free: the only import is the TYPE-erased contract, so this module
// carries zero runtime dependency on Phaser/the transport and runs in the
// node-pure test lane.
// =============================================================================

import type { CoopFrameContextV2, CoopRuntimeContext } from "#data/elite-redux/coop/authority-v2/contract";

// ---------------------------------------------------------------------------
// Shared primitive guards (reused by the codec/validator - the same mandatory
// + safe-integer discipline applies to every nested body field).
// ---------------------------------------------------------------------------

/** A present, non-empty identity/opaque string. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** A present, non-negative, safe-integer count/revision/seat/generation. */
export function isNonNegSafeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** A plain (non-null, non-array) object we can read keyed fields off. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Strict validation
// ---------------------------------------------------------------------------

/**
 * The eight mandatory {@linkcode CoopFrameContextV2} fields, checked in a
 * stable order. Returns the list of offending FIELD NAMES (empty => valid); a
 * value that is not even an object yields a single structural issue. Naming the
 * exact field is load-bearing: the boundary reports it so a classified terminal
 * (and the audit log) can point at the precise malformed address, instead of
 * the old "surfaced as an unrelated timeout" failure mode.
 */
export function frameContextIssues(value: unknown): string[] {
  if (!isPlainObject(value)) {
    return ["frame context is not an object"];
  }
  const issues: string[] = [];
  if (!isNonEmptyString(value.sessionId)) {
    issues.push("sessionId");
  }
  if (!isNonEmptyString(value.runId)) {
    issues.push("runId");
  }
  if (!isNonNegSafeInt(value.sessionEpoch)) {
    issues.push("sessionEpoch");
  }
  if (!isNonEmptyString(value.seatMapId)) {
    issues.push("seatMapId");
  }
  if (!isNonNegSafeInt(value.membershipRevision)) {
    issues.push("membershipRevision");
  }
  if (!isNonNegSafeInt(value.senderSeatId)) {
    issues.push("senderSeatId");
  }
  if (!isNonNegSafeInt(value.authoritySeatId)) {
    issues.push("authoritySeatId");
  }
  if (!isNonNegSafeInt(value.connectionGeneration)) {
    issues.push("connectionGeneration");
  }
  return issues;
}

/** Type guard: a fully-formed frame context (every mandatory field present + in range). */
export function isFrameContextV2(value: unknown): value is CoopFrameContextV2 {
  return frameContextIssues(value).length === 0;
}

/** Thrown by {@linkcode assertFrameContextV2}/{@linkcode bindFrameContext} on an invalid context. */
export class CoopFrameContextError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`invalid CoopFrameContextV2: ${issues.join(", ")}`);
    this.name = "CoopFrameContextError";
    this.issues = issues;
  }
}

/** Validate + brand, or throw {@linkcode CoopFrameContextError} naming the offending fields. */
export function assertFrameContextV2(value: unknown): CoopFrameContextV2 {
  const issues = frameContextIssues(value);
  if (issues.length > 0) {
    throw new CoopFrameContextError(issues);
  }
  // `value` passed every field check above; narrow it.
  return value as CoopFrameContextV2;
}

// ---------------------------------------------------------------------------
// Equality + compatibility
// ---------------------------------------------------------------------------

/** Byte-exact equality across all eight fields (retransmit de-duplication). */
export function frameContextsEqual(a: CoopFrameContextV2, b: CoopFrameContextV2): boolean {
  return (
    a.sessionId === b.sessionId
    && a.runId === b.runId
    && a.sessionEpoch === b.sessionEpoch
    && a.seatMapId === b.seatMapId
    && a.membershipRevision === b.membershipRevision
    && a.senderSeatId === b.senderSeatId
    && a.authoritySeatId === b.authoritySeatId
    && a.connectionGeneration === b.connectionGeneration
  );
}

/**
 * Whether two contexts address the SAME shared game: identical session
 * (sessionId + runId), session epoch, seat map, and membership revision. The
 * per-peer / per-connection fields (senderSeatId, authoritySeatId,
 * connectionGeneration) deliberately do NOT participate - two peers, or the
 * same peer across a channel replacement, produce compatible-but-unequal
 * contexts. A receipt whose context is incompatible with the entry it
 * references is a cross-session/stale-epoch frame the boundary rejects.
 */
export function frameContextsCompatible(a: CoopFrameContextV2, b: CoopFrameContextV2): boolean {
  return (
    a.sessionId === b.sessionId
    && a.runId === b.runId
    && a.sessionEpoch === b.sessionEpoch
    && a.seatMapId === b.seatMapId
    && a.membershipRevision === b.membershipRevision
  );
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * The per-CONNECTION binding fields a frame context needs that the immutable
 * {@linkcode CoopRuntimeContext} identity does NOT carry:
 *  - `seatMapId`: the hash of the negotiated seat map (a session-binding value).
 *  - `connectionGeneration`: the authenticated channel generation, which
 *    increments on every reconnect/channel replacement and therefore CANNOT
 *    live in an immutable per-session context.
 *
 * CONTRACT CHANGE REQUEST (integration owner): `CoopRuntimeContext` in
 * contract.ts exposes neither field, so `bindFrameContext` cannot mint a
 * complete `CoopFrameContextV2` from the runtime context alone. Either add
 * `seatMapId` + `connectionGeneration` to `CoopRuntimeContext`, or bless this
 * second parameter as the canonical connection binding. This module fabricates
 * NEITHER value (a hardcoded 0 would mis-route across reconnects).
 */
export interface CoopFrameConnectionBindingV2 {
  readonly seatMapId: string;
  readonly connectionGeneration: number;
}

/**
 * Mint the authenticated frame context for the local sender from its runtime
 * identity plus the live connection binding. Strictly validated before return
 * (throws {@linkcode CoopFrameContextError} on any malformed field) and frozen,
 * so a caller can never emit a partially-formed address.
 */
export function bindFrameContext(
  ctx: CoopRuntimeContext,
  connection: CoopFrameConnectionBindingV2,
): CoopFrameContextV2 {
  const built: CoopFrameContextV2 = {
    sessionId: ctx.sessionId,
    runId: ctx.runId,
    sessionEpoch: ctx.epoch,
    seatMapId: connection.seatMapId,
    membershipRevision: ctx.membershipRevision,
    senderSeatId: ctx.localSeatId,
    authoritySeatId: ctx.authoritySeatId,
    connectionGeneration: connection.connectionGeneration,
  };
  const issues = frameContextIssues(built);
  if (issues.length > 0) {
    throw new CoopFrameContextError(issues);
  }
  return Object.freeze(built);
}
