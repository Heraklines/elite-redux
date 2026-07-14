/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Showdown battle TELEMETRY worker (Task D5). A dedicated Cloudflare
// Worker + D1 database (`er-telemetry`), separate from er-saves (which is under DB-cap
// pressure). Records one row per showdown match for balance analytics.
//
// AUTH: reuses er-save-api's EXACT HMAC token scheme — set the SAME `SESSION_SECRET`
// secret (`wrangler secret put SESSION_SECRET`) so the client's existing session token
// verifies here too. No new login. The pure ingest validation is in ./telemetry-ingest.ts.
//
// Ingest: POST /telemetry/battle (authed, 64KB body cap, per-uid rate limit). The client
// posts plain JSON; the worker gzips the full payload into the `trace_gz` blob and stores
// the denormalized columns + summary for direct SQL.
// =============================================================================

import { TELEMETRY_MAX_BODY, type TelemetryRow, validateTelemetryPayload } from "./telemetry-ingest";
import { handleTournamentRoute } from "./tournament-routes";

interface Env {
  DB: D1Database;
  /** SAME value as er-save-api's SESSION_SECRET (shared HMAC token scheme). */
  SESSION_SECRET: string;
  /** Optional origin allowlist; "*"/unset = allow all. */
  ALLOWED_ORIGIN?: string;
  /** Comma-separated numeric admin account uids allowed to run tournament admin routes. */
  TOURNAMENT_ADMIN_UIDS?: string;
}

interface TokenPayload {
  uid: number;
  u: string;
  iat: number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

// #region auth (mirror of er-save-api's token verify — the shared HMAC scheme)

function fromBase64Url(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64url.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function hmacSha256(data: Uint8Array, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
}

async function verifyToken(token: string, secret: string): Promise<TokenPayload | null> {
  const dot = token.indexOf(".");
  if (dot <= 0) {
    return null;
  }
  const body = token.slice(0, dot);
  let providedSig: Uint8Array;
  try {
    providedSig = fromBase64Url(token.slice(dot + 1));
  } catch {
    return null;
  }
  const expectedSig = await hmacSha256(enc.encode(body), secret);
  if (!timingSafeEqual(providedSig, expectedSig)) {
    return null;
  }
  try {
    const payload = JSON.parse(dec.decode(fromBase64Url(body))) as TokenPayload;
    if (typeof payload?.uid === "number" && typeof payload?.u === "string") {
      return payload;
    }
  } catch {
    /* fallthrough */
  }
  return null;
}

async function authUser(request: Request, env: Env): Promise<TokenPayload | null> {
  const header = request.headers.get("Authorization");
  if (!header) {
    return null;
  }
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  return token ? verifyToken(token, env.SESSION_SECRET) : null;
}

// #endregion
// #region http helpers

function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  const allow = env.ALLOWED_ORIGIN;
  const value = !allow || allow === "*" ? "*" : allow.split(",").includes(origin ?? "") ? (origin ?? "*") : "null";
  return {
    "Access-Control-Allow-Origin": value,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function text(body: string, status: number, cors: Record<string, string>): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain", ...cors } });
}
function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
}

// #endregion
// #region storage

let tablesReady = false;
async function ensureTables(env: Env): Promise<void> {
  if (tablesReady) {
    return;
  }
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS showdown_battles (
       id           INTEGER PRIMARY KEY AUTOINCREMENT,
       match_id     TEXT,
       host_uid     TEXT    NOT NULL,
       guest_uid    TEXT    NOT NULL,
       winner       TEXT,
       reason       TEXT    NOT NULL,
       turns        INTEGER NOT NULL,
       duration_ms  INTEGER NOT NULL,
       created_at   INTEGER NOT NULL,
       trace_gz     BLOB,
       summary_json TEXT    NOT NULL
     )`,
  ).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_sb_created ON showdown_battles (created_at)").run();
  tablesReady = true;
}

/** gzip a string to bytes (deadlock-safe: begin the read before writing). */
async function gzip(plain: string): Promise<Uint8Array> {
  const cs = new CompressionStream("gzip");
  const read = new Response(cs.readable).arrayBuffer();
  const writer = cs.writable.getWriter();
  await writer.write(enc.encode(plain));
  await writer.close();
  return new Uint8Array(await read);
}

async function insertRow(env: Env, row: TelemetryRow): Promise<void> {
  let traceGz: Uint8Array | null = null;
  try {
    traceGz = await gzip(row.traceJson);
  } catch (err) {
    console.error("telemetry gzip failed, storing null trace:", err);
  }
  await env.DB.prepare(
    `INSERT INTO showdown_battles
       (match_id, host_uid, guest_uid, winner, reason, turns, duration_ms, created_at, trace_gz, summary_json)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
  )
    .bind(
      row.matchId,
      row.hostUid,
      row.guestUid,
      row.winner,
      row.reason,
      row.turns,
      row.durationMs,
      row.createdAt,
      traceGz,
      row.summaryJson,
    )
    .run();
}

// #endregion
// #region rate limit

const rate = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60;
function rateLimited(uid: string, now: number): boolean {
  const slot = rate.get(uid);
  if (!slot || now >= slot.resetAt) {
    rate.set(uid, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  slot.count++;
  return slot.count > RATE_MAX;
}

// #endregion

async function handleBattle(request: Request, auth: TokenPayload, env: Env, cors: Record<string, string>) {
  if (rateLimited(auth.u, Date.now())) {
    return text("Too many requests.", 429, cors);
  }
  const raw = await request.text();
  if (raw.length > TELEMETRY_MAX_BODY) {
    return json({ error: "payload too large" }, 413, cors);
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "invalid json" }, 400, cors);
  }
  const result = validateTelemetryPayload(body, auth.u);
  if (!result.ok) {
    return json({ error: result.error }, 422, cors);
  }
  await ensureTables(env);
  await insertRow(env, result.row);
  return json({ ok: true }, 200, cors);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(env, request.headers.get("Origin"));
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    try {
      if (url.pathname === "/telemetry/battle" && request.method === "POST") {
        const auth = await authUser(request, env);
        if (!auth) {
          return text("Unauthorized.", 401, cors);
        }
        return await handleBattle(request, auth, env, cors);
      }
      // Showdown Tournament (P1): /tournament/* routes. Auth is verified here (the
      // route module gates admin actions by the token uid allowlist + attestation).
      if (url.pathname.startsWith("/tournament/")) {
        const auth = await authUser(request, env);
        const caller = auth ? { uid: auth.uid, u: auth.u } : null;
        const res = await handleTournamentRoute(url, request, caller, env, cors);
        if (res) {
          return res;
        }
      }
      return text("Not found.", 404, cors);
    } catch (err) {
      console.error("er-telemetry error:", err);
      return text("Internal server error.", 500, cors);
    }
  },
};
