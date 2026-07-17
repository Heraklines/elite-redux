/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================

import { handleP33SignalingRequest, pruneP33Signaling } from "./p33-signaling";

// Elite Redux - co-op signaling + run-relay API (Cloudflare Worker + D1). #633
//
// The co-op RUN is peer-to-peer (WebRTC DataChannel); this Worker is ONLY the
// matchmaking/signaling broker + a thin host-authoritative save relay used to
// RESUME a run. So it stays tiny and cheap: one `coop_runs` row per session,
// keyed by the human-shareable pairing code (see src/data/elite-redux/coop/
// coop-pairing.ts - the alphabet/length is mirrored below).
//
// Endpoints (all under /coop, JSON in/out):
//   POST /coop/create    { host, seed }            -> { code }
//   POST /coop/join      { code, guest }           -> { ok, seed, state, hostName }
//   POST /coop/signal    { code, role, signal }    -> { ok }              (push your SDP/ICE)
//   GET  /coop/signal    ?code=&role=              -> { signal }          (poll the PEER's, then clear)
//   POST /coop/heartbeat { code, role, state? }    -> { state, bothPresent, partnerPresent }
//   POST /coop/save      { code, blob, state? }    -> { ok }              (host pushes authoritative blob)
//   GET  /coop/load      ?code=                    -> { blob, state, canResume }
//   POST /coop/leave     { code, role }            -> { ok }
//
// RESUME-REQUIRES-BOTH (#639): /coop/load only reports canResume=true when BOTH
// peers have heartbeat'd within PRESENCE_WINDOW_MS. The host gates the actual
// re-launch on that flag.
// =============================================================================

interface Env {
  DB: D1Database;
  ALLOWED_ORIGIN?: string;
  /** A peer is PRESENT if its last heartbeat is within this many ms (default 30s). */
  PRESENCE_WINDOW_MS?: string;
  /** Runs untouched for this long are pruned by the cron (default 24h). */
  RUN_TTL_MS?: string;
  /** Cloudflare Realtime TURN key id (optional). Set via `wrangler secret put CF_TURN_KEY_ID`. */
  CF_TURN_KEY_ID?: string;
  TURN_URLS?: string;
  TURN_USERNAME?: string;
  TURN_CREDENTIAL?: string;
  /** Cloudflare Realtime TURN API token (optional). Set via `wrangler secret put CF_TURN_API_TOKEN`. */
  CF_TURN_API_TOKEN?: string;
  /** TURN credential lifetime in seconds (default 86400). */
  TURN_TTL_SECONDS?: string;
  /** Shared with er-save-api; verifies short-lived authenticated P33 identity tickets. */
  COOP_IDENTITY_SECRET?: string;
  /** Bounded P33 hot-rejoin grace before an abandoned pairing releases both accounts. */
  P33_REJOIN_GRACE_MS?: string;
  /** Exact Git source deployed by the staging promotion workflow. */
  SOURCE_SHA?: string;
}

interface CoopRunRow {
  code: string;
  host_username: string;
  guest_username: string | null;
  seed: string | null;
  host_signal: string | null;
  guest_signal: string | null;
  save_blob: string | null;
  state: string;
  host_seen_at: number;
  guest_seen_at: number | null;
  created_at: number;
  updated_at: number;
}

type CoopRole = "host" | "guest";

/** A lobby presence row: a player waiting to be matched (#633, matchmaking). */
interface CoopLobbyRow {
  id: string;
  name: string;
  seen_at: number;
  paired_code: string | null;
  paired_role: string | null;
  created_at: number;
  /** Join-request (lobby v2): the presence id of the player ASKING to join me. */
  req_from: string | null;
  /** Display name of the requester (denormalized so the poll needs no second lookup). */
  req_from_name: string | null;
  /** When the request was made (stale requests expire with presence). */
  req_at: number | null;
  /** One-shot decline notice: the name of the player who declined MY request. */
  declined_name: string | null;
}

/** Pairing-code alphabet/length - MUST match src/.../coop-pairing.ts. */
const PAIRING_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const PAIRING_CODE_LENGTH = 6;
const DEFAULT_PRESENCE_WINDOW_MS = 30_000;
const DEFAULT_RUN_TTL_MS = 86_400_000;
/** Lobby presence: drop a waiting player whose last poll is older than this. */
const LOBBY_PRESENCE_MS = 12_000;
/** Reject save blobs larger than this (defensive; a session blob is well under). */
const MAX_BLOB_BYTES = 4_000_000;

