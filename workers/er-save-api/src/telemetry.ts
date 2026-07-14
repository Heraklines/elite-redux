/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// PLAYER TELEMETRY INGEST (#player-telemetry). Staging-gated ML capture sink.
//
// The client records every player decision as a semantic (state, action) event
// stream (see src/data/elite-redux/telemetry/*), batches + compresses it, and
// POSTs one compressed batch to `POST /telemetry/ingest`. This worker validates
// the session token (the SAME stateless-HMAC auth as the savedata endpoints),
// enforces a size cap + a simple per-user rate limit, and writes the compressed
// payload VERBATIM to the R2 binding `TELEMETRY` as an immutable object keyed
//   {yyyy-mm-dd}/{mode}/{sessionId}/{seq}.jsonl.gz
// with useful object metadata (userIdHash / build / schemaVersion). The dataset
// is for training a combat AI on how real players play, so the payload is never
// inspected here - it is stored opaquely for an offline ML pipeline.
//
// PRIVACY: the worker stores only the client's PSEUDONYMOUS `userIdHash` (a hash
// of the account id + a server salt, computed client-side). It NEVER writes the
// raw username/email into an R2 object or its metadata. The authenticated
// username (auth.u) is used ONLY for the in-memory rate-limit bucket key and is
// never persisted.
//
// This module is intentionally free of Cloudflare ambient types (D1Database /
// R2Bucket / ExecutionContext) so it unit-tests in plain vitest without
// @cloudflare/workers-types: the R2 binding is a minimal STRUCTURAL interface a
// real `R2Bucket` satisfies, and the auth payload is passed in already-verified.
// =============================================================================

/** Hard cap on one compressed batch (~1MB). A larger body is rejected 413. */
export const TELEMETRY_MAX_BYTES = 1_048_576;

/** Per-user ingest budget: at most this many batches per {@link TELEMETRY_RATE_WINDOW_MS}. */
export const TELEMETRY_RATE_MAX = 40;

/** Rolling rate-limit window (ms). The client targets <= ~30 ingests/player-hour. */
export const TELEMETRY_RATE_WINDOW_MS = 60_000;

/** Minimal structural view of the R2 binding this module needs (a real `R2Bucket` satisfies it). */
export interface TelemetryR2Bucket {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array | string,
    options?: { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> },
  ): Promise<unknown>;
}

/** The subset of the worker env this module reads. `TELEMETRY` is optional so a not-yet-bound R2 fails soft (503). */
export interface TelemetryEnv {
  TELEMETRY?: TelemetryR2Bucket;
}

/** Already-verified session-token payload (the worker's `authUser` result). */
export interface TelemetryAuth {
  uid: number;
  u: string;
}

/** In-memory per-user rate-limit bucket (best-effort, per-isolate; mirrors the worker's other module caches). */
interface RateBucket {
  count: number;
  resetAt: number;
}
const rateBuckets = new Map<number, RateBucket>();

/**
 * Sanitize one R2-key path segment: keep only key-safe chars and cap length, so a hostile
 * `mode` / `sessionId` / `seq` can never traverse (`..`, `/`) or bloat the key. Empty / all-illegal
 * input collapses to `fallback` so the key is always well-formed.
 */
export function sanitizeSegment(raw: unknown, fallback: string): string {
  const s = typeof raw === "string" ? raw : "";
  const cleaned = s.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64);
  return cleaned.length > 0 ? cleaned : fallback;
}

