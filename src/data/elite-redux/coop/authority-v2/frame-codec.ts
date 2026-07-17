/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - Lane 5: the v2 wire envelope + codec.
//
// Every mechanically relevant v2 frame is the SAME shape:
//
//     { v: 2, t: <frameType>, ctx: CoopFrameContextV2, body: <per-type> }
//
// `ctx` is the ONE authenticated context (frozen decision 3), so the entry /
// receipt BODIES carry no context of their own - they inherit the envelope's.
// `v` is the single-source protocol version, checked on decode so a stale build
// (which would otherwise smuggle a shape mismatch downstream) fails closed.
//
// The audited coop-transport defect this replaces: `receive()` cast any decoded
// object with a string `t` straight to `CoopMessage`, so malformed frames slid
// past into consumers and surfaced as unrelated timeouts. Here `decodeFrameV2`
// NEVER casts - it returns a discriminated result. Deep field validation is the
// boundary validator's job (protocol-validator.ts); this codec does the
// structural envelope discrimination (JSON parse, version gate, frame-type
// recognition) and hands the raw `ctx`/`body` on as `unknown`.
//
// Engine-free: TYPE-only contract import, no runtime dependencies.
// =============================================================================

import type {
  CoopAuthorityEntry,
  CoopAuthorityReceipt,
  CoopFrameContextV2,
} from "#data/elite-redux/coop/authority-v2/contract";

/** The single-source v2 wire protocol version. Bump when the envelope shape changes. */
export const COOP_FRAME_PROTOCOL_VERSION = 2 as const;

/** The mechanically relevant v2 frame types Lane 5 codes + validates. */
export type CoopFrameTypeV2 =
  | "authorityEntry"
  | "authorityReceipt"
  | "tailRequest"
  | "recoveryRequest"
  | "recoveryBundle"
  | "terminal";

/** The exhaustive frame-type set, iterable for recognition + tests. */
export const COOP_FRAME_TYPES_V2: readonly CoopFrameTypeV2[] = [
  "authorityEntry",
  "authorityReceipt",
  "tailRequest",
  "recoveryRequest",
  "recoveryBundle",
  "terminal",
];

export function isCoopFrameTypeV2(value: unknown): value is CoopFrameTypeV2 {
  return typeof value === "string" && (COOP_FRAME_TYPES_V2 as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Per-frame-type bodies. Entry/receipt bodies OMIT `context` (frozen decision
// 3: the envelope carries the one authenticated context).
// ---------------------------------------------------------------------------

/** authorityEntry body: a committed authoritative entry minus its envelope-inherited context. */
export type CoopAuthorityEntryBodyV2 = Omit<CoopAuthorityEntry, "context">;

/** authorityReceipt body: replica progress evidence minus its envelope-inherited context. */
export type CoopAuthorityReceiptBodyV2 = Omit<CoopAuthorityReceipt, "context">;

/** tailRequest body: the replica asks the authority to redeliver retained entries from a revision. */
export interface CoopTailRequestBodyV2 {
  readonly fromRevision: number;
}

/** recoveryRequest body: the recovering peer requests a bundle for its captured frontier. */
export interface CoopRecoveryRequestBodyV2 {
  readonly capturedFrontier: number;
  readonly reason: string;
}

/** recoveryBundle body: the authority's response - a proven frontier + the entries to apply. */
export interface CoopRecoveryBundleBodyV2 {
  readonly frontier: number;
  readonly entries: readonly CoopAuthorityEntryBodyV2[];
}

/** terminal body: a classified shared-terminal statement ending mechanical liveness. */
export interface CoopTerminalBodyV2 {
  readonly terminalId: string;
  readonly reason: string;
}

/** One typed v2 envelope: version + discriminant + the one authenticated context + a body. */
export interface CoopFrameEnvelopeV2<T extends CoopFrameTypeV2, B> {
  readonly v: typeof COOP_FRAME_PROTOCOL_VERSION;
  readonly t: T;
  readonly ctx: CoopFrameContextV2;
  readonly body: B;
}

/** The discriminated union of every valid v2 frame. */
export type CoopFrameV2 =
  | CoopFrameEnvelopeV2<"authorityEntry", CoopAuthorityEntryBodyV2>
  | CoopFrameEnvelopeV2<"authorityReceipt", CoopAuthorityReceiptBodyV2>
  | CoopFrameEnvelopeV2<"tailRequest", CoopTailRequestBodyV2>
  | CoopFrameEnvelopeV2<"recoveryRequest", CoopRecoveryRequestBodyV2>
  | CoopFrameEnvelopeV2<"recoveryBundle", CoopRecoveryBundleBodyV2>
  | CoopFrameEnvelopeV2<"terminal", CoopTerminalBodyV2>;

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Serialize a typed frame to its wire string. The envelope already carries
 * `v: 2` by construction, so the encoded form is versioned; the wire is plain
 * JSON so it crosses the real WebRTC transport and round-trips through
 * {@linkcode decodeFrameV2}.
 */
export function encodeFrameV2(frame: CoopFrameV2): string {
  return JSON.stringify(frame);
}

// ---------------------------------------------------------------------------
// Decode (structural discrimination only - NEVER a cast)
// ---------------------------------------------------------------------------

/**
 * The structural decode outcome. `envelope` means the frame is a recognized v2
 * envelope shape (correct version + known frame type); its `ctx`/`body` are
 * still `unknown` and MUST be deep-validated by the boundary validator before
 * use. The other arms are terminal classifications the validator maps to its
 * public result.
 */
export type CoopEnvelopeDecodeV2 =
  | { readonly kind: "envelope"; readonly frameType: CoopFrameTypeV2; readonly ctx: unknown; readonly body: unknown }
  | { readonly kind: "unknown-type"; readonly frameType: string }
  | { readonly kind: "bad-version"; readonly version: unknown }
  | { readonly kind: "not-a-frame"; readonly reason: string };

/**
 * Structurally decode a raw inbound value (a JSON string OR an already-parsed
 * object - loopback delivers objects, WebRTC delivers strings). Returns a
 * discriminated result and NEVER casts an unvalidated object to a frame type.
 */
export function decodeFrameV2(raw: unknown): CoopEnvelopeDecodeV2 {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return { kind: "not-a-frame", reason: "malformed JSON" };
    }
  }
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return { kind: "not-a-frame", reason: "frame is not a JSON object" };
  }
  const envelope = value as Record<string, unknown>;
  if (!("v" in envelope)) {
    return { kind: "not-a-frame", reason: "missing protocol version `v`" };
  }
  if (envelope.v !== COOP_FRAME_PROTOCOL_VERSION) {
    return { kind: "bad-version", version: envelope.v };
  }
  if (typeof envelope.t !== "string") {
    return { kind: "not-a-frame", reason: "frame type `t` is missing or not a string" };
  }
  if (!isCoopFrameTypeV2(envelope.t)) {
    return { kind: "unknown-type", frameType: envelope.t };
  }
  return { kind: "envelope", frameType: envelope.t, ctx: envelope.ctx, body: envelope.body };
}