// #region helpers

function corsHeaders(env: Env): Record<string, string> {
  const origin = env.ALLOWED_ORIGIN && env.ALLOWED_ORIGIN !== "*" ? env.ALLOWED_ORIGIN : "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function json(env: Env, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) },
  });
}

function err(env: Env, message: string, status = 400): Response {
  return json(env, { error: message }, status);
}

function isRole(v: unknown): v is CoopRole {
  return v === "host" || v === "guest";
}

/** Generate a random pairing code from crypto bytes (mirrors pairingCodeFromBytes). */
function newPairingCode(): string {
  const bytes = new Uint8Array(PAIRING_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    out += PAIRING_ALPHABET[bytes[i] % PAIRING_ALPHABET.length];
  }
  return out;
}

function normalizeCode(raw: unknown): string {
  if (typeof raw !== "string") {
    return "";
  }
  let out = "";
  for (const ch of raw.toUpperCase()) {
    if (PAIRING_ALPHABET.includes(ch)) {
      out += ch;
    }
  }
  return out;
}

function presenceWindow(env: Env): number {
  const n = Number(env.PRESENCE_WINDOW_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PRESENCE_WINDOW_MS;
}

function seen(at: number | null, now: number, windowMs: number): boolean {
  return at != null && now - at <= windowMs;
}

async function getRun(env: Env, code: string): Promise<CoopRunRow | null> {
  return env.DB.prepare("SELECT * FROM coop_runs WHERE code = ?").bind(code).first<CoopRunRow>();
}

async function ensureSchema(env: Env): Promise<void> {
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS coop_runs (code TEXT PRIMARY KEY, host_username TEXT NOT NULL, guest_username TEXT, seed TEXT, host_signal TEXT, guest_signal TEXT, save_blob TEXT, state TEXT NOT NULL DEFAULT 'lobby', host_seen_at INTEGER NOT NULL, guest_seen_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  );
  // Matchmaking lobby: one row per player WAITING to be matched. The worker
  // assigns host/guest roles on pick (players never choose), so the run code +
  // role are written back here for each side to read on its next poll.
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS coop_lobby (id TEXT PRIMARY KEY, name TEXT NOT NULL, seen_at INTEGER NOT NULL, paired_code TEXT, paired_role TEXT, created_at INTEGER NOT NULL, req_from TEXT, req_from_name TEXT, req_at INTEGER, declined_name TEXT)",
  );
  // Lobby v2 (join-with-confirmation): additive columns for DBs created before the
  // request/respond flow. ALTER throws when the column already exists - swallowed.
  for (const alter of [
    "ALTER TABLE coop_lobby ADD COLUMN req_from TEXT",
    "ALTER TABLE coop_lobby ADD COLUMN req_from_name TEXT",
    "ALTER TABLE coop_lobby ADD COLUMN req_at INTEGER",
    "ALTER TABLE coop_lobby ADD COLUMN declined_name TEXT",
  ]) {
    try {
      await env.DB.exec(alter);
    } catch {
      // column already exists
    }
  }
}

async function getLobby(env: Env, id: string): Promise<CoopLobbyRow | null> {
  return env.DB.prepare("SELECT * FROM coop_lobby WHERE id = ?").bind(id).first<CoopLobbyRow>();
}

function lobbyPairing(row: CoopLobbyRow | null): { code: string; role: CoopRole } | null {
  if (row?.paired_code && isRole(row.paired_role)) {
    return { code: row.paired_code, role: row.paired_role };
  }
  return null;
}

// #endregion

async function handleCreate(env: Env, body: Record<string, unknown>, now: number): Promise<Response> {
  const host = typeof body.host === "string" ? body.host.slice(0, 64) : "";
  if (!host) {
    return err(env, "missing host");
  }
  const seed = typeof body.seed === "string" ? body.seed.slice(0, 256) : null;
  // Try a few codes to avoid the (astronomically unlikely) collision.
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = newPairingCode();
    try {
      await env.DB.prepare(
        "INSERT INTO coop_runs (code, host_username, seed, state, host_seen_at, created_at, updated_at) VALUES (?, ?, ?, 'lobby', ?, ?, ?)",
      )
        .bind(code, host, seed, now, now, now)
        .run();
      return json(env, { code });
    } catch {
      // PK collision -> retry with a fresh code.
    }
  }
  return err(env, "could not allocate a pairing code", 503);
}