/** UTC `yyyy-mm-dd` for the object-key date prefix (partitions the dataset by day for the ML pipeline). */
export function telemetryDateSegment(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Build the immutable R2 object key: `{yyyy-mm-dd}/{mode}/{sessionId}/{seq}.jsonl.gz`. Every segment is
 * sanitized so the key is always traversal-safe and well-formed regardless of client input.
 */
export function telemetryObjectKey(parts: { date: string; mode: unknown; sessionId: unknown; seq: unknown }): string {
  const mode = sanitizeSegment(parts.mode, "unknown");
  const sessionId = sanitizeSegment(parts.sessionId, "nosession");
  const seq = sanitizeSegment(parts.seq, "0");
  return `${parts.date}/${mode}/${sessionId}/${seq}.jsonl.gz`;
}

/**
 * Best-effort per-user rate limit. Returns true when the caller is WITHIN budget (and records the hit),
 * false when the budget for the current window is exhausted. Per-isolate + in-memory: a determined caller
 * spread across isolates can exceed it, which is acceptable for a telemetry sink (the goal is to bound a
 * single misbehaving client, not to be a hard quota). The window resets lazily on the first hit after it.
 */
export function checkRateLimit(
  userId: number,
  now: number,
  max: number = TELEMETRY_RATE_MAX,
  windowMs: number = TELEMETRY_RATE_WINDOW_MS,
  buckets: Map<number, RateBucket> = rateBuckets,
): boolean {
  const bucket = buckets.get(userId);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(userId, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= max) {
    return false;
  }
  bucket.count++;
  return true;
}

/** Reset the in-memory rate-limit state (test hook). */
export function resetTelemetryRateLimit(): void {
  rateBuckets.clear();
}

function textResponse(body: string, status: number, cors: Record<string, string>): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain", ...cors } });
}

function jsonResponse(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
}

/**
 * Handle `POST /telemetry/ingest`. The caller (index.ts) resolves the session token (from the
 * `Authorization` header for a `fetch` flush, or the `?t=` query param for a `navigator.sendBeacon`
 * flush, which cannot set headers) and passes the resolved {@link TelemetryAuth} or `null`; this owns the
 * 401 so auth rejection is unit-testable without the worker's crypto. It then validates the payload +
 * writes it. Reads batch metadata from the query string (mode / sessionId / seq / build / schemaVersion /
 * uidHash) and the compressed batch from the raw request body. Never inspects the body (opaque compressed
 * bytes).
 *
 * Responses: 401 when unauthenticated, 200 `{ ok, key }` on write, 503 when R2 is not yet bound (graceful
 * until the maintainer enables R2 on the account), 413 over the size cap, 429 over the per-user rate limit,
 * 400 on an empty body.
 */
export async function handleTelemetryIngest(
  request: Request,
  auth: TelemetryAuth | null,
  env: TelemetryEnv,
  cors: Record<string, string>,
  now: number = Date.now(),
): Promise<Response> {
  if (!auth) {
    return textResponse("Unauthorized.", 401, cors);
  }

  // R2 not yet enabled on the account -> fail soft. The client drops on any non-2xx, so this never
  // affects gameplay; it just means nothing is stored until the bucket is created + bound.
  if (!env.TELEMETRY) {
    return textResponse("Telemetry storage is not enabled.", 503, cors);
  }

  if (!checkRateLimit(auth.uid, now)) {
    return textResponse("Rate limit exceeded.", 429, cors);
  }

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength === 0) {
    return textResponse("Empty telemetry body.", 400, cors);
  }
  if (body.byteLength > TELEMETRY_MAX_BYTES) {
    return textResponse("Telemetry batch too large.", 413, cors);
  }

  const url = new URL(request.url);
  const q = url.searchParams;
  const key = telemetryObjectKey({
    date: telemetryDateSegment(now),
    mode: q.get("mode"),
    sessionId: q.get("sessionId"),
    seq: q.get("seq"),
  });

  // Body encoding: "gz" (real gzip, the default) or "lz" (lz-string base64 fallback the client used when
  // CompressionStream was unavailable). Stored in metadata so the offline ML pipeline decodes correctly.
  const enc = q.get("enc") === "lz" ? "lz" : "gz";

  // Object metadata: the pseudonymous client hash + build + schema version only. NEVER the raw username.
  const customMetadata: Record<string, string> = {
    userIdHash: sanitizeSegment(q.get("uidHash"), "anon"),
    build: sanitizeSegment(q.get("build"), "unknown"),
    schemaVersion: sanitizeSegment(q.get("schemaVersion"), "0"),
    enc,
    uploadedAt: String(now),
  };

  try {
    await env.TELEMETRY.put(key, body, {
      httpMetadata:
        enc === "gz" ? { contentType: "application/gzip", contentEncoding: "gzip" } : { contentType: "text/plain" },
      customMetadata,
    });
  } catch (err) {
    console.error("er-save-api telemetry ingest write failed:", err);
    return textResponse("Telemetry write failed.", 500, cors);
  }

  return jsonResponse({ ok: true, key }, 200, cors);
}
