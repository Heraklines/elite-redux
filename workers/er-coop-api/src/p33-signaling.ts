/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  type CoopIdentityTicketV1,
  type CoopPairingCredentialV1,
  deriveCoopPairingCredential,
  hashCoopPairingBearer,
  isCoopClientNonce,
  verifyCoopIdentityTicket,
} from "./p33-auth";

// Minimal structural stand-in for the Cloudflare Workers D1 binding types
// (@cloudflare/workers-types is not a dependency of this repo). Only the surface the
// signaling worker actually calls is modeled; the runtime binding is the real D1.
interface D1Meta {
  changes?: number;
  last_row_id?: number | bigint;
}
interface D1Result<T = Record<string, unknown>> {
  success?: boolean;
  results: T[];
  meta: D1Meta;
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

export interface P33SignalingEnv {
  DB: D1Database;
  COOP_IDENTITY_SECRET?: string;
  ALLOWED_ORIGIN?: string;
  PRESENCE_WINDOW_MS?: string;
  P33_REJOIN_GRACE_MS?: string;
}

type P33TransportRole = "offerer" | "answerer";

interface P33LobbyRow {
  presence_id: string;
  account_id: string;
  display_name: string;
  canonical_username: string;
  ticket_nonce: string;
  client_nonce: string;
  bearer_hash: string;
  seen_at: number;
  paired_code: string | null;
  transport_role: P33TransportRole | null;
  created_at: number;
  req_from: string | null;
  req_at: number | null;
  declined_name: string | null;
}

interface P33RunRow {
  code: string;
  offerer_presence_id: string;
  answerer_presence_id: string;
  offerer_account_id: string;
  answerer_account_id: string;
  offerer_display_name: string;
  answerer_display_name: string;
  offerer_canonical_username: string;
  answerer_canonical_username: string;
  offerer_bearer_hash: string;
  answerer_bearer_hash: string;
  offerer_generation: number;
  answerer_generation: number;
  offerer_seen_at: number;
  answerer_seen_at: number;
  state: "active" | "grace" | "ended";
  created_at: number;
  updated_at: number;
}

interface P33AuthenticatedRun {
  row: P33RunRow;
  role: P33TransportRole;
  bearerHash: string;
}

interface P33TicketCredential {
  payload: CoopIdentityTicketV1;
  clientNonce: string;
  credential: CoopPairingCredentialV1;
}

const DEFAULT_PRESENCE_WINDOW_MS = 30_000;
const DEFAULT_REJOIN_GRACE_MS = 2 * 60_000;
const LOBBY_PRESENCE_MS = 12_000;
const MAX_JSON_BYTES = 1_100_000;
const MAX_SIGNAL_BYTES = 1_000_000;
const PAIRING_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const PAIRING_CODE_LENGTH = 6;

function corsHeaders(env: P33SignalingEnv): Record<string, string> {
  const origin = env.ALLOWED_ORIGIN && env.ALLOWED_ORIGIN !== "*" ? env.ALLOWED_ORIGIN : "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function json(env: P33SignalingEnv, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) },
  });
}

function error(env: P33SignalingEnv, message: string, status = 400): Response {
  return json(env, { error: message }, status);
}

function presenceWindow(env: P33SignalingEnv): number {
  const configured = Number(env.PRESENCE_WINDOW_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_PRESENCE_WINDOW_MS;
}

function rejoinGrace(env: P33SignalingEnv): number {
  const configured = Number(env.P33_REJOIN_GRACE_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_REJOIN_GRACE_MS;
}

function newPairingCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(PAIRING_CODE_LENGTH));
  return [...bytes].map(byte => PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length]).join("");
}