async function handleJoin(env: Env, body: Record<string, unknown>, now: number): Promise<Response> {
  const code = normalizeCode(body.code);
  const guest = typeof body.guest === "string" ? body.guest.slice(0, 64) : "";
  if (code.length !== PAIRING_CODE_LENGTH || !guest) {
    return err(env, "missing code or guest");
  }
  const run = await getRun(env, code);
  if (!run) {
    return err(env, "no such run", 404);
  }
  if (run.guest_username && run.guest_username !== guest) {
    return err(env, "run already has a guest", 409);
  }
  await env.DB.prepare(
    "UPDATE coop_runs SET guest_username = ?, guest_seen_at = ?, state = CASE WHEN state = 'lobby' THEN 'active' ELSE state END, updated_at = ? WHERE code = ?",
  )
    .bind(guest, now, now, code)
    .run();
  return json(env, { ok: true, seed: run.seed, state: "active", hostName: run.host_username });
}

async function handleSignalPush(env: Env, body: Record<string, unknown>, now: number): Promise<Response> {
  const code = normalizeCode(body.code);
  const role = body.role;
  const signal = typeof body.signal === "string" ? body.signal : "";
  if (code.length !== PAIRING_CODE_LENGTH || !isRole(role) || !signal) {
    return err(env, "missing code/role/signal");
  }
  const col = role === "host" ? "host_signal" : "guest_signal";
  const res = await env.DB.prepare(`UPDATE coop_runs SET ${col} = ?, updated_at = ? WHERE code = ?`)
    .bind(signal, now, code)
    .run();
  if (!res.meta.changes) {
    return err(env, "no such run", 404);
  }
  return json(env, { ok: true });
}

async function handleSignalPoll(env: Env, url: URL): Promise<Response> {
  const code = normalizeCode(url.searchParams.get("code"));
  const role = url.searchParams.get("role");
  if (code.length !== PAIRING_CODE_LENGTH || !isRole(role)) {
    return err(env, "missing code/role");
  }
  const run = await getRun(env, code);
  if (!run) {
    return err(env, "no such run", 404);
  }
  // A peer polls for the OTHER side's signal; clear it once read (one-shot).
  const peerCol = role === "host" ? "guest_signal" : "host_signal";
  const signal = role === "host" ? run.guest_signal : run.host_signal;
  if (signal) {
    await env.DB.prepare(`UPDATE coop_runs SET ${peerCol} = NULL WHERE code = ?`).bind(code).run();
  }
  return json(env, { signal: signal ?? null });
}

async function handleHeartbeat(env: Env, body: Record<string, unknown>, now: number): Promise<Response> {
  const code = normalizeCode(body.code);
  const role = body.role;
  if (code.length !== PAIRING_CODE_LENGTH || !isRole(role)) {
    return err(env, "missing code/role");
  }
  const col = role === "host" ? "host_seen_at" : "guest_seen_at";
  const stateClause = typeof body.state === "string" ? ", state = ?" : "";
  const stmt = stateClause
    ? env.DB.prepare(`UPDATE coop_runs SET ${col} = ?, state = ?, updated_at = ? WHERE code = ?`).bind(
        now,
        body.state,
        now,
        code,
      )
    : env.DB.prepare(`UPDATE coop_runs SET ${col} = ?, updated_at = ? WHERE code = ?`).bind(now, now, code);
  const res = await stmt.run();
  if (!res.meta.changes) {
    return err(env, "no such run", 404);
  }
  const run = await getRun(env, code);
  const w = presenceWindow(env);
  const hostPresent = seen(run!.host_seen_at, now, w);
  const guestPresent = seen(run!.guest_seen_at, now, w);
  return json(env, {
    state: run!.state,
    bothPresent: hostPresent && guestPresent,
    partnerPresent: role === "host" ? guestPresent : hostPresent,
  });
}

