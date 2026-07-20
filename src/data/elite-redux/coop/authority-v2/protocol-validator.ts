/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - Lane 5: the ONE inbound-frame boundary validator.
//
// `validateInboundFrame` is the single place a raw wire value becomes a trusted
// `CoopFrameV2`. It replaces the audited coop-transport defect where any decoded
// object with a string `t` was cast to `CoopMessage` and each consumer
// re-validated piecemeal (so a malformed frame surfaced downstream as an
// unrelated timeout). Here every mechanically relevant field - the context, the
// entry/receipt shapes, AND the nested next-control shapes - is checked ONCE,
// exhaustively, at the boundary. Three outcomes:
//
//   valid              - a fully-formed frame; the integration owner may trust it.
//   protocol-violation - a mechanically relevant but malformed frame (bad
//                        version, absent/garbage field, unknown control kind).
//                        The integration owner wires this to a CLASSIFIED shared
//                        terminal; `issues` names every offending field.
//   cosmetic-drop      - an unknown (non-mechanical) frame type; harmlessly
//                        dropped, never terminal.
//
// Hand-rolled schema checks only - the repo ships no zod. Fuzz-ish garbage
// (null / arrays / deep nonsense / bad JSON) is always classified, never thrown.
//
// Engine-free: depends only on the (TYPE-erased) contract, the codec, and the
// frame-context module.
// =============================================================================

import { isAuthorityEntryControlCompatible } from "#data/elite-redux/coop/authority-v2/authority-entry";
import type { CoopAckStage, CoopAuthorityEntryKind } from "#data/elite-redux/coop/authority-v2/contract";
import type {
  CoopAuthorityEntryBodyV2,
  CoopAuthorityReceiptBodyV2,
  CoopFrameTypeV2,
  CoopFrameV2,
  CoopRecoveryAppliedBodyV2,
  CoopRecoveryBundleBodyV2,
  CoopRecoveryRequestBodyV2,
  CoopTailRequestBodyV2,
  CoopTerminalBodyV2,
} from "#data/elite-redux/coop/authority-v2/frame-codec";
import { COOP_FRAME_PROTOCOL_VERSION, decodeFrameV2 } from "#data/elite-redux/coop/authority-v2/frame-codec";
import {
  frameContextIssues,
  isFrameContextV2,
  isNonEmptyString,
  isNonNegSafeInt,
  isPlainObject,
} from "#data/elite-redux/coop/authority-v2/frame-context";
import { nextControlIssues as canonicalNextControlIssues } from "#data/elite-redux/coop/authority-v2/next-control";

/** The one public boundary result. */
export type CoopInboundFrameResultV2 =
  | { readonly kind: "valid"; readonly frame: CoopFrameV2 }
  | { readonly kind: "cosmetic-drop"; readonly reason: string }
  | { readonly kind: "protocol-violation"; readonly frameType: string | null; readonly issues: readonly string[] };

// ---------------------------------------------------------------------------
// Contract allow-lists (kept in lock-step with the frozen contract unions).
// ---------------------------------------------------------------------------

const ENTRY_KINDS: readonly CoopAuthorityEntryKind[] = [
  "TURN_COMMIT",
  "REPLACEMENT_COMMIT",
  "INTERACTION_COMMIT",
  "CONTROL_COMMIT",
  "WAVE_ADVANCE",
  "TERMINAL_COMMIT",
];

const ACK_STAGES: readonly CoopAckStage[] = ["admitted", "materialApplied", "controlInstalled", "presentationSettled"];

function inList(list: readonly string[], value: unknown): boolean {
  return typeof value === "string" && list.includes(value);
}

// ---------------------------------------------------------------------------
// Nested: CoopNextControl (frozen decision 4).
// ---------------------------------------------------------------------------

function recoveryNextControlIssues(control: unknown): string[] {
  if (control === null) {
    return [];
  }
  return canonicalNextControlIssues(control).map(issue => `nextControl.${issue}`);
}