function safeIdentifier(value: unknown, maxLength = 256): value is string {
  return (
    typeof value === "string"
    && value.length > 0
    && value.length <= maxLength
    && ![...value].some(character => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  );
}

function sameString(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const raw = await request.text();
  if (raw.length === 0 || new TextEncoder().encode(raw).length > MAX_JSON_BYTES) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed != null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") && header.length > 7 ? header.slice(7) : null;
}

export async function ensureP33SignalingSchema(env: P33SignalingEnv): Promise<void> {
  // Real Cloudflare D1 `exec()` splits its input on NEWLINES and rejects a statement that spans multiple
  // lines, so a pretty-printed multi-statement DDL template throws at schema-ensure and 500s EVERY
  // /coop/v3/* request before auth ever runs (miniflare tolerates it, so no vitest catches it - this was
  // the live lobby-pairing blocker). Run each DDL statement as its OWN prepared statement instead: a
  // single multi-line CREATE is fine through prepare(); the batch is one round-trip and atomic, and
  // CREATE ... IF NOT EXISTS keeps it idempotent (same as pruneP33Signaling's own DELETE batch below).
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS coop_ticket_bindings_p33 (
      ticket_nonce TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      client_nonce TEXT NOT NULL,
      presence_id TEXT NOT NULL UNIQUE,
      bearer_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS coop_lobby_p33 (
      presence_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      canonical_username TEXT NOT NULL,
      ticket_nonce TEXT NOT NULL UNIQUE,
      client_nonce TEXT NOT NULL,
      bearer_hash TEXT NOT NULL,
      seen_at INTEGER NOT NULL,
      paired_code TEXT,
      transport_role TEXT,
      created_at INTEGER NOT NULL,
      req_from TEXT,
      req_at INTEGER,
      declined_name TEXT
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_coop_lobby_p33_seen ON coop_lobby_p33(seen_at)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS coop_runs_p33 (
      code TEXT PRIMARY KEY,
      offerer_presence_id TEXT NOT NULL,
      answerer_presence_id TEXT NOT NULL,
      offerer_account_id TEXT NOT NULL,
      answerer_account_id TEXT NOT NULL,
      offerer_display_name TEXT NOT NULL,
      answerer_display_name TEXT NOT NULL,
      offerer_canonical_username TEXT NOT NULL,
      answerer_canonical_username TEXT NOT NULL,
      offerer_bearer_hash TEXT NOT NULL,
      answerer_bearer_hash TEXT NOT NULL,
      offerer_generation INTEGER NOT NULL DEFAULT 0,
      answerer_generation INTEGER NOT NULL DEFAULT 0,
      offerer_seen_at INTEGER NOT NULL,
      answerer_seen_at INTEGER NOT NULL,
      state TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_coop_runs_p33_updated ON coop_runs_p33(updated_at)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS coop_pair_members_p33 (
      presence_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL,
      transport_role TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS coop_signals_p33 (
      code TEXT NOT NULL,
      from_role TEXT NOT NULL,
      signal TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (code, from_role)
    )`),
  ]);
}

/** Hourly cleanup for credentials, abandoned lobby entries, signals, and expired P33 runs. */
export async function pruneP33Signaling(env: P33SignalingEnv, now: number, runTtlMs: number): Promise<void> {
  await ensureP33SignalingSchema(env);
  const staleGrace = now - rejoinGrace(env);
  const staleRun = now - runTtlMs;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM coop_ticket_bindings_p33 WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM coop_lobby_p33 WHERE seen_at < ?").bind(now - 5 * 60_000),
    env.DB.prepare("DELETE FROM coop_signals_p33 WHERE updated_at < ?").bind(now - 5 * 60_000),
    env.DB.prepare(
      `DELETE FROM coop_pair_members_p33 WHERE code IN (
           SELECT code FROM coop_runs_p33
           WHERE updated_at < ? OR (state = 'grace' AND updated_at < ?)
         )`,
    ).bind(staleRun, staleGrace),
    env.DB.prepare(
      `DELETE FROM coop_lobby_p33 WHERE paired_code IN (
           SELECT code FROM coop_runs_p33
           WHERE updated_at < ? OR (state = 'grace' AND updated_at < ?)
         )`,
    ).bind(staleRun, staleGrace),
    env.DB.prepare(
      `DELETE FROM coop_signals_p33 WHERE code IN (
           SELECT code FROM coop_runs_p33
           WHERE updated_at < ? OR (state = 'grace' AND updated_at < ?)
         )`,
    ).bind(staleRun, staleGrace),
    env.DB.prepare("DELETE FROM coop_runs_p33 WHERE updated_at < ? OR (state = 'grace' AND updated_at < ?)").bind(
      staleRun,
      staleGrace,
    ),
    env.DB.prepare("DELETE FROM coop_pair_members_p33 WHERE code NOT IN (SELECT code FROM coop_runs_p33)"),
  ]);
}

async function releaseExpiredGrace(env: P33SignalingEnv, now: number): Promise<void> {
  const cutoff = now - rejoinGrace(env);
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM coop_pair_members_p33 WHERE code IN (SELECT code FROM coop_runs_p33 WHERE state = 'grace' AND updated_at < ?)",
    ).bind(cutoff),
    env.DB.prepare(
      "DELETE FROM coop_lobby_p33 WHERE paired_code IN (SELECT code FROM coop_runs_p33 WHERE state = 'grace' AND updated_at < ?)",
    ).bind(cutoff),
    env.DB.prepare(
      "DELETE FROM coop_signals_p33 WHERE code IN (SELECT code FROM coop_runs_p33 WHERE state = 'grace' AND updated_at < ?)",
    ).bind(cutoff),
    env.DB.prepare("DELETE FROM coop_runs_p33 WHERE state = 'grace' AND updated_at < ?").bind(cutoff),
  ]);
}

async function bindTicket(
  env: P33SignalingEnv,
  payload: CoopIdentityTicketV1,
  clientNonce: string,
  credential: CoopPairingCredentialV1,
  now: number,
): Promise<boolean> {
  await env.DB.prepare(
    `INSERT INTO coop_ticket_bindings_p33
      (ticket_nonce, account_id, client_nonce, presence_id, bearer_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(ticket_nonce) DO NOTHING`,
  )
    .bind(payload.nonce, payload.sub, clientNonce, credential.presenceId, credential.bearerHash, payload.exp, now)
    .run();
  const bound = await env.DB.prepare(
    `SELECT account_id, client_nonce, presence_id, bearer_hash
     FROM coop_ticket_bindings_p33 WHERE ticket_nonce = ?`,
  )
    .bind(payload.nonce)
    .first<{ account_id: string; client_nonce: string; presence_id: string; bearer_hash: string }>();
  return (
    bound != null
    && sameString(bound.account_id, payload.sub)
    && sameString(bound.client_nonce, clientNonce)
    && sameString(bound.presence_id, credential.presenceId)
    && sameString(bound.bearer_hash, credential.bearerHash)
  );
}

async function ticketCredential(
  env: P33SignalingEnv,
  body: Record<string, unknown>,
  now: number,
): Promise<P33TicketCredential | null> {
  const secret = env.COOP_IDENTITY_SECRET;
  if (typeof secret !== "string" || secret.length < 32 || typeof body.ticket !== "string") {
    return null;
  }
  const payload = await verifyCoopIdentityTicket(body.ticket, secret, now);
  if (payload == null || !isCoopClientNonce(body.clientNonce)) {
    return null;
  }
  const credential = await deriveCoopPairingCredential(payload, body.clientNonce, secret);
  if (credential == null || !(await bindTicket(env, payload, body.clientNonce, credential, now))) {
    return null;
  }
  return { payload, clientNonce: body.clientNonce, credential };
}

async function authenticateLobby(
  request: Request,
  env: P33SignalingEnv,
  presenceId: string,
): Promise<P33LobbyRow | null> {
  const token = bearer(request);
  const tokenHash = token == null ? null : await hashCoopPairingBearer(token);
  if (tokenHash == null) {
    return null;
  }
  const row = await env.DB.prepare("SELECT * FROM coop_lobby_p33 WHERE presence_id = ?")
    .bind(presenceId)
    .first<P33LobbyRow>();
  return row != null && sameString(row.bearer_hash, tokenHash) ? row : null;
}

async function authenticateRun(
  request: Request,
  env: P33SignalingEnv,
  code: string,
): Promise<P33AuthenticatedRun | null> {
  const token = bearer(request);
  const tokenHash = token == null ? null : await hashCoopPairingBearer(token);
  if (tokenHash == null) {
    return null;
  }
  const row = await env.DB.prepare("SELECT * FROM coop_runs_p33 WHERE code = ?").bind(code).first<P33RunRow>();
  if (row == null) {
    return null;
  }
  if (sameString(row.offerer_bearer_hash, tokenHash)) {
    return { row, role: "offerer", bearerHash: tokenHash };
  }
  return sameString(row.answerer_bearer_hash, tokenHash) ? { row, role: "answerer", bearerHash: tokenHash } : null;
}

function bearerColumn(role: P33TransportRole): "offerer_bearer_hash" | "answerer_bearer_hash" {
  return role === "offerer" ? "offerer_bearer_hash" : "answerer_bearer_hash";
}

function pairingFor(row: P33RunRow, role: P33TransportRole) {
  const offerer = role === "offerer";
  return {
    code: row.code,
    pairingId: row.code,
    transportRole: role,
    connectionGeneration: offerer ? row.offerer_generation : row.answerer_generation,
    account: {
      accountId: offerer ? row.offerer_account_id : row.answerer_account_id,
      displayName: offerer ? row.offerer_display_name : row.answerer_display_name,
      canonicalUsername: offerer ? row.offerer_canonical_username : row.answerer_canonical_username,
    },
    peer: {
      accountId: offerer ? row.answerer_account_id : row.offerer_account_id,
      displayName: offerer ? row.answerer_display_name : row.offerer_display_name,
      canonicalUsername: offerer ? row.answerer_canonical_username : row.offerer_canonical_username,
      connectionGeneration: offerer ? row.answerer_generation : row.offerer_generation,
    },
  };
}

async function pairingForPresence(env: P33SignalingEnv, row: P33LobbyRow): Promise<unknown | null> {
  if (row.paired_code == null || row.transport_role == null) {
    return null;
  }
  const run = await env.DB.prepare("SELECT * FROM coop_runs_p33 WHERE code = ?")
    .bind(row.paired_code)
    .first<P33RunRow>();
  return run == null ? null : pairingFor(run, row.transport_role);
}

async function handleAnnounce(request: Request, env: P33SignalingEnv, now: number): Promise<Response> {
  const body = await readBody(request);
  if (body == null) {
    return error(env, "invalid announce body");
  }
  const identity = await ticketCredential(env, body, now);
  if (identity == null) {
    return error(env, "invalid or already rebound co-op identity ticket", 401);
  }
  await releaseExpiredGrace(env, now);
  const { payload, clientNonce, credential } = identity;
  await env.DB.prepare(
    `DELETE FROM coop_lobby_p33
     WHERE account_id = ? AND presence_id <> ? AND paired_code IS NULL AND seen_at < ?`,
  )
    .bind(payload.sub, credential.presenceId, now - LOBBY_PRESENCE_MS)
    .run();
  try {
    await env.DB.prepare(
      `INSERT INTO coop_lobby_p33
        (presence_id, account_id, display_name, canonical_username, ticket_nonce, client_nonce,
         bearer_hash, seen_at, paired_code, transport_role, created_at, req_from, req_at, declined_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, NULL)
       ON CONFLICT(presence_id) DO UPDATE SET
         display_name = excluded.display_name,
         canonical_username = excluded.canonical_username,
         seen_at = excluded.seen_at
       WHERE account_id = excluded.account_id
         AND ticket_nonce = excluded.ticket_nonce
         AND client_nonce = excluded.client_nonce
         AND bearer_hash = excluded.bearer_hash`,
    )
      .bind(
        credential.presenceId,
        payload.sub,
        payload.displayName,
        payload.canonicalUsername,
        payload.nonce,
        clientNonce,
        credential.bearerHash,
        now,
        now,
      )
      .run();
  } catch {
    return error(env, "this account already has an active co-op presence", 409);
  }
  const row = await env.DB.prepare("SELECT * FROM coop_lobby_p33 WHERE presence_id = ?")
    .bind(credential.presenceId)
    .first<P33LobbyRow>();
  if (
    row == null
    || !sameString(row.account_id, payload.sub)
    || !sameString(row.client_nonce, clientNonce)
    || !sameString(row.bearer_hash, credential.bearerHash)
  ) {
    return error(env, "identity binding conflict", 409);
  }
  return json(env, {
    presenceId: row.presence_id,
    pairingToken: credential.bearer,
    identity: {
      version: 1,
      accountId: row.account_id,
      displayName: row.display_name,
      canonicalUsername: row.canonical_username,
    },
    pairing: await pairingForPresence(env, row),
  });
}

async function handleLobbyList(request: Request, env: P33SignalingEnv, url: URL, now: number): Promise<Response> {
  const self = url.searchParams.get("self") ?? "";
  const row = safeIdentifier(self) ? await authenticateLobby(request, env, self) : null;
  if (row == null) {
    return error(env, "invalid lobby credential", 401);
  }
  const heartbeat = await env.DB.prepare(
    "UPDATE coop_lobby_p33 SET seen_at = ? WHERE presence_id = ? AND bearer_hash = ?",
  )
    .bind(now, self, row.bearer_hash)
    .run();
  if ((heartbeat.meta.changes ?? 0) !== 1) {
    return error(env, "stale lobby credential", 409);
  }
  const { results = [] } = await env.DB.prepare(
    `SELECT presence_id, account_id, display_name, seen_at
     FROM coop_lobby_p33
     WHERE presence_id <> ? AND paired_code IS NULL AND seen_at >= ?
     ORDER BY created_at ASC LIMIT 50`,
  )
    .bind(self, now - LOBBY_PRESENCE_MS)
    .all<{ presence_id: string; account_id: string; display_name: string; seen_at: number }>();
  let incoming: { id: string; accountId: string; name: string } | null = null;
  if (row.req_from != null && row.req_at != null && now - row.req_at <= LOBBY_PRESENCE_MS) {
    const requester = await env.DB.prepare(
      `SELECT presence_id, account_id, display_name FROM coop_lobby_p33
       WHERE presence_id = ? AND paired_code IS NULL AND seen_at >= ?`,
    )
      .bind(row.req_from, now - LOBBY_PRESENCE_MS)
      .first<{ presence_id: string; account_id: string; display_name: string }>();
    if (requester != null) {
      incoming = { id: requester.presence_id, accountId: requester.account_id, name: requester.display_name };
    }
  }
  const declined = row.declined_name;
  if (declined != null) {
    await env.DB.prepare("UPDATE coop_lobby_p33 SET declined_name = NULL WHERE presence_id = ? AND declined_name = ?")
      .bind(self, declined)
      .run();
  }
  const freshRow = { ...row, seen_at: now };
  return json(env, {
    players: results.map(player => ({
      id: player.presence_id,
      accountId: player.account_id,
      name: player.display_name,
      age: Math.max(0, now - player.seen_at),
    })),
    pairing: await pairingForPresence(env, freshRow),
    request: incoming,
    declined,
  });
}

async function handleLobbyRequest(request: Request, env: P33SignalingEnv, now: number): Promise<Response> {
  const body = await readBody(request);
  const self = body?.self;
  const target = body?.target;
  if (!safeIdentifier(self) || !safeIdentifier(target) || self === target) {
    return error(env, "invalid lobby request");
  }
  const requester = await authenticateLobby(request, env, self);
  if (requester == null || requester.paired_code != null) {
    return error(env, "invalid lobby credential", 401);
  }
  const result = await env.DB.prepare(
    `UPDATE coop_lobby_p33 SET req_from = ?, req_at = ?
     WHERE presence_id = ? AND paired_code IS NULL AND seen_at >= ?
       AND (req_from IS NULL OR req_from = ?)
       AND EXISTS (
         SELECT 1 FROM coop_lobby_p33 AS requester
         WHERE requester.presence_id = ? AND requester.bearer_hash = ?
           AND requester.paired_code IS NULL
       )`,
  )
    .bind(self, now, target, now - LOBBY_PRESENCE_MS, self, self, requester.bearer_hash)
    .run();
  return (result.meta.changes ?? 0) === 1 ? json(env, { ok: true }) : error(env, "player unavailable", 409);
}

async function createPairing(
  env: P33SignalingEnv,
  offererId: string,
  answererId: string,
  now: number,
): Promise<P33RunRow | null> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newPairingCode();
    try {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO coop_runs_p33
            (code, offerer_presence_id, answerer_presence_id, offerer_account_id, answerer_account_id,
             offerer_display_name, answerer_display_name, offerer_canonical_username,
             answerer_canonical_username, offerer_bearer_hash, answerer_bearer_hash,
              offerer_generation, answerer_generation, offerer_seen_at, answerer_seen_at,
              state, created_at, updated_at)
           SELECT ?, offerer.presence_id, answerer.presence_id, offerer.account_id, answerer.account_id,
             offerer.display_name, answerer.display_name, offerer.canonical_username,
             answerer.canonical_username, offerer.bearer_hash, answerer.bearer_hash,
              0, 0, ?, ?, 'active', ?, ?
           FROM coop_lobby_p33 AS offerer JOIN coop_lobby_p33 AS answerer
           WHERE offerer.presence_id = ? AND answerer.presence_id = ?
             AND offerer.req_from = answerer.presence_id
             AND offerer.paired_code IS NULL AND answerer.paired_code IS NULL
             AND offerer.seen_at >= ? AND answerer.seen_at >= ?`,
        ).bind(code, now, now, now, now, offererId, answererId, now - LOBBY_PRESENCE_MS, now - LOBBY_PRESENCE_MS),
        env.DB.prepare(
          `INSERT INTO coop_pair_members_p33 (presence_id, account_id, code, transport_role)
           SELECT offerer_presence_id, offerer_account_id, code, 'offerer' FROM coop_runs_p33 WHERE code = ?
           UNION ALL
           SELECT answerer_presence_id, answerer_account_id, code, 'answerer' FROM coop_runs_p33 WHERE code = ?`,
        ).bind(code, code),
        env.DB.prepare(
          `UPDATE coop_lobby_p33 SET paired_code = ?, transport_role = 'offerer', req_from = NULL, req_at = NULL
           WHERE presence_id = ? AND EXISTS (SELECT 1 FROM coop_runs_p33 WHERE code = ?)`,
        ).bind(code, offererId, code),
        env.DB.prepare(
          `UPDATE coop_lobby_p33 SET paired_code = ?, transport_role = 'answerer', declined_name = NULL
           WHERE presence_id = ? AND EXISTS (SELECT 1 FROM coop_runs_p33 WHERE code = ?)`,
        ).bind(code, answererId, code),
      ]);
    } catch {
      if ((await env.DB.prepare("SELECT 1 AS present FROM coop_runs_p33 WHERE code = ?").bind(code).first()) != null) {
        continue;
      }
      return null;
    }
    const run = await env.DB.prepare("SELECT * FROM coop_runs_p33 WHERE code = ?").bind(code).first<P33RunRow>();
    if (run != null) {
      return run;
    }
    return null;
  }
  return null;
}

async function handleLobbyRespond(request: Request, env: P33SignalingEnv, now: number): Promise<Response> {
  const body = await readBody(request);
  const self = body?.self;
  const from = body?.from;
  const accept = body?.accept;
  if (!safeIdentifier(self) || !safeIdentifier(from) || typeof accept !== "boolean") {
    return error(env, "invalid lobby response");
  }
  const responder = await authenticateLobby(request, env, self);
  if (responder == null || responder.paired_code != null || responder.req_from !== from) {
    return error(env, "stale lobby response", 409);
  }
  if (!accept) {
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE coop_lobby_p33 SET req_from = NULL, req_at = NULL
         WHERE presence_id = ? AND req_from = ? AND bearer_hash = ?`,
      ).bind(self, from, responder.bearer_hash),
      env.DB.prepare(
        `UPDATE coop_lobby_p33 SET declined_name = ?
           WHERE presence_id = ? AND paired_code IS NULL
             AND EXISTS (
               SELECT 1 FROM coop_lobby_p33 AS responder
               WHERE responder.presence_id = ? AND responder.bearer_hash = ?
             )`,
      ).bind(responder.display_name, from, self, responder.bearer_hash),
    ]);
    return (results[0].meta.changes ?? 0) === 1
      ? json(env, { ok: true, pairing: null })
      : error(env, "stale lobby response", 409);
  }
  const run = await createPairing(env, self, from, now);
  return run == null ? error(env, "requester unavailable", 409) : json(env, pairingFor(run, "offerer"));
}

async function handleSignalPush(request: Request, env: P33SignalingEnv, now: number): Promise<Response> {
  const body = await readBody(request);
  const code = body?.code;
  const signal = body?.signal;
  if (!safeIdentifier(code, 32) || typeof signal !== "string" || signal.length === 0) {
    return error(env, "invalid signal");
  }
  if (new TextEncoder().encode(signal).length > MAX_SIGNAL_BYTES) {
    return error(env, "signal too large", 413);
  }
  const auth = await authenticateRun(request, env, code);
  if (auth == null || auth.row.state === "ended") {
    return error(env, "invalid pairing credential", 401);
  }
  const result = await env.DB.prepare(
    `INSERT INTO coop_signals_p33 (code, from_role, signal, updated_at)
     SELECT ?, ?, ?, ? FROM coop_runs_p33
     WHERE code = ? AND ${bearerColumn(auth.role)} = ? AND state <> 'ended'
     ON CONFLICT(code, from_role) DO UPDATE SET signal = excluded.signal, updated_at = excluded.updated_at`,
  )
    .bind(code, auth.role, signal, now, code, auth.bearerHash)
    .run();
  return (result.meta.changes ?? 0) === 1 ? json(env, { ok: true }) : error(env, "stale pairing credential", 409);
}

async function handleSignalPoll(request: Request, env: P33SignalingEnv, url: URL): Promise<Response> {
  const code = url.searchParams.get("code") ?? "";
  const auth = safeIdentifier(code, 32) ? await authenticateRun(request, env, code) : null;
  if (auth == null || auth.row.state === "ended") {
    return error(env, "invalid pairing credential", 401);
  }
  const peerRole: P33TransportRole = auth.role === "offerer" ? "answerer" : "offerer";
  const consumed = await env.DB.prepare(
    `DELETE FROM coop_signals_p33
     WHERE code = ? AND from_role = ?
       AND EXISTS (
         SELECT 1 FROM coop_runs_p33
         WHERE code = ? AND ${bearerColumn(auth.role)} = ? AND state <> 'ended'
       )
     RETURNING signal`,
  )
    .bind(code, peerRole, code, auth.bearerHash)
    .first<{ signal: string }>();
  return json(env, { signal: consumed?.signal ?? null });
}

async function handleHeartbeat(request: Request, env: P33SignalingEnv, now: number): Promise<Response> {
  const body = await readBody(request);
  const code = body?.code;
  if (!safeIdentifier(code, 32)) {
    return error(env, "invalid heartbeat");
  }
  const auth = await authenticateRun(request, env, code);
  if (auth == null || auth.row.state === "ended") {
    return error(env, "invalid pairing credential", 401);
  }
  const column = auth.role === "offerer" ? "offerer_seen_at" : "answerer_seen_at";
  const update = await env.DB.prepare(
    `UPDATE coop_runs_p33 SET ${column} = ?, updated_at = ?
       WHERE code = ? AND ${bearerColumn(auth.role)} = ? AND state <> 'ended'`,
  )
    .bind(now, now, code, auth.bearerHash)
    .run();
  if ((update.meta.changes ?? 0) !== 1) {
    return error(env, "stale pairing credential", 409);
  }
  const current = (await env.DB.prepare("SELECT * FROM coop_runs_p33 WHERE code = ?").bind(code).first<P33RunRow>())!;
  const peerSeen = auth.role === "offerer" ? current.answerer_seen_at : current.offerer_seen_at;
  const windowMs = presenceWindow(env);
  const bothPresent = now - current.offerer_seen_at <= windowMs && now - current.answerer_seen_at <= windowMs;
  const nextState = bothPresent ? "active" : "grace";
  if (current.state !== nextState) {
    await env.DB.prepare("UPDATE coop_runs_p33 SET state = ?, updated_at = ? WHERE code = ? AND state <> 'ended'")
      .bind(nextState, now, code)
      .run();
  }
  return json(env, {
    state: nextState,
    bothPresent,
    partnerPresent: now - peerSeen <= windowMs,
    connectionGeneration: auth.role === "offerer" ? current.offerer_generation : current.answerer_generation,
  });
}

async function handleLobbyLeave(request: Request, env: P33SignalingEnv): Promise<Response> {
  const body = await readBody(request);
  const self = body?.self;
  const row = safeIdentifier(self) ? await authenticateLobby(request, env, self) : null;
  if (row == null) {
    return error(env, "invalid lobby credential", 401);
  }
  if (row.paired_code == null) {
    await env.DB.prepare("DELETE FROM coop_lobby_p33 WHERE presence_id = ? AND bearer_hash = ?")
      .bind(self, row.bearer_hash)
      .run();
  }
  return json(env, { ok: true });
}

async function handleRunLeave(request: Request, env: P33SignalingEnv, now: number): Promise<Response> {
  const body = await readBody(request);
  const code = body?.code;
  if (!safeIdentifier(code, 32)) {
    return error(env, "invalid leave");
  }
  const auth = await authenticateRun(request, env, code);
  if (auth == null) {
    return error(env, "invalid pairing credential", 401);
  }
  const column = auth.role === "offerer" ? "offerer_seen_at" : "answerer_seen_at";
  const result = await env.DB.prepare(
    `UPDATE coop_runs_p33 SET ${column} = 0, state = 'grace', updated_at = ?
       WHERE code = ? AND ${bearerColumn(auth.role)} = ? AND state <> 'ended'`,
  )
    .bind(now, code, auth.bearerHash)
    .run();
  return (result.meta.changes ?? 0) === 1
    ? json(env, { ok: true, state: "grace" })
    : error(env, "stale pairing credential", 409);
}

/** Called only after the gameplay supervisor's shared terminal handshake has completed. */
async function handleRunEnd(request: Request, env: P33SignalingEnv, now: number): Promise<Response> {
  const body = await readBody(request);
  const code = body?.code;
  if (!safeIdentifier(code, 32)) {
    return error(env, "invalid end request");
  }
  const auth = await authenticateRun(request, env, code);
  if (auth == null) {
    return error(env, "invalid pairing credential", 401);
  }
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE coop_runs_p33 SET state = 'ended', updated_at = ?
         WHERE code = ? AND ${bearerColumn(auth.role)} = ?`,
    ).bind(now, code, auth.bearerHash),
    env.DB.prepare(
      "DELETE FROM coop_pair_members_p33 WHERE code = ? AND EXISTS (SELECT 1 FROM coop_runs_p33 WHERE code = ? AND state = 'ended')",
    ).bind(code, code),
    env.DB.prepare(
      "DELETE FROM coop_lobby_p33 WHERE paired_code = ? AND EXISTS (SELECT 1 FROM coop_runs_p33 WHERE code = ? AND state = 'ended')",
    ).bind(code, code),
    env.DB.prepare(
      "DELETE FROM coop_signals_p33 WHERE code = ? AND EXISTS (SELECT 1 FROM coop_runs_p33 WHERE code = ? AND state = 'ended')",
    ).bind(code, code),
  ]);
  const ended = await env.DB.prepare("SELECT state FROM coop_runs_p33 WHERE code = ?")
    .bind(code)
    .first<{ state: string }>();
  return ended?.state === "ended"
    ? json(env, { ok: true, state: "ended" })
    : error(env, "stale pairing credential", 409);
}