async function handleSave(env: Env, body: Record<string, unknown>, now: number): Promise<Response> {
  const code = normalizeCode(body.code);
  const blob = typeof body.blob === "string" ? body.blob : "";
  if (code.length !== PAIRING_CODE_LENGTH || !blob) {
    return err(env, "missing code/blob");
  }
  if (blob.length > MAX_BLOB_BYTES) {
    return err(env, "blob too large", 413);
  }
  const stateClause = typeof body.state === "string" ? ", state = ?" : "";
  const stmt = stateClause
    ? env.DB.prepare("UPDATE coop_runs SET save_blob = ?, state = ?, updated_at = ? WHERE code = ?").bind(
        blob,
        body.state,
        now,
        code,
      )
    : env.DB.prepare("UPDATE coop_runs SET save_blob = ?, updated_at = ? WHERE code = ?").bind(blob, now, code);
  const res = await stmt.run();
  if (!res.meta.changes) {
    return err(env, "no such run", 404);
  }
  return json(env, { ok: true });
}

async function handleLoad(env: Env, url: URL, now: number): Promise<Response> {
  const code = normalizeCode(url.searchParams.get("code"));
  if (code.length !== PAIRING_CODE_LENGTH) {
    return err(env, "missing code");
  }
  const run = await getRun(env, code);
  if (!run) {
    return err(env, "no such run", 404);
  }
  const w = presenceWindow(env);
  // RESUME-REQUIRES-BOTH (#639): only resumable when both peers are present now.
  const canResume = seen(run.host_seen_at, now, w) && seen(run.guest_seen_at, now, w);
  return json(env, { blob: run.save_blob ?? null, state: run.state, canResume });
}

async function handleLeave(env: Env, body: Record<string, unknown>, now: number): Promise<Response> {
  const code = normalizeCode(body.code);
  const role = body.role;
  if (code.length !== PAIRING_CODE_LENGTH || !isRole(role)) {
    return err(env, "missing code/role");
  }
  // Marking the leaver absent (seen_at far in the past) opens the partner's grace
  // window client-side; the cron prunes the row once its TTL elapses.
  const col = role === "host" ? "host_seen_at" : "guest_seen_at";
  await env.DB.prepare(`UPDATE coop_runs SET ${col} = 0, state = 'grace', updated_at = ? WHERE code = ?`)
    .bind(now, code)
    .run();
  return json(env, { ok: true });
}

// #region matchmaking lobby (#633)

/**
 * Announce/refresh my presence in the lobby. Mints an id on first call (the client
 * keeps it). Returns my current pairing if the worker has already matched me.
 */
async function handleLobbyAnnounce(env: Env, body: Record<string, unknown>, now: number): Promise<Response> {
  const name = typeof body.name === "string" ? body.name.slice(0, 32).trim() : "";
  if (!name) {
    return err(env, "missing name");
  }
  const id = typeof body.id === "string" && body.id.length >= 8 ? body.id.slice(0, 64) : crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO coop_lobby (id, name, seen_at, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, seen_at = excluded.seen_at",
  )
    .bind(id, name, now, now)
    .run();
  return json(env, { id, pairing: lobbyPairing(await getLobby(env, id)) });
}

/**
 * List OTHER waiting (unpaired, present) players and report MY pairing if one was
 * made. Doubles as a heartbeat: refreshes the caller's seen_at so a polling client
 * stays listed. Lobby v2: also carries my INCOMING join request (id + name, if the
 * requester is still present) and a ONE-SHOT decline notice (read + cleared here)
 * for a request of mine that the other player turned down.
 */
