/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TELEMETRY TRANSPORT (#player-telemetry). Compress a batch + ship it to the worker's /telemetry/ingest.
//
// Compression: gzip via `CompressionStream` when available (matches the `.jsonl.gz` R2 key), else
// lz-string `compressToBase64` as a fallback (marked `enc=lz` so the ML pipeline decodes correctly). The
// worker stores the body verbatim + the encoding in object metadata.
//
// Auth: the SAME session token the savedata endpoints use. A normal `fetch` flush sends it in the
// `Authorization` header; a `navigator.sendBeacon` flush (fired on pagehide, cannot set headers) rides it
// in the `?t=` query param instead. NEVER throws / blocks: any failure is swallowed so telemetry can never
// affect gameplay.
// =============================================================================

import type { TelemetryBatch, TelemetrySessionEnvelope } from "#data/elite-redux/telemetry/telemetry-schema";
import { compressToBase64 } from "lz-string";

/** Compressed batch ready to POST. `body` is a `BlobPart`/`BodyInit` (ArrayBuffer for gzip, string for lz). */
export interface EncodedBatch {
  body: ArrayBuffer | string;
  /** "gz" (real gzip) or "lz" (lz-string base64 fallback). */
  enc: "gz" | "lz";
}

/** Gzip a UTF-8 string to an ArrayBuffer via CompressionStream, or null when unavailable. */
async function gzip(json: string): Promise<ArrayBuffer | null> {
  if (typeof CompressionStream === "undefined") {
    return null;
  }
  try {
    // Blob([string]).stream() sidesteps the TextEncoder/typed-array typing friction entirely.
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
    return await new Response(stream).arrayBuffer();
  } catch {
    return null;
  }
}

/** Serialize + compress a batch. gzip when possible, else lz-string. Returns null only if both fail. */
export async function encodeBatch(batch: TelemetryBatch): Promise<EncodedBatch | null> {
  try {
    const json = JSON.stringify(batch);
    const gz = await gzip(json);
    if (gz) {
      return { body: gz, enc: "gz" };
    }
    return { body: compressToBase64(json), enc: "lz" };
  } catch {
    return null;
  }
}

/**
 * Build the ingest URL with the batch metadata as query params (pure - unit-tested). `token` is appended
 * as `?t=` ONLY for the beacon path (which cannot set an Authorization header); the fetch path passes it
 * as a header instead and omits it here.
 */
export function buildIngestUrl(
  base: string,
  envelope: TelemetrySessionEnvelope,
  seq: number,
  enc: "gz" | "lz",
  token?: string,
): string {
  const params = new URLSearchParams({
    mode: envelope.mode,
    sessionId: envelope.sessionId,
    seq: String(seq),
    build: envelope.build,
    schemaVersion: String(envelope.schemaVersion),
    uidHash: envelope.playerIdHash,
    enc,
  });
  if (token) {
    params.set("t", token);
  }
  return `${base.replace(/\/$/, "")}/telemetry/ingest?${params.toString()}`;
}

/**
 * Ship one batch. `useBeacon` (session-end / pagehide) uses `navigator.sendBeacon` with the token in the
 * URL; otherwise a keepalive `fetch` with the Authorization header. Returns whether the send was accepted
 * (beacon queued / fetch 2xx). NEVER throws.
 */
export async function sendTelemetryBatch(
  base: string,
  batch: TelemetryBatch,
  token: string,
  useBeacon: boolean,
): Promise<boolean> {
  try {
    const encoded = await encodeBatch(batch);
    if (!encoded) {
      return false;
    }
    if (useBeacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const url = buildIngestUrl(base, batch.envelope, batch.seq, encoded.enc, token);
      const blob = new Blob([encoded.body], {
        type: encoded.enc === "gz" ? "application/gzip" : "text/plain",
      });
      return navigator.sendBeacon(url, blob);
    }
    if (typeof fetch !== "function") {
      return false;
    }
    const url = buildIngestUrl(base, batch.envelope, batch.seq, encoded.enc);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": encoded.enc === "gz" ? "application/gzip" : "text/plain",
      },
      body: encoded.body,
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}