interface P33RejoinTarget {
  role: P33TransportRole;
  accountColumn: "offerer_account_id" | "answerer_account_id";
  displayColumn: "offerer_display_name" | "answerer_display_name";
  canonicalColumn: "offerer_canonical_username" | "answerer_canonical_username";
  presenceColumn: "offerer_presence_id" | "answerer_presence_id";
  bearerColumn: "offerer_bearer_hash" | "answerer_bearer_hash";
  generationColumn: "offerer_generation" | "answerer_generation";
  seenColumn: "offerer_seen_at" | "answerer_seen_at";
  oldPresence: string;
  peerSeenAt: number;
}

function rejoinTarget(run: P33RunRow, accountId: string): P33RejoinTarget | null {
  if (sameString(run.offerer_account_id, accountId)) {
    return {
      role: "offerer",
      accountColumn: "offerer_account_id",
      displayColumn: "offerer_display_name",
      canonicalColumn: "offerer_canonical_username",
      presenceColumn: "offerer_presence_id",
      bearerColumn: "offerer_bearer_hash",
      generationColumn: "offerer_generation",
      seenColumn: "offerer_seen_at",
      oldPresence: run.offerer_presence_id,
      peerSeenAt: run.answerer_seen_at,
    };
  }
  if (!sameString(run.answerer_account_id, accountId)) {
    return null;
  }
  return {
    role: "answerer",
    accountColumn: "answerer_account_id",
    displayColumn: "answerer_display_name",
    canonicalColumn: "answerer_canonical_username",
    presenceColumn: "answerer_presence_id",
    bearerColumn: "answerer_bearer_hash",
    generationColumn: "answerer_generation",
    seenColumn: "answerer_seen_at",
    oldPresence: run.answerer_presence_id,
    peerSeenAt: run.offerer_seen_at,
  };
}