async function handleLobbyList(env: Env, url: URL, now: number): Promise<Response> {
  const self = url.searchParams.get("self") ?? "";
  if (self) {
    await env.DB.prepare("UPDATE coop_lobby SET seen_at = ? WHERE id = ?").bind(now, self).run();
  }
  const cutoff = now - LOBBY_PRESENCE_MS;
  const rows = await env.DB.prepare(
    "SELECT id, name, seen_at FROM coop_lobby WHERE id != ? AND paired_code IS NULL AND seen_at >= ? ORDER BY created_at ASC LIMIT 50",
  )
    .bind(self, cutoff)
    .all<{ id: string; name: string; seen_at: number }>();
  const players = (rows.results ?? []).map(r => ({ id: r.id, name: r.name, age: Math.max(0, now - r.seen_at) }));
  const selfRow = self ? await getLobby(env, self) : null;
  // Incoming join request, only while the REQUESTER is still present (a stale/gone
  // requester's ask silently evaporates - accepting it would 410 anyway).
  let request: { id: string; name: string } | null = null;
  if (selfRow?.req_from) {
    const requester = await getLobby(env, selfRow.req_from);
    if (requester && now - requester.seen_at <= LOBBY_PRESENCE_MS && !requester.paired_code) {
      request = { id: selfRow.req_from, name: selfRow.req_from_name ?? requester.name };
    } else {
      await env.DB.prepare("UPDATE coop_lobby SET req_from = NULL, req_from_name = NULL, req_at = NULL WHERE id = ?")
        .bind(self)
        .run();
    }
  }
  // One-shot decline notice: report it once, then clear it.
  const declined = selfRow?.declined_name ?? null;
  if (declined) {
    await env.DB.prepare("UPDATE coop_lobby SET declined_name = NULL WHERE id = ?").bind(self).run();
  }
  return json(env, { players, pairing: lobbyPairing(selfRow), request, declined });
}

/**
 * Lobby v2 (join-with-confirmation): ASK a player to co-op. Writes the request onto
 * the TARGET's row; the target sees it on its next poll and answers via
 * /coop/lobby/respond. One pending request per target (first ask wins until it is
 * answered or the requester goes stale). Idempotent for the same requester.
 */
async function handleLobbyRequest(env: Env, body: Record<string, unknown>, now: number): Promise<Response> {
  const self = typeof body.self === "string" ? body.self : "";
  const target = typeof body.target === "string" ? body.target : "";
  if (!self || !target || self === target) {
    return err(env, "missing/invalid self or target");
  }
  const selfRow = await getLobby(env, self);
  if (!selfRow) {
    return err(env, "you left the lobby", 410);
  }
  const targetRow = await getLobby(env, target);
  if (!targetRow || now - targetRow.seen_at > LOBBY_PRESENCE_MS) {
    return err(env, "that player is no longer available", 410);
  }
  if (targetRow.paired_code) {
    return err(env, "that player was just matched - pick another", 409);
  }
  // Someone ELSE is already asking them (and is still fresh): busy.
  if (targetRow.req_from && targetRow.req_from !== self) {
    const other = await getLobby(env, targetRow.req_from);
    if (other && now - other.seen_at <= LOBBY_PRESENCE_MS) {
      return err(env, "that player is already considering another request", 409);
    }
  }
  await env.DB.prepare("UPDATE coop_lobby SET req_from = ?, req_from_name = ?, req_at = ? WHERE id = ?")
    .bind(self, selfRow.name, now, target)
    .run();
  return json(env, { ok: true, pending: true });
}

/**
 * Lobby v2 (join-with-confirmation): ANSWER the join request on my row. Accept pairs
 * the two exactly like /coop/lobby/pick (the RESPONDER hosts, the requester joins)
 * and returns MY pairing; the requester reads theirs on its next poll. Decline
 * clears the request and leaves a one-shot notice on the requester's row.
 */
