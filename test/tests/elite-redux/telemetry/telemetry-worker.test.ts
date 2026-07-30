/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Engine-free unit tests for the er-save-api telemetry ingest route (#player-telemetry). These import
// ONLY the worker's pure telemetry module (no co-op engine, no GameManager, no globalScene), so they run
// in the plain vitest env. Covers: auth reject, R2-unbound fail-soft, size cap, per-user rate limit, the
// R2 object-key format + path-traversal safety, and the privacy guarantee (no raw username in metadata).

import { beforeEach, describe, expect, it } from "vitest";
import {
  checkRateLimit,
  handleTelemetryIngest,
  resetTelemetryRateLimit,
  sanitizeSegment,
  TELEMETRY_MAX_BYTES,
  TELEMETRY_RATE_MAX,
  type TelemetryR2Bucket,
  telemetryObjectKey,
} from "../../../../workers/er-save-api/src/telemetry";

interface PutCall {
  key: string;
  value: ArrayBuffer | Uint8Array | string;
  options?: { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> } | undefined;
}

/** A mock R2 bucket that records every put. */
function makeBucket(): { bucket: TelemetryR2Bucket; puts: PutCall[] } {
  const puts: PutCall[] = [];
  const bucket: TelemetryR2Bucket = {
    put(key, value, options) {
      puts.push({ key, value, options });
      return Promise.resolve({ key });
    },
  };
  return { bucket, puts };
}

const CORS = { "Access-Control-Allow-Origin": "*" };
const AUTH = { uid: 42, u: "SomePlayer" };

function ingestRequest(query: Record<string, string>, body: BodyInit): Request {
  const qs = new URLSearchParams(query).toString();
  return new Request(`https://er-save-api.test/telemetry/ingest?${qs}`, { method: "POST", body });
}

describe("telemetry ingest route (worker)", () => {
  beforeEach(() => {
    resetTelemetryRateLimit();
  });

  it("rejects an unauthenticated request with 401 (auth reject)", async () => {
    const { bucket, puts } = makeBucket();
    const res = await handleTelemetryIngest(
      ingestRequest({ mode: "solo", sessionId: "s1", seq: "0" }, "gz-bytes"),
      null,
      { TELEMETRY: bucket },
      CORS,
    );
    expect(res.status).toBe(401);
    expect(puts).toHaveLength(0);
  });

  it("fails soft with 503 when the R2 binding is not yet bound", async () => {
    const res = await handleTelemetryIngest(
      ingestRequest({ mode: "solo", sessionId: "s1", seq: "0" }, "gz-bytes"),
      AUTH,
      {}, // no TELEMETRY binding
      CORS,
    );
    expect(res.status).toBe(503);
  });

  it("rejects an oversize batch with 413 (size cap)", async () => {
    const { bucket, puts } = makeBucket();
    const tooBig = new Uint8Array(TELEMETRY_MAX_BYTES + 1);
    const res = await handleTelemetryIngest(
      ingestRequest({ mode: "solo", sessionId: "s1", seq: "0" }, tooBig),
      AUTH,
      { TELEMETRY: bucket },
      CORS,
    );
    expect(res.status).toBe(413);
    expect(puts).toHaveLength(0);
  });

  it("rejects an empty body with 400", async () => {
    const { bucket } = makeBucket();
    const res = await handleTelemetryIngest(
      ingestRequest({ mode: "solo", sessionId: "s1", seq: "0" }, new Uint8Array(0)),
      AUTH,
      { TELEMETRY: bucket },
      CORS,
    );
    expect(res.status).toBe(400);
  });

  it("writes the compressed body verbatim under the dated key with pseudonymous metadata (happy path)", async () => {
    const { bucket, puts } = makeBucket();
    const body = new Uint8Array([0x1f, 0x8b, 0x08, 0x00]); // gzip magic-ish; opaque to the worker
    const now = Date.UTC(2026, 6, 14, 10, 30, 0); // 2026-07-14
    const res = await handleTelemetryIngest(
      ingestRequest(
        { mode: "coop", sessionId: "sess-ABC", seq: "7", build: "0.0.5.6", schemaVersion: "1", uidHash: "deadbeef" },
        body,
      ),
      AUTH,
      { TELEMETRY: bucket },
      CORS,
      now,
    );
    expect(res.status).toBe(200);
    expect(puts).toHaveLength(1);
    const put = puts[0];
    expect(put.key).toBe("2026-07-14/coop/sess-ABC/7.jsonl.gz");
    // Body stored verbatim (byte-identical).
    expect(new Uint8Array(put.value as Uint8Array)).toEqual(body);
    // Metadata carries the pseudonymous hash + build + schema, and NEVER the raw username.
    expect(put.options?.customMetadata?.userIdHash).toBe("deadbeef");
    expect(put.options?.customMetadata?.build).toBe("0.0.5.6");
    expect(put.options?.customMetadata?.schemaVersion).toBe("1");
    const metaBlob = JSON.stringify(put.options);
    expect(metaBlob).not.toContain("SomePlayer");
    expect(put.options?.httpMetadata?.contentEncoding).toBe("gzip");
  });

  it("enforces a per-user rate limit (429 once the window budget is spent)", async () => {
    const { bucket } = makeBucket();
    const now = Date.now();
    let last = 200;
    for (let i = 0; i < TELEMETRY_RATE_MAX; i++) {
      const res = await handleTelemetryIngest(
        ingestRequest({ mode: "solo", sessionId: "s1", seq: String(i) }, "gz"),
        AUTH,
        { TELEMETRY: bucket },
        CORS,
        now,
      );
      last = res.status;
    }
    expect(last).toBe(200);
    const over = await handleTelemetryIngest(
      ingestRequest({ mode: "solo", sessionId: "s1", seq: "over" }, "gz"),
      AUTH,
      { TELEMETRY: bucket },
      CORS,
      now,
    );
    expect(over.status).toBe(429);
  });
});

describe("telemetry object-key format + sanitization", () => {
  it("builds {date}/{mode}/{sessionId}/{seq}.jsonl.gz", () => {
    expect(telemetryObjectKey({ date: "2026-07-14", mode: "solo", sessionId: "abc", seq: "3" })).toBe(
      "2026-07-14/solo/abc/3.jsonl.gz",
    );
  });

  it("neutralizes path traversal + illegal characters in every segment", () => {
    const key = telemetryObjectKey({ date: "2026-07-14", mode: "../../etc", sessionId: "a/b\\c", seq: "9;rm" });
    expect(key).toBe("2026-07-14/....etc/abc/9rm.jsonl.gz");
    expect(key).not.toContain("../");
    expect(key.split("/")).toHaveLength(4);
  });

  it("falls back to a safe default when a segment is empty or all-illegal", () => {
    expect(sanitizeSegment("", "unknown")).toBe("unknown");
    expect(sanitizeSegment("/////", "nosession")).toBe("nosession");
    expect(sanitizeSegment("ok_value-1.2", "x")).toBe("ok_value-1.2");
  });
});

describe("telemetry rate-limit unit", () => {
  it("allows up to max within a window, then blocks until the window resets", () => {
    const buckets = new Map();
    const now = 1000;
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(1, now, 3, 1000, buckets)).toBe(true);
    }
    expect(checkRateLimit(1, now, 3, 1000, buckets)).toBe(false);
    // A different user has an independent budget.
    expect(checkRateLimit(2, now, 3, 1000, buckets)).toBe(true);
    // After the window elapses, user 1 is allowed again.
    expect(checkRateLimit(1, now + 1000, 3, 1000, buckets)).toBe(true);
  });
});