function rejoinResponse(
  env: P33SignalingEnv,
  run: P33RunRow,
  target: P33RejoinTarget,
  identity: P33TicketCredential,
): Response {
  return json(env, {
    presenceId: identity.credential.presenceId,
    pairingToken: identity.credential.bearer,
    identity: {
      version: 1,
      accountId: identity.payload.sub,
      displayName: identity.payload.displayName,
      canonicalUsername: identity.payload.canonicalUsername,
    },
    pairing: pairingFor(run, target.role),
  });
}

async function handleRejoin(request: Request, env: P33SignalingEnv, now: number): Promise<Response> {
  const body = await readBody(request);
  const code = body?.code;
  if (body == null || !safeIdentifier(code, 32)) {
    return error(env, "invalid rejoin body");
  }
  const identity = await ticketCredential(env, body, now);
  if (identity == null) {
    return error(env, "invalid or already rebound co-op identity ticket", 401);
  }
  const run = await env.DB.prepare("SELECT * FROM coop_runs_p33 WHERE code = ?").bind(code).first<P33RunRow>();
  if (run == null || run.state === "ended") {
    return error(env, "run unavailable", 409);
  }
  const target = rejoinTarget(run, identity.payload.sub);
  if (target == null) {
    return error(env, "ticket account is not a run member", 403);
  }
  if (
    target.oldPresence === identity.credential.presenceId
    && sameString(run[target.bearerColumn], identity.credential.bearerHash)
  ) {
    return rejoinResponse(env, run, target, identity);
  }
  const nextState = now - target.peerSeenAt <= presenceWindow(env) ? "active" : "grace";
  try {
    await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM coop_pair_members_p33
         WHERE code = ? AND account_id = ? AND presence_id = ?
           AND EXISTS (
             SELECT 1 FROM coop_runs_p33
             WHERE code = ? AND ${target.presenceColumn} = ? AND ${target.accountColumn} = ?
           )`,
      ).bind(code, identity.payload.sub, target.oldPresence, code, target.oldPresence, identity.payload.sub),
      env.DB.prepare(
        `DELETE FROM coop_lobby_p33
         WHERE presence_id = ? AND account_id = ?
           AND EXISTS (
             SELECT 1 FROM coop_runs_p33
             WHERE code = ? AND ${target.presenceColumn} = ? AND ${target.accountColumn} = ?
           )`,
      ).bind(target.oldPresence, identity.payload.sub, code, target.oldPresence, identity.payload.sub),
      env.DB.prepare(
        `INSERT INTO coop_lobby_p33
          (presence_id, account_id, display_name, canonical_username, ticket_nonce, client_nonce,
           bearer_hash, seen_at, paired_code, transport_role, created_at, req_from, req_at, declined_name)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL
         FROM coop_runs_p33
         WHERE code = ? AND ${target.presenceColumn} = ? AND ${target.accountColumn} = ?`,
      ).bind(
        identity.credential.presenceId,
        identity.payload.sub,
        identity.payload.displayName,
        identity.payload.canonicalUsername,
        identity.payload.nonce,
        identity.clientNonce,
        identity.credential.bearerHash,
        now,
        code,
        target.role,
        now,
        code,
        target.oldPresence,
        identity.payload.sub,
      ),
      env.DB.prepare(
        `UPDATE coop_runs_p33 SET
           ${target.presenceColumn} = ?, ${target.bearerColumn} = ?, ${target.displayColumn} = ?,
           ${target.canonicalColumn} = ?, ${target.generationColumn} = ${target.generationColumn} + 1,
           ${target.seenColumn} = ?, state = ?, updated_at = ?
         WHERE code = ? AND ${target.presenceColumn} = ? AND ${target.accountColumn} = ?`,
      ).bind(
        identity.credential.presenceId,
        identity.credential.bearerHash,
        identity.payload.displayName,
        identity.payload.canonicalUsername,
        now,
        nextState,
        now,
        code,
        target.oldPresence,
        identity.payload.sub,
      ),
      env.DB.prepare(
        `INSERT INTO coop_pair_members_p33 (presence_id, account_id, code, transport_role)
         SELECT ?, ?, code, ? FROM coop_runs_p33
         WHERE code = ? AND ${target.presenceColumn} = ? AND ${target.accountColumn} = ?`,
      ).bind(
        identity.credential.presenceId,
        identity.payload.sub,
        target.role,
        code,
        identity.credential.presenceId,
        identity.payload.sub,
      ),
    ]);
  } catch {
    return error(env, "rejoin conflict", 409);
  }
  const rebound = await env.DB.prepare("SELECT * FROM coop_runs_p33 WHERE code = ?").bind(code).first<P33RunRow>();
  if (
    rebound == null
    || rebound[target.presenceColumn] !== identity.credential.presenceId
    || !sameString(rebound[target.bearerColumn], identity.credential.bearerHash)
  ) {
    return error(env, "rejoin did not commit", 409);
  }
  return rejoinResponse(env, rebound, target, identity);
}

/** Returns null for legacy/non-P33 routes so the existing Worker can handle them unchanged. */
export async function handleP33SignalingRequest(request: Request, env: P33SignalingEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/u, "");
  if (!path.startsWith("/coop/v3")) {
    return null;
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(env) });
  }
  if (path === "/coop/v3/health" && request.method === "GET") {
    return json(env, {
      ok: true,
      protocol: "er-coop-33",
      identityConfigured: (env.COOP_IDENTITY_SECRET?.length ?? 0) >= 32,
    });
  }
  if ((env.COOP_IDENTITY_SECRET?.length ?? 0) < 32) {
    return error(env, "P33 identity service unavailable", 503);
  }
  const now = Date.now();
  try {
    await ensureP33SignalingSchema(env);
    if (request.method === "POST") {
      switch (path) {
        case "/coop/v3/lobby/announce":
          return await handleAnnounce(request, env, now);
        case "/coop/v3/lobby/request":
          return await handleLobbyRequest(request, env, now);
        case "/coop/v3/lobby/respond":
          return await handleLobbyRespond(request, env, now);
        case "/coop/v3/lobby/leave":
          return await handleLobbyLeave(request, env);
        case "/coop/v3/signal":
          return await handleSignalPush(request, env, now);
        case "/coop/v3/heartbeat":
          return await handleHeartbeat(request, env, now);
        case "/coop/v3/leave":
          return await handleRunLeave(request, env, now);
        case "/coop/v3/end":
          return await handleRunEnd(request, env, now);
        case "/coop/v3/rejoin":
          return await handleRejoin(request, env, now);
      }
    }
    if (request.method === "GET") {
      switch (path) {
        case "/coop/v3/lobby":
          return await handleLobbyList(request, env, url, now);
        case "/coop/v3/signal":
          return await handleSignalPoll(request, env, url);
      }
    }
    return error(env, "not found", 404);
  } catch {
    return error(env, "P33 signaling transaction failed", 500);
  }
}