async function handleLobbyRespond(env: Env, body: Record<string, unknown>, now: number): Promise<Response> {
  const self = typeof body.self === "string" ? body.self : "";
  const from = typeof body.from === "string" ? body.from : "";
  const accept = body.accept === true;
  if (!self || !from) {
    return err(env, "missing self or from");
  }
  const selfRow = await getLobby(env, self);
  if (!selfRow) {
    return err(env, "you left the lobby", 410);
  }
  if (selfRow.req_from !== from) {
    return err(env, "that request is no longer pending", 410);
  }
  // Always clear the pending request off my row first (accept and decline both consume it).
  await env.DB.prepare("UPDATE coop_lobby SET req_from = NULL, req_from_name = NULL, req_at = NULL WHERE id = ?")
    .bind(self)
    .run();
  if (!accept) {
    await env.DB.prepare("UPDATE coop_lobby SET declined_name = ? WHERE id = ?").bind(selfRow.name, from).run();
    return json(env, { ok: true, declined: true });
  }
  const fromRow = await getLobby(env, from);
  if (!fromRow || now - fromRow.seen_at > LOBBY_PRESENCE_MS || fromRow.paired_code) {
    return err(env, "that player is no longer available", 410);
  }
  // Pair: the RESPONDER (me) hosts, the requester joins - mirrors pick's "picked player hosts".
  const code = newPairingCode();
  await env.DB.prepare(
    "INSERT INTO coop_runs (code, host_username, guest_username, seed, state, host_seen_at, guest_seen_at, created_at, updated_at) VALUES (?, ?, ?, NULL, 'active', ?, ?, ?, ?)",
  )
    .bind(code, selfRow.name, fromRow.name, now, now, now, now)
    .run();
  const claim = await env.DB.prepare(
    "UPDATE coop_lobby SET paired_code = ?, paired_role = 'host' WHERE id = ? AND paired_code IS NULL",
  )
    .bind(code, self)
    .run();
  if (!claim.meta.changes) {
    await env.DB.prepare("DELETE FROM coop_runs WHERE code = ?").bind(code).run();
    return err(env, "you were just matched elsewhere", 409);
  }
  await env.DB.prepare("UPDATE coop_lobby SET paired_code = ?, paired_role = 'guest' WHERE id = ?")
    .bind(code, from)
    .run();
  return json(env, { code, role: "host" });
}

/**
 * Pick a player to co-op with. The worker MATCHES the two and ASSIGNS roles (the
 * picked player hosts, the picker joins - invisible to both) by creating the run
 * row + writing the code/role back onto each lobby row. Returns the caller's
 * pairing; the partner discovers theirs on its next poll.
 */
async function handleLobbyPick(env: Env, body: Record<string, unknown>, now: number): Promise<Response> {
  const self = typeof body.self === "string" ? body.self : "";
  const target = typeof body.target === "string" ? body.target : "";
  if (!self || !target || self === target) {
    return err(env, "missing/invalid self or target");
  }
  const selfRow = await getLobby(env, self);
  const targetRow = await getLobby(env, target);
  if (!selfRow) {
    return err(env, "you left the lobby", 410);
  }
  // Idempotent: if I'm already matched, just return that pairing.
  const existing = lobbyPairing(selfRow);
  if (existing) {
    return json(env, existing);
  }
  if (!targetRow || now - targetRow.seen_at > LOBBY_PRESENCE_MS) {
    return err(env, "that player is no longer available", 410);
  }
  if (targetRow.paired_code) {
    return err(env, "that player was just matched - pick another", 409);
  }
  // Create the run (target hosts, self joins) and claim the target atomically.
  const code = newPairingCode();
  await env.DB.prepare(
    "INSERT INTO coop_runs (code, host_username, guest_username, seed, state, host_seen_at, guest_seen_at, created_at, updated_at) VALUES (?, ?, ?, NULL, 'active', ?, ?, ?, ?)",
  )
    .bind(code, targetRow.name, selfRow.name, now, now, now, now)
    .run();
  const claim = await env.DB.prepare(
    "UPDATE coop_lobby SET paired_code = ?, paired_role = 'host' WHERE id = ? AND paired_code IS NULL",
  )
    .bind(code, target)
    .run();
  if (!claim.meta.changes) {
    // Lost the race - someone matched the target first. Roll back the run.
    await env.DB.prepare("DELETE FROM coop_runs WHERE code = ?").bind(code).run();
    return err(env, "that player was just matched - pick another", 409);
  }
  await env.DB.prepare("UPDATE coop_lobby SET paired_code = ?, paired_role = 'guest' WHERE id = ?")
    .bind(code, self)
    .run();
  return json(env, { code, role: "guest" });
}

/** Leave the lobby (remove my presence row). */
async function handleLobbyLeave(env: Env, body: Record<string, unknown>): Promise<Response> {
  const self = typeof body.self === "string" ? body.self : "";
  if (self) {
    await env.DB.prepare("DELETE FROM coop_lobby WHERE id = ?").bind(self).run();
  }
  return json(env, { ok: true });
}

// #endregion

/** STUN-only ICE config (free, no relay) - the no-TURN fallback. */
function stunOnlyIce(env: Env): Response {
  return json(env, {
    iceServers: [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }],
  });
}