function mechanicalNextControlIssues(control: unknown): string[] {
  return control === null
    ? ["nextControl: required"]
    : canonicalNextControlIssues(control).map(issue => `nextControl.${issue}`);
}

function isPositiveSafeInt(value: unknown): value is number {
  return isNonNegSafeInt(value) && value > 0;
}

// ---------------------------------------------------------------------------
// Nested: authoritative material { digest, payload }.
// ---------------------------------------------------------------------------

function materialIssues(material: unknown): string[] {
  if (!isPlainObject(material)) {
    return ["material: not an object"];
  }
  const issues: string[] = [];
  if (!isNonEmptyString(material.digest)) {
    issues.push("material.digest");
  }
  // `payload` is opaque-to-the-log (any JSON value incl. null), but the KEY is mandatory.
  if (!("payload" in material)) {
    issues.push("material.payload");
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Per-frame-type body validators. Each returns the offending field paths.
// ---------------------------------------------------------------------------

function authorityEntryBodyIssues(body: unknown): string[] {
  if (!isPlainObject(body)) {
    return ["not an object"];
  }
  const issues: string[] = [];
  if (!isPositiveSafeInt(body.revision)) {
    issues.push("revision");
  }
  if (!isNonEmptyString(body.operationId)) {
    issues.push("operationId");
  }
  if (!inList(ENTRY_KINDS, body.kind)) {
    issues.push("kind");
  }
  issues.push(...materialIssues(body.material));
  issues.push(...mechanicalNextControlIssues(body.nextControl));
  if (
    inList(ENTRY_KINDS, body.kind)
    && canonicalNextControlIssues(body.nextControl).length === 0
    && !isAuthorityEntryControlCompatible(body.kind, body.nextControl)
  ) {
    issues.push("nextControl: incompatible with entry kind");
  }
  if (!Array.isArray(body.subsumes) || !body.subsumes.every(isPositiveSafeInt)) {
    issues.push("subsumes");
  }
  return issues;
}

function authorityReceiptBodyIssues(body: unknown): string[] {
  if (!isPlainObject(body)) {
    return ["not an object"];
  }
  const issues: string[] = [];
  if (!isNonNegSafeInt(body.revision)) {
    issues.push("revision");
  }
  if (!isNonEmptyString(body.operationId)) {
    issues.push("operationId");
  }
  if (!inList(ACK_STAGES, body.stage)) {
    issues.push("stage");
  }
  // controlId is optional, but when present it must be a non-empty control identity.
  if ("controlId" in body && body.controlId !== undefined && !isNonEmptyString(body.controlId)) {
    issues.push("controlId");
  }
  return issues;
}

function tailRequestBodyIssues(body: unknown): string[] {
  if (!isPlainObject(body)) {
    return ["not an object"];
  }
  return isNonNegSafeInt(body.fromRevision) ? [] : ["fromRevision"];
}

function recoveryRequestBodyIssues(body: unknown): string[] {
  if (!isPlainObject(body)) {
    return ["not an object"];
  }
  const issues: string[] = [];
  if (!isNonEmptyString(body.requestId)) {
    issues.push("requestId");
  }
  if (!isNonNegSafeInt(body.capturedFrontier)) {
    issues.push("capturedFrontier");
  }
  if (!isNonEmptyString(body.reason)) {
    issues.push("reason");
  }
  return issues;
}

function recoveryBundleBodyIssues(body: unknown): string[] {
  if (!isPlainObject(body)) {
    return ["not an object"];
  }
  const issues: string[] = [];
  if (!isNonEmptyString(body.requestId)) {
    issues.push("requestId");
  }
  issues.push(...materialIssues(body.material));
  if (!isNonNegSafeInt(body.frontier)) {
    issues.push("frontier");
  }
  if (
    !isNonNegSafeInt(body.frontier)
    || (body.frontier === 0 ? body.frontierOperationId !== null : !isNonEmptyString(body.frontierOperationId))
  ) {
    issues.push("frontierOperationId");
  }
  if (!isNonNegSafeInt(body.membershipRevision)) {
    issues.push("membershipRevision");
  }
  if (isNonNegSafeInt(body.frontier)) {
    if (body.frontier === 0) {
      if (body.nextControl !== null) {
        issues.push("nextControl: must be null at frontier zero");
      }
    } else {
      issues.push(...mechanicalNextControlIssues(body.nextControl));
    }
  } else {
    issues.push(...recoveryNextControlIssues(body.nextControl));
  }
  if (Array.isArray(body.requiredTail)) {
    body.requiredTail.forEach((entry, index) => {
      for (const entryIssue of authorityEntryBodyIssues(entry)) {
        issues.push(`requiredTail[${index}].${entryIssue}`);
      }
    });
  } else {
    issues.push("requiredTail");
  }
  return issues;
}

function recoveryAppliedBodyIssues(body: unknown): string[] {
  if (!isPlainObject(body)) {
    return ["not an object"];
  }
  const issues: string[] = [];
  if (!isNonEmptyString(body.requestId)) {
    issues.push("requestId");
  }
  if (!isNonNegSafeInt(body.frontier)) {
    issues.push("frontier");
  }
  if (!isNonEmptyString(body.materialDigest)) {
    issues.push("materialDigest");
  }
  if ("controlId" in body && body.controlId !== undefined && !isNonEmptyString(body.controlId)) {
    issues.push("controlId");
  }
  return issues;
}

function terminalBodyIssues(body: unknown): string[] {
  if (!isPlainObject(body)) {
    return ["not an object"];
  }
  const issues: string[] = [];
  if (!isNonEmptyString(body.terminalId)) {
    issues.push("terminalId");
  }
  if (!isNonEmptyString(body.reason)) {
    issues.push("reason");
  }
  return issues;
}

function bodyIssuesFor(frameType: CoopFrameTypeV2, body: unknown): string[] {
  switch (frameType) {
    case "authorityEntry":
      return authorityEntryBodyIssues(body);
    case "authorityReceipt":
      return authorityReceiptBodyIssues(body);
    case "tailRequest":
      return tailRequestBodyIssues(body);
    case "recoveryRequest":
      return recoveryRequestBodyIssues(body);
    case "recoveryBundle":
      return recoveryBundleBodyIssues(body);
    case "recoveryApplied":
      return recoveryAppliedBodyIssues(body);
    case "terminal":
      return terminalBodyIssues(body);
  }
}

// ---------------------------------------------------------------------------
// Body type guards (issue-list-derived, so the schema is defined ONCE). Used to
// narrow the validated body to its exact type when assembling the trusted frame
// - no `as` cast is needed anywhere.
// ---------------------------------------------------------------------------

function isAuthorityEntryBody(body: unknown): body is CoopAuthorityEntryBodyV2 {
  return authorityEntryBodyIssues(body).length === 0;
}
function isAuthorityReceiptBody(body: unknown): body is CoopAuthorityReceiptBodyV2 {
  return authorityReceiptBodyIssues(body).length === 0;
}
function isTailRequestBody(body: unknown): body is CoopTailRequestBodyV2 {
  return tailRequestBodyIssues(body).length === 0;
}
function isRecoveryRequestBody(body: unknown): body is CoopRecoveryRequestBodyV2 {
  return recoveryRequestBodyIssues(body).length === 0;
}
function isRecoveryBundleBody(body: unknown): body is CoopRecoveryBundleBodyV2 {
  return recoveryBundleBodyIssues(body).length === 0;
}
function isRecoveryAppliedBody(body: unknown): body is CoopRecoveryAppliedBodyV2 {
  return recoveryAppliedBodyIssues(body).length === 0;
}
function isTerminalBody(body: unknown): body is CoopTerminalBodyV2 {
  return terminalBodyIssues(body).length === 0;
}

// ---------------------------------------------------------------------------
// Boundary
// ---------------------------------------------------------------------------

function violation(frameType: string | null, issues: string[]): CoopInboundFrameResultV2 {
  return { kind: "protocol-violation", frameType, issues };
}

/**
 * Assemble a trusted frame from a fully-validated envelope. Reached ONLY after
 * `validateEnvelope` proved zero issues, so every guard below succeeds; the
 * per-type guard narrows `body` to its exact type (no cast). The defensive
 * fall-throughs are unreachable but keep the assembly total.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: exhaustive typed assembly intentionally mirrors the closed wire-frame union in one boundary
function assembleValidFrame(frameType: CoopFrameTypeV2, ctx: unknown, body: unknown): CoopInboundFrameResultV2 {
  const v = COOP_FRAME_PROTOCOL_VERSION;
  if (!isFrameContextV2(ctx)) {
    return violation(frameType, ["ctx"]);
  }
  switch (frameType) {
    case "authorityEntry":
      return isAuthorityEntryBody(body)
        ? { kind: "valid", frame: { v, t: "authorityEntry", ctx, body } }
        : violation(frameType, ["body"]);
    case "authorityReceipt":
      return isAuthorityReceiptBody(body)
        ? { kind: "valid", frame: { v, t: "authorityReceipt", ctx, body } }
        : violation(frameType, ["body"]);
    case "tailRequest":
      return isTailRequestBody(body)
        ? { kind: "valid", frame: { v, t: "tailRequest", ctx, body } }
        : violation(frameType, ["body"]);
    case "recoveryRequest":
      return isRecoveryRequestBody(body)
        ? { kind: "valid", frame: { v, t: "recoveryRequest", ctx, body } }
        : violation(frameType, ["body"]);
    case "recoveryBundle":
      return isRecoveryBundleBody(body)
        ? { kind: "valid", frame: { v, t: "recoveryBundle", ctx, body } }
        : violation(frameType, ["body"]);
    case "recoveryApplied":
      return isRecoveryAppliedBody(body)
        ? { kind: "valid", frame: { v, t: "recoveryApplied", ctx, body } }
        : violation(frameType, ["body"]);
    case "terminal":
      return isTerminalBody(body)
        ? { kind: "valid", frame: { v, t: "terminal", ctx, body } }
        : violation(frameType, ["body"]);
  }
}

function validateEnvelope(frameType: CoopFrameTypeV2, ctx: unknown, body: unknown): CoopInboundFrameResultV2 {
  const issues: string[] = [];
  for (const ctxIssue of frameContextIssues(ctx)) {
    issues.push(`ctx.${ctxIssue}`);
  }
  for (const bodyIssue of bodyIssuesFor(frameType, body)) {
    issues.push(`body.${bodyIssue}`);
  }
  if (issues.length > 0) {
    return violation(frameType, issues);
  }
  return assembleValidFrame(frameType, ctx, body);
}

/**
 * THE inbound boundary. Classify a raw wire value (string or already-parsed
 * object) into exactly one of valid / cosmetic-drop / protocol-violation.
 * Total over all inputs - never throws.
 */
export function validateInboundFrame(raw: unknown): CoopInboundFrameResultV2 {
  const decoded = decodeFrameV2(raw);
  switch (decoded.kind) {
    case "not-a-frame":
      return violation(null, [decoded.reason]);
    case "bad-version":
      return violation(null, [`unsupported frame protocol version: ${describeVersion(decoded.version)}`]);
    case "unknown-type":
      return { kind: "cosmetic-drop", reason: `unknown cosmetic frame type: ${decoded.frameType}` };
    case "envelope":
      return validateEnvelope(decoded.frameType, decoded.ctx, decoded.body);
  }
}

function describeVersion(version: unknown): string {
  if (version === undefined) {
    return "undefined";
  }
  if (typeof version === "string") {
    return version;
  }
  if (typeof version === "number" || typeof version === "boolean" || version === null) {
    return String(version);
  }
  return typeof version;
}