/**
 * Return ICE servers for a peer connection. When a Cloudflare Realtime TURN key is
 * configured, mints SHORT-LIVED TURN credentials (kept in your Cloudflare account,
 * billed on relay egress only - and co-op carries only tiny command traffic). With
 * no key set, returns free STUN only (most peers connect directly anyway).
 */
async function handleIce(env: Env): Promise<Response> {
  const keyId = env.CF_TURN_KEY_ID;
  const apiToken = env.CF_TURN_API_TOKEN;
  if (!keyId || !apiToken) {
    // STATIC TURN fallback (#797): no Cloudflare Realtime key provisioned, but a static
    // relay is configured (e.g. the free Open Relay). Two peers behind incompatible NATs
    // CANNOT connect with STUN alone - live sessions were stuck at "connecting" forever.
    if (env.TURN_URLS) {
      const turn: { urls: string[]; username?: string; credential?: string } = {
        urls: env.TURN_URLS.split(",")
          .map(u => u.trim())
          .filter(u => u.length > 0),
      };
      if (env.TURN_USERNAME) {
        turn.username = env.TURN_USERNAME;
      }
      if (env.TURN_CREDENTIAL) {
        turn.credential = env.TURN_CREDENTIAL;
      }
      return json(env, {
        iceServers: [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }, turn],
      });
    }
    return stunOnlyIce(env);
  }
  const ttl = Number(env.TURN_TTL_SECONDS);
  const ttlSeconds = Number.isFinite(ttl) && ttl > 0 ? ttl : 86_400;
  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: ttlSeconds }),
    });
    if (!res.ok) {
      return stunOnlyIce(env);
    }
    // Cloudflare returns { iceServers: { urls, username, credential } } - one entry.
    const data = (await res.json()) as { iceServers?: unknown };
    if (data.iceServers) {
      return json(env, { iceServers: [data.iceServers] });
    }
    return stunOnlyIce(env);
  } catch {
    return stunOnlyIce(env);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const p33 = await handleP33SignalingRequest(request, env);
    if (p33 != null) {
      return p33;
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");
    const now = Date.now();

    try {
      await ensureSchema(env);

      // GET routes
      if (request.method === "GET") {
        switch (path) {
          case "/coop/signal":
            return await handleSignalPoll(env, url);
          case "/coop/load":
            return await handleLoad(env, url, now);
          case "/coop/lobby":
            return await handleLobbyList(env, url, now);
          case "/coop/ice":
            return await handleIce(env);
          case "/coop/health":
            return json(env, { ok: true });
        }
        return err(env, "not found", 404);
      }

      // POST routes
      if (request.method === "POST") {
        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return err(env, "invalid JSON body");
        }
        switch (path) {
          case "/coop/create":
            return await handleCreate(env, body, now);
          case "/coop/join":
            return await handleJoin(env, body, now);
          case "/coop/signal":
            return await handleSignalPush(env, body, now);
          case "/coop/heartbeat":
            return await handleHeartbeat(env, body, now);
          case "/coop/save":
            return await handleSave(env, body, now);
          case "/coop/leave":
            return await handleLeave(env, body, now);
          case "/coop/lobby/announce":
            return await handleLobbyAnnounce(env, body, now);
          case "/coop/lobby/pick":
            return await handleLobbyPick(env, body, now);
          case "/coop/lobby/request":
            return await handleLobbyRequest(env, body, now);
          case "/coop/lobby/respond":
            return await handleLobbyRespond(env, body, now);
          case "/coop/lobby/leave":
            return await handleLobbyLeave(env, body);
        }
        return err(env, "not found", 404);
      }

      return err(env, "method not allowed", 405);
    } catch (e) {
      return err(env, `internal error: ${(e as Error).message}`, 500);
    }
  },

  /** Hourly cron: prune runs untouched past their TTL. */
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await ensureSchema(env);
    const now = Date.now();
    const ttl = Number(env.RUN_TTL_MS);
    const ttlMs = Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_RUN_TTL_MS;
    await env.DB.prepare("DELETE FROM coop_runs WHERE updated_at < ?")
      .bind(now - ttlMs)
      .run();
    // Drop abandoned lobby presence rows (stale far past the live-poll window).
    await env.DB.prepare("DELETE FROM coop_lobby WHERE seen_at < ?")
      .bind(now - 5 * 60_000)
      .run();
    await pruneP33Signaling(env, now, ttlMs);
  },
};
