/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/// <reference path="./cloudflare-workers.d.ts" />

// =============================================================================
// Elite Redux — cloud-save + account API (Cloudflare Worker + D1). #229
//
// Implements the subset of the PokéRogue "rogueserver" HTTP contract that the
// ER client already speaks (see src/api/*), so enabling cloud saves needs only:
//   1. deploy this Worker (see README.md),
//   2. point the build's VITE_SERVER_URL at it,
//   3. build with VITE_BYPASS_LOGIN=0.
// The existing in-game login/register UI and save-sync code then "just work".
//
// Auth model: username + password. Passwords are stored only as a PBKDF2-SHA256
// hash. A successful login returns a stateless HMAC-signed token; the client
// sends it back verbatim in the `Authorization` header. Verifying the token is a
// pure HMAC check (no DB read), which keeps request cost low.
//
// Storage: D1 (SQLite). One row per account in `users`, one `system_saves` row
// per user, up to five `session_saves` rows per user. Saves are opaque blobs
// (the client encrypts them); the server never inspects them.
//
// Capacity: the account is on the Workers Paid plan. D1 storage is 10GB per
// database (er-saves sits at ~4% of that; the old free-tier 500MB/db cap no longer
// applies), and the paid write/read budgets (50M D1 writes/mo, ~25B rows read/mo)
// are far above the client's debounced sync (~40 writes/day/active player) — good
// for tens of thousands of daily-active players.
// =============================================================================

import { BiomeId } from "../../../src/enums/biome-id";
import { Challenges } from "../../../src/enums/challenges";
// ER customs live in dedicated high-range enums (moves >= 5000, species >= 10000), registered at
// init by initEliteReduxCustomMoves()/initEliteReduxSpecies(). A resumable co-op checkpoint can carry
// them the instant an ER move/species is ROLLED (RNG-dependent), so the resumable allowlists below MUST
// union the ER enums - see resumableMoveIds/resumableSpeciesIds. Both files are pure value objects.
import { ErMoveId } from "../../../src/enums/er-move-id";
import { ErSpeciesId } from "../../../src/enums/er-species-id";
import { MoveId } from "../../../src/enums/move-id";
import { MysteryEncounterType } from "../../../src/enums/mystery-encounter-type";
import { SpeciesId } from "../../../src/enums/species-id";
import { TrainerType } from "../../../src/enums/trainer-type";
import { TrainerVariant } from "../../../src/enums/trainer-variant";
import {
  applyResultReport,
  finalizeExpiredLoneReport,
  isStakeRecord,
  type MatchRole,
  type ResultReason,
  recordBattlePhaseEntered,
  registerMatch,
  resolveSettlement,
  roleOf,
  type SettlementMutation,
  type ShowdownMatchRecord,
  type StakeRecord,
  voidMatch,
} from "./showdown-escrow";
import {
  applyRankedResult,
  applyRankReport,
  initialRankState,
  MIN_TIER,
  newRankMatch,
  type OpponentWinCount,
  type RankMatchRecord,
  type RankResultEvents,
  type RankRole,
  type RankState,
  type RankTier,
  rankRoleOf,
  reconcileSeason,
  seasonIdFromTime,
} from "./showdown-rank";

interface Env {
  DB: D1Database;
  /** Secret used to sign/verify session tokens. Set via `wrangler secret put`. */
  SESSION_SECRET: string;
  /** Shared only with the co-op signaling Worker; signs short-lived identity tickets. */
  COOP_IDENTITY_SECRET?: string;
  /** Optional ticket lifetime override in milliseconds (default five minutes). */
  COOP_IDENTITY_TTL_MS?: string;
  /** Optional comma-separated origin allowlist; "*" / unset = allow all. */
  ALLOWED_ORIGIN?: string;
  MIN_USERNAME_LENGTH?: string;
  MIN_PASSWORD_LENGTH?: string;
  /** PAT with push access to Heraklines/er-assets (usage-tiers cron). Set via `wrangler secret put`. */
  ER_ASSETS_TOKEN?: string;
  /** Explicit prod-only switch for publishing the shared usage-tiers asset. */
  PUBLISH_USAGE_TIERS?: string;
  /** Deployment marker used to keep staging/dev from publishing global tier data. */
  USAGE_TIER_SOURCE?: string;
  /** Refuse to publish usage tiers from a too-small 30-day sample. */
  USAGE_TIER_MIN_PLAYERS?: string;
  USAGE_TIER_MIN_RUNS?: string;
  /**
   * Shared secret authenticating the er-telemetry tournament worker's server-to-server reward push
   * (POST /showdown/tournament-grant). SAME value must be set on er-telemetry as SHOWDOWN_GRANT_SECRET.
   * Set via `wrangler secret put`. Unset = the tournament-grant route is disabled (503).
   */
  SHOWDOWN_GRANT_SECRET?: string;
}

interface UserRow {
  id: number;
  username: string;
  username_lower: string;
  password_hash: string;
  is_admin: number;
  created_at: number;
  last_login: number | null;
}

/** Decoded session-token payload. */
interface TokenPayload {
  uid: number;
  u: string;
  iat: number;
}

export interface CoopIdentityTicketV1 {
  v: 1;
  /** Opaque, immutable account identity. Consumers must not parse its format. */
  sub: string;
  displayName: string;
  canonicalUsername: string;
  /** Unix epoch milliseconds. */
  exp: number;
  nonce: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_LEN = 32;
/** Max accepted save-blob size (defensive; ER system saves are well under this). */
const MAX_SAVE_BYTES = 4_000_000;
const DEFAULT_COOP_IDENTITY_TTL_MS = 5 * 60_000;

// #region helpers — encoding

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) {
    s += String.fromCharCode(b);
  }
  return btoa(s);
}
function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}
function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64url.length % 4)) % 4);
  return fromBase64(b64);
}

/** Constant-time comparison of two byte arrays. */
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

/**
 * Save compression (#storage). system_saves blobs are JSON that gzips ~12x, and
 * the DB was hitting the D1 500MB cap. Stored form: "GZ1:" + base64(gzip(save)).
 * A plaintext save starts with "{", so reads detect the format unambiguously and
 * legacy plaintext rows keep working until their next write (or the one-time
 * migration) compresses them. Uses the deadlock-safe stream pattern (begin the
 * read before writing) so large saves don't stall on backpressure.
 */
const SAVE_GZIP_PREFIX = "GZ1:";

async function compressSave(plain: string): Promise<string> {
  try {
    const cs = new CompressionStream("gzip");
    const read = new Response(cs.readable).arrayBuffer();
    const writer = cs.writable.getWriter();
    await writer.write(enc.encode(plain));
    await writer.close();
    return SAVE_GZIP_PREFIX + toBase64(new Uint8Array(await read));
  } catch (err) {
    // A compression failure must never break a save: fall back to plaintext.
    console.error("compressSave failed, storing plaintext:", err);
    return plain;
  }
}

async function decompressSave(stored: string): Promise<string> {
  if (!stored.startsWith(SAVE_GZIP_PREFIX)) {
    return stored;
  }
  const ds = new DecompressionStream("gzip");
  const read = new Response(ds.readable).arrayBuffer();
  const writer = ds.writable.getWriter();
  await writer.write(fromBase64(stored.slice(SAVE_GZIP_PREFIX.length)));
  await writer.close();
  return dec.decode(await read);
}

// #endregion
// #region helpers — crypto (passwords + tokens)

async function pbkdf2(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  keyLen: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, keyLen * 8);
  return new Uint8Array(bits);
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LEN);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") {
    return false;
  }
  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations <= 0) {
    return false;
  }
  const salt = fromBase64(parts[2]);
  const expected = fromBase64(parts[3]);
  const actual = await pbkdf2(password, salt, iterations, expected.length);
  return timingSafeEqual(actual, expected);
}

async function hmacSha256(data: Uint8Array<ArrayBuffer>, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return new Uint8Array(sig);
}

async function signToken(payload: TokenPayload, secret: string): Promise<string> {
  const body = toBase64Url(enc.encode(JSON.stringify(payload)));
  const sig = await hmacSha256(enc.encode(body), secret);
  return `${body}.${toBase64Url(sig)}`;
}

async function signCoopIdentityTicket(payload: CoopIdentityTicketV1, secret: string): Promise<string> {
  const body = toBase64Url(enc.encode(JSON.stringify(payload)));
  const sig = await hmacSha256(enc.encode(body), secret);
  return `${body}.${toBase64Url(sig)}`;
}

async function verifyToken(token: string, secret: string): Promise<TokenPayload | null> {
  const dot = token.indexOf(".");
  if (dot <= 0) {
    return null;
  }
  const body = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);
  let providedSig: Uint8Array;
  try {
    providedSig = fromBase64Url(sigPart);
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

// #endregion
// #region helpers — http

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

/** Parse a urlencoded or JSON body into a flat record of strings. */
async function parseFormBody(request: Request): Promise<Record<string, string>> {
  const ct = request.headers.get("Content-Type") ?? "";
  const raw = await request.text();
  if (ct.includes("application/json")) {
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj)) {
        out[k] = String(v);
      }
      return out;
    } catch {
      return {};
    }
  }
  const params = new URLSearchParams(raw);
  const out: Record<string, string> = {};
  for (const [k, v] of params) {
    out[k] = v;
  }
  return out;
}

/** Resolve the authenticated user from the Authorization header, or null. */
async function authUser(request: Request, env: Env): Promise<TokenPayload | null> {
  const header = request.headers.get("Authorization");
  if (!header) {
    return null;
  }
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  if (!token) {
    return null;
  }
  return verifyToken(token, env.SESSION_SECRET);
}

// #endregion
// #region account endpoints

async function handleRegister(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const body = await parseFormBody(request);
  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
  const minUser = Number.parseInt(env.MIN_USERNAME_LENGTH ?? "3", 10) || 3;
  const minPass = Number.parseInt(env.MIN_PASSWORD_LENGTH ?? "6", 10) || 6;

  if (username.length < minUser) {
    return text(`Username must be at least ${minUser} characters.`, 400, cors);
  }
  if (username.length > 30) {
    return text("Username must be at most 30 characters.", 400, cors);
  }
  if (password.length < minPass) {
    return text(`Password must be at least ${minPass} characters.`, 400, cors);
  }
  const usernameLower = username.toLowerCase();
  const existing = await env.DB.prepare("SELECT id FROM users WHERE username_lower = ?").bind(usernameLower).first();
  if (existing) {
    return text("That username is already taken.", 409, cors);
  }
  const passwordHash = await hashPassword(password);
  await env.DB.prepare("INSERT INTO users (username, username_lower, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .bind(username, usernameLower, passwordHash, Date.now())
    .run();
  return text("", 200, cors);
}

async function handleLogin(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const body = await parseFormBody(request);
  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
  if (!username || !password) {
    return text("Username and password are required.", 400, cors);
  }
  const user = await env.DB.prepare("SELECT * FROM users WHERE username_lower = ?")
    .bind(username.toLowerCase())
    .first<UserRow>();
  // Always run a hash comparison to avoid leaking whether the username exists
  // via response timing.
  const ok = user
    ? await verifyPassword(password, user.password_hash)
    : await verifyPassword(password, "pbkdf2$1$AAAA$AAAA").then(() => false);
  if (!user || !ok) {
    return text("Invalid username or password.", 401, cors);
  }
  await env.DB.prepare("UPDATE users SET last_login = ? WHERE id = ?").bind(Date.now(), user.id).run();
  const token = await signToken({ uid: user.id, u: user.username, iat: Date.now() }, env.SESSION_SECRET);
  return json({ token }, 200, cors);
}

async function handleAccountInfo(auth: TokenPayload, env: Env, cors: Record<string, string>): Promise<Response> {
  const user = await env.DB.prepare("SELECT id, username, is_admin FROM users WHERE id = ?")
    .bind(auth.uid)
    .first<Pick<UserRow, "id" | "username" | "is_admin">>();
  if (!user) {
    return text("Account not found.", 404, cors);
  }
  // lastSessionSlot = the MOST RECENTLY SAVED slot (rogueserver semantics).
  // The old MAX(slot) pointed Continue at the highest-numbered slot forever:
  // a player actively saving into slot 0 with any stale run sitting in slot 4
  // got slot 4 back on every page load — Continue resumed the OLD run, the
  // game then autosaved into that old slot, and the player's real run looked
  // like it "stopped saving".
  const slotRow = await env.DB.prepare(
    "SELECT slot FROM session_saves WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1",
  )
    .bind(auth.uid)
    .first<{ slot: number | null }>();
  const lastSessionSlot = slotRow?.slot ?? -1;
  return json(
    {
      accountId: `er-account:${user.id}`,
      username: user.username,
      lastSessionSlot,
      discordId: "",
      googleId: "",
      hasAdminRole: user.is_admin === 1,
    },
    200,
    cors,
  );
}

async function handleCoopIdentityTicket(auth: TokenPayload, env: Env, cors: Record<string, string>): Promise<Response> {
  if (typeof env.COOP_IDENTITY_SECRET !== "string" || env.COOP_IDENTITY_SECRET.length < 32) {
    return text("Co-op identity service unavailable.", 503, cors);
  }
  const user = await env.DB.prepare("SELECT id, username, username_lower FROM users WHERE id = ?")
    .bind(auth.uid)
    .first<Pick<UserRow, "id" | "username" | "username_lower">>();
  if (!user) {
    return text("Account not found.", 404, cors);
  }
  const configuredTtl = Number(env.COOP_IDENTITY_TTL_MS);
  const ttl =
    Number.isSafeInteger(configuredTtl) && configuredTtl >= 30_000 && configuredTtl <= 15 * 60_000
      ? configuredTtl
      : DEFAULT_COOP_IDENTITY_TTL_MS;
  const now = Date.now();
  const payload: CoopIdentityTicketV1 = {
    v: 1,
    sub: `er-account:${user.id}`,
    displayName: user.username,
    canonicalUsername: user.username_lower,
    exp: now + ttl,
    nonce: toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
  };
  return json(
    {
      ticket: await signCoopIdentityTicket(payload, env.COOP_IDENTITY_SECRET),
      identity: {
        version: 1,
        accountId: payload.sub,
        displayName: payload.displayName,
        canonicalUsername: payload.canonicalUsername,
      },
      expiresAt: payload.exp,
    },
    200,
    cors,
  );
}

async function handleChangePassword(
  request: Request,
  auth: TokenPayload,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const body = await parseFormBody(request);
  const password = body.password ?? "";
  const minPass = Number.parseInt(env.MIN_PASSWORD_LENGTH ?? "6", 10) || 6;
  if (password.length < minPass) {
    return text(`Password must be at least ${minPass} characters.`, 400, cors);
  }
  const passwordHash = await hashPassword(password);
  await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(passwordHash, auth.uid).run();
  return json({ success: true }, 200, cors);
}

// #endregion
// #region savedata endpoints

async function readSaveBody(request: Request): Promise<string | null> {
  const raw = await request.text();
  if (enc.encode(raw).length > MAX_SAVE_BYTES) {
    return null;
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Save-clobber guard (KeeganDB92 incident). A wiped/desynced client can upload an
// empty save and clobber a large one under last-write-wins. We reject (409) a
// write whose lifetime gameStats (playTime/battles/pokemonCaught) crash backwards
// versus the stored save, and keep a small rolling backup. Both are
// compression-aware (the stored save is gzip'd, so we decompress before
// comparing; backups store the already-gzip'd blob, ~10x cheaper than before) and
// FAIL OPEN: any unexpected error is logged and the save is allowed through, so
// the guard can never turn a save into a 500.
// ---------------------------------------------------------------------------
const GUARD_MIN_PLAYTIME_S = 60;
const GUARD_PLAYTIME_TOLERANCE_S = 120;
const BACKUP_KEEP = 3;
const BACKUP_MIN_INTERVAL_MS = 2 * 60 * 60 * 1000;

interface SystemProgress {
  playTime: number;
  battles: number;
  caught: number;
}
interface SystemSaveRow {
  data: string;
  trainer_id: number | null;
  secret_id: number | null;
  updated_at: number;
}

/** Lifetime counters from a PLAINTEXT save. null when unparseable (guard fails open). */
function systemProgress(plain: string): SystemProgress | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plain);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const stats = (parsed as { gameStats?: unknown }).gameStats;
  if (!stats || typeof stats !== "object") {
    return null;
  }
  const g = stats as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { playTime: num(g.playTime), battles: num(g.battles), caught: num(g.pokemonCaught) };
}

/** True when `incoming` is a major loss of lifetime progress vs `existing` (both plaintext). */
function isSystemRegression(existingPlain: string, incomingPlain: string): boolean {
  const e = systemProgress(existingPlain);
  const n = systemProgress(incomingPlain);
  if (!e || !n) {
    return false;
  }
  if (e.playTime < GUARD_MIN_PLAYTIME_S) {
    return false;
  }
  const clockWentBack = n.playTime + GUARD_PLAYTIME_TOLERANCE_S < e.playTime;
  const counterDropped = n.battles < e.battles || n.caught < e.caught;
  return clockWentBack && counterDropped;
}

let backupTableReady = false;
async function ensureBackupTable(env: Env): Promise<void> {
  if (backupTableReady) {
    return;
  }
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS system_save_backups (
       id           INTEGER PRIMARY KEY AUTOINCREMENT,
       user_id      INTEGER NOT NULL,
       data         TEXT    NOT NULL,
       trainer_id   INTEGER,
       secret_id    INTEGER,
       saved_at     INTEGER NOT NULL,
       backed_up_at INTEGER NOT NULL
     )`,
  ).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_ssb_user ON system_save_backups (user_id, backed_up_at)").run();
  backupTableReady = true;
}

/**
 * Snapshot the about-to-be-overwritten save (stored form is already gzip'd, so the
 * backup is small) and prune to the most recent BACKUP_KEEP per user. Rate-limited
 * per user. Best-effort: never throws into the caller.
 */
async function maybeBackupSystemSave(env: Env, userId: number, previous: SystemSaveRow): Promise<void> {
  try {
    await ensureBackupTable(env);
    const last = await env.DB.prepare(
      "SELECT backed_up_at FROM system_save_backups WHERE user_id = ?1 ORDER BY backed_up_at DESC LIMIT 1",
    )
      .bind(userId)
      .first<{ backed_up_at: number }>();
    const now = Date.now();
    if (last && now - last.backed_up_at < BACKUP_MIN_INTERVAL_MS) {
      return;
    }
    await env.DB.prepare(
      `INSERT INTO system_save_backups (user_id, data, trainer_id, secret_id, saved_at, backed_up_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
      .bind(userId, previous.data, previous.trainer_id, previous.secret_id, previous.updated_at, now)
      .run();
    await env.DB.prepare(
      `DELETE FROM system_save_backups
         WHERE user_id = ?1
           AND id NOT IN (
             SELECT id FROM system_save_backups WHERE user_id = ?1 ORDER BY backed_up_at DESC LIMIT ?2
           )`,
    )
      .bind(userId, BACKUP_KEEP)
      .run();
  } catch (err) {
    console.error("maybeBackupSystemSave error (skipping backup, save proceeds):", err);
  }
}

/**
 * Gate a system-save overwrite. `incomingPlain` is the client's plaintext save.
 * Returns a 409 Response to block a regression (unless allowReset), else snapshots
 * the previous save and returns null. FAIL OPEN: any error -> allow the save.
 */
async function guardSystemOverwrite(
  env: Env,
  userId: number,
  incomingPlain: string,
  allowReset: boolean,
  cors: Record<string, string>,
): Promise<Response | null> {
  try {
    const existing = await env.DB.prepare(
      "SELECT data, trainer_id, secret_id, updated_at FROM system_saves WHERE user_id = ?1",
    )
      .bind(userId)
      .first<SystemSaveRow>();
    if (!existing) {
      return null;
    }
    const existingPlain = await decompressSave(existing.data);
    if (!allowReset && isSystemRegression(existingPlain, incomingPlain)) {
      return text(
        "Save rejected: incoming save shows major progress loss versus the stored cloud save "
          + "(likely an empty or desynced client). Cloud save preserved - reload to pull it. "
          + "Send ?allowReset=1 to override intentionally.",
        409,
        cors,
      );
    }
    await maybeBackupSystemSave(env, userId, existing);
    return null;
  } catch (err) {
    console.error("guardSystemOverwrite error (allowing save through unguarded):", err);
    return null;
  }
}

async function handleSystemGet(auth: TokenPayload, env: Env, cors: Record<string, string>): Promise<Response> {
  const row = await env.DB.prepare("SELECT data FROM system_saves WHERE user_id = ?")
    .bind(auth.uid)
    .first<{ data: string }>();
  if (!row) {
    return text("Save data not found.", 404, cors);
  }
  try {
    return text(await decompressSave(row.data), 200, cors);
  } catch (err) {
    // Don't hand the client a corrupt/garbage save: report an error so it keeps
    // its in-memory copy. (Should never happen - round-trip is verified.)
    console.error("decompressSave failed on read for user", auth.uid, err);
    return text("Save data could not be read.", 500, cors);
  }
}

async function handleSystemVerify(auth: TokenPayload, env: Env, cors: Record<string, string>): Promise<Response> {
  // No server-side anti-cheat: the authoritative copy is the client's. Report
  // valid so the client keeps its in-memory data (it only replaces it when the
  // server says `valid:false`).
  void auth;
  void env;
  return json({ valid: true, systemData: null }, 200, cors);
}

async function handleSystemUpdate(
  request: Request,
  url: URL,
  auth: TokenPayload,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const data = await readSaveBody(request);
  if (data === null) {
    return text("Save data too large.", 413, cors);
  }
  const guard = await guardSystemOverwrite(env, auth.uid, data, url.searchParams.get("allowReset") === "1", cors);
  if (guard) {
    return guard;
  }
  const stored = await compressSave(data);
  const trainerId = Number.parseInt(url.searchParams.get("trainerId") ?? "", 10);
  const secretId = Number.parseInt(url.searchParams.get("secretId") ?? "", 10);
  await env.DB.prepare(
    `INSERT INTO system_saves (user_id, data, trainer_id, secret_id, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(user_id) DO UPDATE SET data = ?2, trainer_id = ?3, secret_id = ?4, updated_at = ?5`,
  )
    .bind(
      auth.uid,
      stored,
      Number.isFinite(trainerId) ? trainerId : null,
      Number.isFinite(secretId) ? secretId : null,
      Date.now(),
    )
    .run();
  return text("", 200, cors);
}

function parseSlot(url: URL): number | null {
  return parseNamedSlot(url, "slot");
}

function parseNamedSlot(url: URL, name: string): number | null {
  const raw = url.searchParams.get(name) ?? "";
  const slot = /^\d+$/u.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(slot) || slot < 0 || slot > 4) {
    return null;
  }
  return slot;
}

async function handleSessionGet(
  url: URL,
  auth: TokenPayload,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const slot = parseSlot(url);
  if (slot === null) {
    return text("Invalid slot.", 400, cors);
  }
  const row = await env.DB.prepare("SELECT data FROM session_saves WHERE user_id = ? AND slot = ?")
    .bind(auth.uid, slot)
    .first<{ data: string }>();
  if (!row) {
    return text("Session not found.", 404, cors);
  }
  return text(row.data, 200, cors);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

interface CoopRunRef {
  runId: string;
  checkpointRevision: number;
}

export interface CoopSessionRef extends CoopRunRef {
  players: [string, string];
  seats: { host: string; guest: string };
}

const COOP_GAME_MODE_ID = 6;

/**
 * A tombstone for a legacy row whose source revision cannot be interpreted still needs a valid
 * non-negative revision for the public status contract. Zero is a conservative fence-only lower
 * bound; the exact source bytes remain identified by the tombstone digest.
 */
export const COOP_FENCE_ONLY_CHECKPOINT_REVISION = 0;

type SessionProtection = "solo" | "coop-valid" | "coop-invalid" | "unknown";

function coopRunIdFromParsed(parsed: unknown): string | null {
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const coopRun = (parsed as { coopRun?: { runId?: unknown } }).coopRun;
  const runId = coopRun?.runId;
  return typeof runId === "string" && /^[A-Za-z0-9_-]{16,128}$/u.test(runId) ? runId : null;
}

function coopRunFromParsed(parsed: unknown): CoopRunRef | null {
  const runId = coopRunIdFromParsed(parsed);
  if (runId == null) {
    return null;
  }
  const coopRun = (parsed as { coopRun?: { checkpointRevision?: unknown } }).coopRun;
  const checkpointRevision = coopRun?.checkpointRevision;
  return typeof checkpointRevision === "number" && Number.isSafeInteger(checkpointRevision) && checkpointRevision >= 0
    ? { runId, checkpointRevision }
    : null;
}

function normalizeCoopIdentity(identity: string): string {
  return identity.normalize("NFKC").toLowerCase();
}

/** Match the uniqueness key actually used by account registration/login. */
function accountIdentityKey(identity: string): string {
  return identity.toLowerCase();
}

function sameCoopIdentity(left: string, right: string): boolean {
  return normalizeCoopIdentity(left) === normalizeCoopIdentity(right);
}

function sameCoopAccountIdentity(left: string, right: string): boolean {
  return accountIdentityKey(left) === accountIdentityKey(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isObjectArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord);
}

function isSafeIntegerInRange(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

function isFiniteNumberArray(value: unknown, minimumLength: number): value is number[] {
  return (
    Array.isArray(value)
    && value.length >= minimumLength
    && value.every(entry => typeof entry === "number" && Number.isFinite(entry))
  );
}

function numericEnumValues(value: object): Set<number> {
  return new Set(Object.values(value).filter((entry): entry is number => typeof entry === "number"));
}

// CONTRACT (P33 layer-7): every ER-custom enum whose ids can appear in a serialized mon/session MUST be
// unioned into the matching resumable allowlist, or the fail-closed shape check 409s a valid fresh save
// the moment RNG rolls that custom ("incoming resumable co-op checkpoint is invalid"). Today only species
// and moves have ER-custom id enums (ErSpeciesId/ErMoveId); abilities validate abilityIndex (0-2), not an
// id, and there are no ER-custom MysteryEncounterType/Biome/Trainer enums (those extend the vanilla enums
// in place, already covered). Adding a new ER id enum here without extending its set silently re-breaks
// the fresh first-save - the coop-cloud-save-worker-integration test pins one ER id from each enum.
const resumableSpeciesIds = new Set<number>([...numericEnumValues(SpeciesId), ...numericEnumValues(ErSpeciesId)]);
const resumableMoveIds = new Set<number>([...numericEnumValues(MoveId), ...numericEnumValues(ErMoveId)]);
const resumableTrainerTypes = numericEnumValues(TrainerType);
const resumableTrainerVariants = numericEnumValues(TrainerVariant);
const resumableChallengeIds = numericEnumValues(Challenges);
const resumableMysteryEncounterTypes = numericEnumValues(MysteryEncounterType);
const resumableBiomeIds = new Set<number>(Object.values(BiomeId));

function isPokemonMoveDataShape(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isSafeIntegerInRange(value.moveId, 0)
    && resumableMoveIds.has(value.moveId)
    && isSafeIntegerInRange(value.ppUsed, 0)
    && isSafeIntegerInRange(value.ppUp, 0)
    && (value.maxPpOverride === undefined || isSafeIntegerInRange(value.maxPpOverride, 1))
  );
}

/**
 * Minimum current `PokemonData` surface needed by its constructor and `toPokemon()`. This is not a
 * gameplay legality validator; it prevents an object-shaped placeholder from becoming a durable
 * checkpoint that immediately throws at `getPokemonSpecies(undefined)` or constructs unusable stats.
 */
function isPokemonDataShape(value: unknown, expectedPlayer: boolean): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isSafeIntegerInRange(value.id, 0)
    && value.player === expectedPlayer
    && isSafeIntegerInRange(value.species, 1)
    && resumableSpeciesIds.has(value.species)
    && isSafeIntegerInRange(value.formIndex, 0)
    && isSafeIntegerInRange(value.abilityIndex, 0)
    && typeof value.passive === "boolean"
    && typeof value.shiny === "boolean"
    && isSafeIntegerInRange(value.variant, 0)
    && isSafeIntegerInRange(value.level, 1)
    && isFiniteNonNegative(value.exp)
    && isFiniteNonNegative(value.levelExp)
    && isFiniteNonNegative(value.hp)
    && isFiniteNumberArray(value.stats, 6)
    && value.stats.every(stat => stat >= 0)
    && isFiniteNumberArray(value.ivs, 6)
    && value.ivs.every(iv => Number.isSafeInteger(iv) && iv >= 0 && iv <= 31)
    && Array.isArray(value.moveset)
    && value.moveset.every(isPokemonMoveDataShape)
  );
}

function isTrainerType(value: unknown): value is number {
  return isSafeIntegerInRange(value, 0) && resumableTrainerTypes.has(value);
}

function isTrainerDataShape(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isTrainerType(value.trainerType)
    && isSafeIntegerInRange(value.variant, 0)
    && resumableTrainerVariants.has(value.variant)
    && (value.partyTemplateIndex === undefined || isSafeIntegerInRange(value.partyTemplateIndex, 0))
    && (value.nameKey === undefined || typeof value.nameKey === "string")
    && (value.partnerNameKey === undefined || typeof value.partnerNameKey === "string")
  );
}

function isChallengeDataShape(value: unknown): boolean {
  return (
    isRecord(value)
    && isSafeIntegerInRange(value.id, 0)
    && resumableChallengeIds.has(value.id)
    && isSafeIntegerInRange(value.value, 0)
    && isSafeIntegerInRange(value.severity, 0)
    && (value.startingRoots === undefined
      || (Array.isArray(value.startingRoots) && value.startingRoots.every(root => isSafeIntegerInRange(root, 0))))
  );
}

function isPositionalTagShape(value: unknown): boolean {
  if (!isRecord(value) || !isSafeIntegerInRange(value.turnCount, 0) || !isSafeIntegerInRange(value.targetIndex, 0, 5)) {
    return false;
  }
  return value.tagType === "DELAYED_ATTACK"
    ? isSafeIntegerInRange(value.sourceId, 0)
        && isSafeIntegerInRange(value.sourceMove, 0)
        && resumableMoveIds.has(value.sourceMove)
    : value.tagType === "WISH" && isFiniteNonNegative(value.healHp) && typeof value.pokemonName === "string";
}

// `compare-versions`, invoked during parse, throws on a non-semver string.
const resumableGameVersionPattern =
  /^v?\d+(?:\.\d+){0,3}(?:-[\da-z-]+(?:\.[\da-z-]+)*)?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?$/iu;

/**
 * Top-level fields dereferenced by `GameData.parseSessionData()` / `initSessionFromData()` when a
 * checkpoint is materialized. The Worker deliberately does not reproduce every gameplay schema,
 * but it must reject a metadata-only/truncated object that the browser cannot even construct.
 */
function hasCoopSessionMaterializationShape(record: Record<string, unknown>): boolean {
  const arena = record.arena;
  const pokeballCounts = record.pokeballCounts;
  const trainer = record.trainer;
  const mystery = record.mysteryEncounterSaveData;
  const party = record.party;
  const enemyParty = record.enemyParty;
  const battleType = record.battleType;
  const mysteryEncounterType = record.mysteryEncounterType;
  const hasKnownMysteryEncounterType =
    isSafeIntegerInRange(mysteryEncounterType, 0) && resumableMysteryEncounterTypes.has(mysteryEncounterType);
  // A non-combat Mystery Event is the sole legitimate empty-enemy save boundary. It is only
  // executable when the exact event type is retained; `getMysteryEncounter(undefined)` may
  // otherwise select no event (or a queued/daily event different from the saved surface).
  const allowsEmptyEnemyParty = battleType === 3 && hasKnownMysteryEncounterType;
  return (
    typeof record.seed === "string"
    && record.seed.length > 0
    && isFiniteNonNegative(record.playTime)
    && Array.isArray(party)
    && party.length > 0
    && party.every(mon => isPokemonDataShape(mon, true))
    && Array.isArray(enemyParty)
    && (enemyParty.length > 0 || allowsEmptyEnemyParty)
    && enemyParty.every(mon => isPokemonDataShape(mon, false))
    && isObjectArray(record.modifiers)
    && isObjectArray(record.enemyModifiers)
    && isRecord(arena)
    && isSafeIntegerInRange(arena.biome, 0)
    && resumableBiomeIds.has(arena.biome)
    && (arena.weather == null || isRecord(arena.weather))
    && (arena.terrain == null || isRecord(arena.terrain))
    && (arena.tags === undefined || isObjectArray(arena.tags))
    && Array.isArray(arena.positionalTags)
    && arena.positionalTags.every(isPositionalTagShape)
    && isRecord(pokeballCounts)
    && Object.values(pokeballCounts).every(
      value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
    )
    && isFiniteNonNegative(record.money)
    && isFiniteNonNegative(record.score)
    && (battleType === 0 || battleType === 1 || battleType === 3)
    && (trainer == null ? battleType !== 1 : isTrainerDataShape(trainer))
    && typeof record.gameVersion === "string"
    && resumableGameVersionPattern.test(record.gameVersion)
    && Array.isArray(record.challenges)
    && record.challenges.every(isChallengeDataShape)
    && typeof mysteryEncounterType === "number"
    && Number.isSafeInteger(mysteryEncounterType)
    && (battleType === 3
      ? hasKnownMysteryEncounterType
      : mysteryEncounterType === -1 || resumableMysteryEncounterTypes.has(mysteryEncounterType))
    && isRecord(mystery)
    && Array.isArray(mystery.encounteredEvents)
    && isFiniteNonNegative(mystery.encounterSpawnChance)
    && Array.isArray(mystery.queuedEncounters)
    && typeof record.playerFaints === "number"
    && Number.isSafeInteger(record.playerFaints)
    && record.playerFaints >= 0
  );
}

function sameCoopSessionIdentity(left: CoopSessionRef, right: CoopSessionRef): boolean {
  return (
    left.players[0] === right.players[0]
    && left.players[1] === right.players[1]
    && left.seats.host === right.seats.host
    && left.seats.guest === right.seats.guest
  );
}

/**
 * Validate the complete durable shape required by the client resume commitment. A valid run id by
 * itself is deliberately insufficient: storing a checkpoint that neither browser can materialize
 * would turn a recoverable legacy row into an undeletable `coop-valid` row.
 */
function coopSessionFromParsed(parsed: unknown, authenticatedAccount?: string): CoopSessionRef | null {
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const run = coopRunFromParsed(parsed);
  const coopRun = record.coopRun as { version?: unknown } | undefined;
  const participants = record.coopParticipants as
    | {
        version?: unknown;
        players?: unknown;
        seats?: { host?: unknown; guest?: unknown };
      }
    | undefined;
  const players = participants?.players;
  const host = participants?.seats?.host;
  const guest = participants?.seats?.guest;
  if (
    record.gameMode !== COOP_GAME_MODE_ID
    || typeof record.waveIndex !== "number"
    || !Number.isInteger(record.waveIndex)
    || record.waveIndex <= 0
    || typeof record.timestamp !== "number"
    || !Number.isSafeInteger(record.timestamp)
    || record.timestamp < 0
    || run == null
    || coopRun?.version !== 1
    || participants?.version !== 1
    || !Array.isArray(players)
    || players.length !== 2
    || typeof players[0] !== "string"
    || typeof players[1] !== "string"
    || players[0].length === 0
    || players[1].length === 0
    || typeof host !== "string"
    || typeof guest !== "string"
    || host.length === 0
    || guest.length === 0
    || !hasCoopSessionMaterializationShape(record)
  ) {
    return null;
  }
  const first = normalizeCoopIdentity(players[0]);
  const second = normalizeCoopIdentity(players[1]);
  const playerAccountKeys = players.map(accountIdentityKey);
  const hostAccountKey = accountIdentityKey(host);
  const guestAccountKey = accountIdentityKey(guest);
  if (
    first === second
    || first > second
    || sameCoopIdentity(host, guest)
    || ![first, second].includes(normalizeCoopIdentity(host))
    || ![first, second].includes(normalizeCoopIdentity(guest))
    || hostAccountKey === guestAccountKey
    || !playerAccountKeys.includes(hostAccountKey)
    || !playerAccountKeys.includes(guestAccountKey)
    || (authenticatedAccount != null && !players.some(player => sameCoopAccountIdentity(player, authenticatedAccount)))
  ) {
    return null;
  }
  return {
    ...run,
    players: [players[0], players[1]],
    seats: { host, guest },
  };
}

interface CoopAccountRow {
  id: number;
  username: string;
  username_lower: string;
}

function isUnambiguousCoopAccount(row: CoopAccountRow): boolean {
  return (
    accountIdentityKey(row.username) === row.username_lower
    && normalizeCoopIdentity(row.username) === row.username_lower
  );
}

/**
 * Bind username-shaped wire identities back to the authenticated D1 account rows. NFKC is retained
 * for deterministic pair ordering, but is intentionally insufficient for authorization because the
 * account table's uniqueness key is case-insensitive only.
 */
async function validateCoopSessionAccounts(env: Env, auth: TokenPayload, session: CoopSessionRef): Promise<boolean> {
  const actual = await env.DB.prepare("SELECT id, username, username_lower FROM users WHERE id = ?")
    .bind(auth.uid)
    .first<CoopAccountRow>();
  if (actual == null || !isUnambiguousCoopAccount(actual)) {
    return false;
  }
  const firstKey = accountIdentityKey(session.players[0]);
  const secondKey = accountIdentityKey(session.players[1]);
  if (firstKey === secondKey || (actual.username_lower !== firstKey && actual.username_lower !== secondKey)) {
    return false;
  }
  const [first, second] = await Promise.all([
    env.DB.prepare("SELECT id, username, username_lower FROM users WHERE username_lower = ?")
      .bind(firstKey)
      .first<CoopAccountRow>(),
    env.DB.prepare("SELECT id, username, username_lower FROM users WHERE username_lower = ?")
      .bind(secondKey)
      .first<CoopAccountRow>(),
  ]);
  return (
    first != null
    && second != null
    && first.id !== second.id
    && (first.id === actual.id || second.id === actual.id)
    && auth.u === actual.username
    && isUnambiguousCoopAccount(first)
    && isUnambiguousCoopAccount(second)
    && first.username_lower === firstKey
    && second.username_lower === secondKey
    && session.players[0] === first.username
    && session.players[1] === second.username
    && session.seats.host === (accountIdentityKey(session.seats.host) === firstKey ? first.username : second.username)
    && session.seats.guest === (accountIdentityKey(session.seats.guest) === firstKey ? first.username : second.username)
  );
}

/** Complete resumability validation shared by Worker handlers and contract tests. */
export function parseValidResumableCoopSession(
  data: string | null,
  authenticatedAccount?: string,
): CoopSessionRef | null {
  if (data == null) {
    return null;
  }
  try {
    return coopSessionFromParsed(JSON.parse(data) as unknown, authenticatedAccount);
  } catch {
    return null;
  }
}

/** A co-op row is protected whenever it carries a well-formed durable run identity. */
export function parseValidCoopRun(data: string | null): CoopRunRef | null {
  if (data == null) {
    return null;
  }
  try {
    return coopRunFromParsed(JSON.parse(data) as unknown);
  } catch {
    return null;
  }
}

/** Recover a syntax-validated lineage fence even when its legacy revision is unusable. */
function parseTrustedCoopRunId(data: string): string | null {
  try {
    return coopRunIdFromParsed(JSON.parse(data) as unknown);
  } catch {
    return null;
  }
}

/**
 * Legacy mutations may touch only an unambiguously solo row. A parsable save carrying any co-op
 * discriminator is protected even when its durable identity is missing/malformed (including
 * pre-run-id staging checkpoints); only the dedicated CAS path may decide how to recover it.
 */
export function classifySessionProtection(data: string | null): SessionProtection {
  if (data == null) {
    return "solo";
  }
  try {
    const parsed = JSON.parse(data) as unknown;
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "unknown";
    }
    if (coopSessionFromParsed(parsed) != null) {
      return "coop-valid";
    }
    const record = parsed as Record<string, unknown>;
    return record.gameMode === COOP_GAME_MODE_ID
      || Object.hasOwn(record, "coopRun")
      || Object.hasOwn(record, "coopParticipants")
      || Object.hasOwn(record, "coopControlPlane")
      ? "coop-invalid"
      : "solo";
  } catch {
    return "unknown";
  }
}

function isCoopLikeSession(data: string | null): boolean {
  return classifySessionProtection(data) !== "solo";
}

/** SQL used by D1 and by the Node-SQLite contract tests. */
export const COOP_EMPTY_SESSION_INSERT_SQL = `INSERT INTO session_saves (user_id, slot, data, updated_at)
  SELECT ?1, ?2, ?3, ?4
  WHERE NOT EXISTS (
    SELECT 1 FROM coop_run_tombstones_v2 WHERE user_id = ?1 AND run_id = ?5
  )
  AND NOT EXISTS (
    SELECT 1 FROM session_saves
    WHERE user_id = ?1
      AND json_extract(CASE WHEN json_valid(data) THEN data ELSE '{}' END, '$.coopRun.runId') = ?5
  )
  ON CONFLICT(user_id, slot) DO NOTHING`;

export const COOP_EXISTING_SESSION_UPDATE_SQL = `UPDATE session_saves SET data = ?1, updated_at = ?2
  WHERE user_id = ?3 AND slot = ?4 AND data = ?5
    AND NOT EXISTS (
      SELECT 1 FROM coop_run_tombstones_v2 WHERE user_id = ?3 AND run_id = ?6
    )
    AND NOT EXISTS (
      SELECT 1 FROM session_saves AS duplicate
      WHERE duplicate.user_id = ?3 AND duplicate.slot <> ?4
        AND json_extract(
          CASE WHEN json_valid(duplicate.data) THEN duplicate.data ELSE '{}' END,
          '$.coopRun.runId'
        ) = ?6
    )`;

export const COOP_EXACT_SESSION_REPLAY_SQL = `UPDATE session_saves SET updated_at = updated_at
  WHERE user_id = ?1 AND slot = ?2 AND data = ?3
    AND NOT EXISTS (
      SELECT 1 FROM coop_run_tombstones_v2 WHERE user_id = ?1 AND run_id = ?4
    )
    AND NOT EXISTS (
      SELECT 1 FROM session_saves AS duplicate
      WHERE duplicate.user_id = ?1 AND duplicate.slot <> ?2
        AND json_extract(
          CASE WHEN json_valid(duplicate.data) THEN duplicate.data ELSE '{}' END,
          '$.coopRun.runId'
        ) = ?4
    )`;

export const COOP_TOMBSTONE_INSERT_SQL = `INSERT INTO coop_run_tombstones_v2
    (user_id, slot, run_id, checkpoint_revision, digest, deleted_at)
  SELECT ?1, ?2, ?3, ?4, ?5, ?6
  WHERE EXISTS (
    SELECT 1 FROM session_saves WHERE user_id = ?1 AND slot = ?2 AND data = ?7
  )
  AND NOT EXISTS (
    SELECT 1 FROM session_saves AS duplicate
    WHERE duplicate.user_id = ?1 AND duplicate.slot <> ?2
      AND json_extract(
        CASE WHEN json_valid(duplicate.data) THEN duplicate.data ELSE '{}' END,
        '$.coopRun.runId'
      ) = ?3
  )
  ON CONFLICT(user_id, run_id) DO NOTHING`;

export const COOP_TOMBSTONED_SESSION_DELETE_SQL = `DELETE FROM session_saves
  WHERE user_id = ?1 AND slot = ?2 AND data = ?3
    AND EXISTS (
      SELECT 1 FROM coop_run_tombstones_v2
      WHERE user_id = ?1 AND run_id = ?4 AND slot = ?2
        AND checkpoint_revision = ?5 AND digest = ?6
    )`;

export const COOP_LIVE_RUN_ROWS_SQL = `SELECT slot, data FROM session_saves
  WHERE user_id = ?1
    AND json_extract(CASE WHEN json_valid(data) THEN data ELSE '{}' END, '$.coopRun.runId') = ?2
  ORDER BY slot ASC LIMIT 2`;

/**
 * Repair a pre-existing duplicate without ever tombstoning the live run. The exact survivor is part
 * of the delete predicate, so an interleaved survivor update/removal makes this a no-op. Once one
 * row remains, the ordinary unique-run insert predicate fences any delayed recreation of this row.
 */
export const COOP_DUPLICATE_EXACT_DELETE_SQL = `DELETE FROM session_saves
  WHERE user_id = ?1 AND slot = ?2 AND data = ?3
    AND json_extract(CASE WHEN json_valid(data) THEN data ELSE '{}' END, '$.coopRun.runId') = ?4
    AND NOT EXISTS (
      SELECT 1 FROM coop_run_tombstones_v2 WHERE user_id = ?1 AND run_id = ?4
    )
    AND EXISTS (
      SELECT 1 FROM session_saves AS survivor
      WHERE survivor.user_id = ?1 AND survivor.slot = ?5 AND survivor.data = ?6
        AND json_extract(
          CASE WHEN json_valid(survivor.data) THEN survivor.data ELSE '{}' END,
          '$.coopRun.runId'
        ) = ?4
    )`;

export const COOP_DUPLICATE_DELETE_REPLAY_SQL = `UPDATE session_saves SET updated_at = updated_at
  WHERE user_id = ?1 AND slot = ?5 AND data = ?6
    AND json_extract(CASE WHEN json_valid(data) THEN data ELSE '{}' END, '$.coopRun.runId') = ?4
    AND NOT EXISTS (
      SELECT 1 FROM coop_run_tombstones_v2 WHERE user_id = ?1 AND run_id = ?4
    )
    AND NOT EXISTS (
      SELECT 1 FROM session_saves AS removed
      WHERE removed.user_id = ?1 AND removed.slot = ?2
        AND json_extract(
          CASE WHEN json_valid(removed.data) THEN removed.data ELSE '{}' END,
          '$.coopRun.runId'
        ) = ?4
    )`;

export const UPDATE_ALL_CONDITIONAL_SYSTEM_SQL = `INSERT INTO system_saves (user_id, data, updated_at)
  SELECT ?1, ?2, ?3
  WHERE EXISTS (
    SELECT 1 FROM session_saves WHERE user_id = ?1 AND slot = ?4 AND data = ?5
  )
  ON CONFLICT(user_id) DO UPDATE SET data = ?2, updated_at = ?3`;

async function ensureCoopRunTombstones(env: Env): Promise<void> {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS coop_run_tombstones_v2 (
       user_id INTEGER NOT NULL,
       slot INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 4),
       run_id TEXT NOT NULL,
       checkpoint_revision INTEGER NOT NULL CHECK (checkpoint_revision >= 0),
       digest TEXT NOT NULL CHECK (length(digest) = 64),
       deleted_at INTEGER NOT NULL,
       PRIMARY KEY (user_id, run_id)
     )`,
  ).run();
}

async function exactLiveCoopSessionExists(
  env: Env,
  userId: number,
  slot: number,
  data: string,
  runId: string,
): Promise<boolean> {
  const result = await env.DB.prepare(COOP_EXACT_SESSION_REPLAY_SQL).bind(userId, slot, data, runId).run();
  return (result.meta.changes ?? 0) > 0;
}

interface CoopTombstoneRow {
  slot: number;
  checkpoint_revision: number;
  digest: string;
}

async function exactCoopDeleteSettled(
  env: Env,
  userId: number,
  runId: string,
  expected: { slot: number; checkpointRevision: number; digest: string },
): Promise<boolean> {
  const [tombstoneResult, liveResult] = await env.DB.batch([
    env.DB.prepare(
      `SELECT slot, checkpoint_revision, digest FROM coop_run_tombstones_v2
       WHERE user_id = ? AND run_id = ?`,
    ).bind(userId, runId),
    env.DB.prepare(COOP_LIVE_RUN_ROWS_SQL).bind(userId, runId),
  ]);
  const tombstone = (tombstoneResult?.results?.[0] ?? null) as CoopTombstoneRow | null;
  return (
    exactCoopDeleteReplaySatisfied(
      tombstone == null
        ? null
        : {
            slot: tombstone.slot,
            checkpointRevision: tombstone.checkpoint_revision,
            digest: tombstone.digest,
          },
      expected,
    ) && (liveResult?.results?.length ?? 0) === 0
  );
}

/** Exact lost-response idempotence rule for first-save empty-slot CAS. */
export function coopEmptySessionCasSatisfied(
  insertedChanges: number,
  existingData: string | null,
  incomingData: string,
): boolean {
  return insertedChanges > 0 || existingData === incomingData;
}

export function exactSessionWriteSatisfied(changes: number, readback: string | null, incoming: string): boolean {
  return changes > 0 || readback === incoming;
}

export function exactSessionDeleteSatisfied(changes: number, readback: string | null): boolean {
  return changes > 0 || readback == null;
}

export function coopTombstoneBlocksRun(tombstonedRunId: string | null, incomingRunId: string): boolean {
  return tombstonedRunId === incomingRunId;
}

export function exactCoopDeleteReplaySatisfied(
  tombstone: { slot: number; checkpointRevision: number; digest: string } | null,
  expected: { slot: number; checkpointRevision: number; digest: string },
): boolean {
  return (
    tombstone?.slot === expected.slot
    && tombstone.checkpointRevision === expected.checkpointRevision
    && tombstone.digest === expected.digest
  );
}

async function handleSessionUpdate(
  request: Request,
  url: URL,
  auth: TokenPayload,
  env: Env,
  cors: Record<string, string>,
  allowCoopCas = false,
): Promise<Response> {
  const slot = parseSlot(url);
  if (slot === null) {
    return text("Invalid slot.", 400, cors);
  }
  const data = await readSaveBody(request);
  if (data === null) {
    return text("Save data too large.", 413, cors);
  }
  const casMode = url.searchParams.get("coopCasMode");
  if (!allowCoopCas && casMode != null) {
    return text("Co-op session CAS requires the dedicated endpoint.", 409, cors);
  }
  let incomingCoopRun: CoopSessionRef | null = null;
  if (casMode === "empty" || casMode === "existing") {
    incomingCoopRun = parseValidResumableCoopSession(data);
    if (incomingCoopRun == null || !(await validateCoopSessionAccounts(env, auth, incomingCoopRun))) {
      return text("Session CAS conflict: incoming resumable co-op checkpoint is invalid.", 409, cors);
    }
    await ensureCoopRunTombstones(env);
  }
  if (casMode === "empty") {
    const result = await env.DB.prepare(COOP_EMPTY_SESSION_INSERT_SQL)
      .bind(auth.uid, slot, data, Date.now(), incomingCoopRun!.runId)
      .run();
    if ((result.meta.changes ?? 0) > 0) {
      return text("", 200, cors);
    }
    // A byte-identical retry is success only while one atomic write predicate proves the run is
    // live, unique account-wide, and not tombstoned. A plain readback would reopen delete->insert.
    return (await exactLiveCoopSessionExists(env, auth.uid, slot, data, incomingCoopRun!.runId))
      ? text("", 200, cors)
      : text("Session CAS conflict: expected an empty, untombstoned, unique run slot.", 409, cors);
  }
  if (casMode === "existing") {
    const expectedRunId = url.searchParams.get("coopCasRunId") ?? "";
    const expectedRevisionRaw = url.searchParams.get("coopCasCheckpointRevision") ?? "";
    const expectedRevision = /^\d+$/u.test(expectedRevisionRaw) ? Number(expectedRevisionRaw) : Number.NaN;
    const expectedDigest = url.searchParams.get("coopCasDigest") ?? "";
    const incomingDigest = await sha256Hex(data);
    if (
      incomingCoopRun?.runId !== expectedRunId
      || !Number.isSafeInteger(expectedRevision)
      || expectedRevision < 0
      || !/^[0-9a-f]{64}$/u.test(expectedDigest)
      || incomingCoopRun.checkpointRevision < expectedRevision
      || (incomingCoopRun.checkpointRevision === expectedRevision && incomingDigest !== expectedDigest)
    ) {
      return text("Session CAS conflict: incoming checkpoint does not advance the expected run.", 409, cors);
    }
    const row = await env.DB.prepare("SELECT data FROM session_saves WHERE user_id = ? AND slot = ?")
      .bind(auth.uid, slot)
      .first<{ data: string }>();
    if (row == null) {
      return text("Session CAS conflict: expected checkpoint missing.", 409, cors);
    }
    // Direct request replay after a committed-but-lost response. Validate through the same atomic
    // tombstone/uniqueness predicate rather than rejecting on the now-advanced stored revision.
    if (row.data === data) {
      return (await exactLiveCoopSessionExists(env, auth.uid, slot, data, incomingCoopRun!.runId))
        ? text("", 200, cors)
        : text("Session CAS conflict: exact checkpoint is deleted or duplicated.", 409, cors);
    }
    const existing = parseValidResumableCoopSession(row.data);
    if (
      existing?.runId !== expectedRunId
      || existing.checkpointRevision !== expectedRevision
      || !sameCoopSessionIdentity(existing, incomingCoopRun!)
      || !(await validateCoopSessionAccounts(env, auth, existing))
      || !/^[0-9a-f]{64}$/u.test(expectedDigest)
      || (await sha256Hex(row.data)) !== expectedDigest
    ) {
      return text("Session CAS conflict: checkpoint changed.", 409, cors);
    }
    // Exact-row WHERE closes the read->write race: a concurrent tab/device mutation makes changes=0.
    const result = await env.DB.prepare(COOP_EXISTING_SESSION_UPDATE_SQL)
      .bind(data, Date.now(), auth.uid, slot, row.data, incomingCoopRun!.runId)
      .run();
    if ((result.meta.changes ?? 0) > 0) {
      return text("", 200, cors);
    }
    return (await exactLiveCoopSessionExists(env, auth.uid, slot, data, incomingCoopRun!.runId))
      ? text("", 200, cors)
      : text("Session CAS conflict: checkpoint changed during update.", 409, cors);
  }
  const existing = await env.DB.prepare("SELECT data FROM session_saves WHERE user_id = ? AND slot = ?")
    .bind(auth.uid, slot)
    .first<{ data: string }>();
  if (isCoopLikeSession(existing?.data ?? null) || isCoopLikeSession(data)) {
    return text("Co-op session writes require compare-and-swap.", 409, cors);
  }
  const result =
    existing == null
      ? await env.DB.prepare(
          `INSERT INTO session_saves (user_id, slot, data, updated_at)
         VALUES (?1, ?2, ?3, ?4) ON CONFLICT(user_id, slot) DO NOTHING`,
        )
          .bind(auth.uid, slot, data, Date.now())
          .run()
      : await env.DB.prepare(
          `UPDATE session_saves SET data = ?1, updated_at = ?2
         WHERE user_id = ?3 AND slot = ?4 AND data = ?5`,
        )
          .bind(data, Date.now(), auth.uid, slot, existing.data)
          .run();
  if ((result.meta.changes ?? 0) > 0) {
    return text("", 200, cors);
  }
  const readback = await env.DB.prepare("SELECT data FROM session_saves WHERE user_id = ? AND slot = ?")
    .bind(auth.uid, slot)
    .first<{ data: string }>();
  return exactSessionWriteSatisfied(0, readback?.data ?? null, data)
    ? text("", 200, cors)
    : text("Session changed during legacy update.", 409, cors);
}

async function handleCoopSessionCasUpdate(
  request: Request,
  url: URL,
  auth: TokenPayload,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const casMode = url.searchParams.get("coopCasMode");
  if (casMode !== "empty" && casMode !== "existing") {
    return text("Session CAS mode is required.", 400, cors);
  }
  return handleSessionUpdate(request, url, auth, env, cors, true);
}

async function handleCoopSessionCasDelete(
  url: URL,
  auth: TokenPayload,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const slot = parseSlot(url);
  const expectedRunId = url.searchParams.get("coopCasRunId") ?? "";
  const expectedRevisionRaw = url.searchParams.get("coopCasCheckpointRevision") ?? "";
  const expectedRevision = /^\d+$/u.test(expectedRevisionRaw) ? Number(expectedRevisionRaw) : Number.NaN;
  const expectedDigest = url.searchParams.get("coopCasDigest") ?? "";
  if (
    slot == null
    || !/^[A-Za-z0-9_-]{16,128}$/u.test(expectedRunId)
    || !Number.isSafeInteger(expectedRevision)
    || expectedRevision < 0
    || !/^[0-9a-f]{64}$/u.test(expectedDigest)
  ) {
    return text("Invalid co-op delete commitment.", 400, cors);
  }
  await ensureCoopRunTombstones(env);
  const expected = { slot, checkpointRevision: expectedRevision, digest: expectedDigest };
  if (await exactCoopDeleteSettled(env, auth.uid, expectedRunId, expected)) {
    return text("", 200, cors);
  }
  const row = await env.DB.prepare("SELECT data FROM session_saves WHERE user_id = ? AND slot = ?")
    .bind(auth.uid, slot)
    .first<{ data: string }>();
  // Deletion is deliberately scoped by `auth.uid` + exact slot/revision/digest, rather than requiring
  // the peer account to remain resolvable. This is the fail-closed escape hatch for an already-stored
  // structurally valid checkpoint whose peer was missing or whose legacy identity was ambiguous.
  const run = parseValidResumableCoopSession(row?.data ?? null);
  if (row == null) {
    return text("Session CAS conflict: checkpoint missing without exact tombstone.", 409, cors);
  }
  if (
    run?.runId !== expectedRunId
    || run.checkpointRevision !== expectedRevision
    || (await sha256Hex(row.data)) !== expectedDigest
  ) {
    return text("Session CAS conflict: checkpoint changed before delete.", 409, cors);
  }
  const now = Date.now();
  const results = await env.DB.batch([
    env.DB.prepare(COOP_TOMBSTONE_INSERT_SQL).bind(
      auth.uid,
      slot,
      expectedRunId,
      expectedRevision,
      expectedDigest,
      now,
      row.data,
    ),
    env.DB.prepare(COOP_TOMBSTONED_SESSION_DELETE_SQL).bind(
      auth.uid,
      slot,
      row.data,
      expectedRunId,
      expectedRevision,
      expectedDigest,
    ),
  ]);
  return (results[1]?.meta.changes ?? 0) > 0 && (await exactCoopDeleteSettled(env, auth.uid, expectedRunId, expected))
    ? text("", 200, cors)
    : text("Session CAS conflict: checkpoint changed during delete.", 409, cors);
}

async function handleCoopDuplicateExactDelete(
  url: URL,
  auth: TokenPayload,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const slot = parseSlot(url);
  const survivorSlot = parseNamedSlot(url, "survivorSlot");
  const runId = url.searchParams.get("coopCasRunId") ?? "";
  const revisionRaw = url.searchParams.get("coopCasCheckpointRevision") ?? "";
  const revision = /^\d+$/u.test(revisionRaw) ? Number(revisionRaw) : Number.NaN;
  const digest = url.searchParams.get("coopCasDigest") ?? "";
  const survivorRevisionRaw = url.searchParams.get("survivorCheckpointRevision") ?? "";
  const survivorRevision = /^\d+$/u.test(survivorRevisionRaw) ? Number(survivorRevisionRaw) : Number.NaN;
  const survivorDigest = url.searchParams.get("survivorDigest") ?? "";
  if (
    slot == null
    || survivorSlot == null
    || slot === survivorSlot
    || !/^[A-Za-z0-9_-]{16,128}$/u.test(runId)
    || !Number.isSafeInteger(revision)
    || revision < 0
    || !/^[0-9a-f]{64}$/u.test(digest)
    || !Number.isSafeInteger(survivorRevision)
    || survivorRevision < 0
    || !/^[0-9a-f]{64}$/u.test(survivorDigest)
  ) {
    return text("Invalid co-op duplicate recovery commitment.", 400, cors);
  }
  await ensureCoopRunTombstones(env);
  const survivor = await env.DB.prepare("SELECT data FROM session_saves WHERE user_id = ? AND slot = ?")
    .bind(auth.uid, survivorSlot)
    .first<{ data: string }>();
  const survivorRun = parseValidResumableCoopSession(survivor?.data ?? null);
  if (
    survivor == null
    || survivorRun?.runId !== runId
    || survivorRun.checkpointRevision !== survivorRevision
    || (await sha256Hex(survivor.data)) !== survivorDigest
    || !(await validateCoopSessionAccounts(env, auth, survivorRun))
    || survivorRevision < revision
    || (survivorRevision === revision && survivorDigest !== digest)
  ) {
    return text("Session CAS conflict: exact duplicate survivor changed.", 409, cors);
  }

  const replay = async (): Promise<boolean> => {
    const result = await env.DB.prepare(COOP_DUPLICATE_DELETE_REPLAY_SQL)
      .bind(auth.uid, slot, "", runId, survivorSlot, survivor.data)
      .run();
    return (result.meta.changes ?? 0) > 0;
  };
  if (await replay()) {
    return text("", 200, cors);
  }

  const duplicate = await env.DB.prepare("SELECT data FROM session_saves WHERE user_id = ? AND slot = ?")
    .bind(auth.uid, slot)
    .first<{ data: string }>();
  const duplicateRun = parseValidResumableCoopSession(duplicate?.data ?? null);
  if (
    duplicate == null
    || duplicateRun?.runId !== runId
    || duplicateRun.checkpointRevision !== revision
    || (await sha256Hex(duplicate.data)) !== digest
    || !sameCoopSessionIdentity(duplicateRun, survivorRun)
    || !(await validateCoopSessionAccounts(env, auth, duplicateRun))
  ) {
    return text("Session CAS conflict: exact duplicate row changed.", 409, cors);
  }
  const result = await env.DB.prepare(COOP_DUPLICATE_EXACT_DELETE_SQL)
    .bind(auth.uid, slot, duplicate.data, runId, survivorSlot, survivor.data)
    .run();
  if ((result.meta.changes ?? 0) > 0 || (await replay())) {
    return text("", 200, cors);
  }
  return text("Session CAS conflict: duplicate recovery lost its exact survivor.", 409, cors);
}

async function handleCoopRunStatus(
  url: URL,
  auth: TokenPayload,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const runId = url.searchParams.get("coopRunId") ?? "";
  const requestedSlot = url.searchParams.get("slot");
  if (!/^[A-Za-z0-9_-]{16,128}$/u.test(runId) || (requestedSlot != null && parseSlot(url) == null)) {
    return text("Invalid co-op run status request.", 400, cors);
  }
  await ensureCoopRunTombstones(env);
  const [tombstoneResult, liveResult] = await env.DB.batch([
    env.DB.prepare(
      `SELECT slot, checkpoint_revision, digest FROM coop_run_tombstones_v2
       WHERE user_id = ? AND run_id = ?`,
    ).bind(auth.uid, runId),
    env.DB.prepare(COOP_LIVE_RUN_ROWS_SQL).bind(auth.uid, runId),
  ]);
  const tombstone = (tombstoneResult?.results?.[0] ?? null) as CoopTombstoneRow | null;
  const live = (liveResult?.results ?? []) as { slot: number; data: string }[];
  if (tombstone != null && live.length === 0) {
    return json(
      {
        state: "tombstoned",
        runId,
        slot: tombstone.slot,
        checkpointRevision: tombstone.checkpoint_revision,
        digest: tombstone.digest,
      },
      200,
      cors,
    );
  }
  if (tombstone == null && live.length === 0) {
    return json({ state: "missing", runId }, 200, cors);
  }
  if (tombstone != null || live.length !== 1) {
    return text("Session CAS conflict: co-op run has contradictory account state.", 409, cors);
  }
  const active = parseValidResumableCoopSession(live[0].data);
  if (active?.runId !== runId || !(await validateCoopSessionAccounts(env, auth, active))) {
    return text("Session CAS conflict: active co-op run identity is invalid.", 409, cors);
  }
  return json(
    {
      state: "active",
      runId,
      slot: live[0].slot,
      checkpointRevision: active.checkpointRevision,
      digest: await sha256Hex(live[0].data),
    },
    200,
    cors,
  );
}

/**
 * Recovery-only deletion for an opaque/corrupt row that cannot be proven solo or co-op. The caller
 * must first read and hash the exact bytes; valid/co-op-like JSON is deliberately ineligible so this
 * endpoint can never bypass the co-op tombstone protocol.
 */
async function handleClassifiedSessionExactDelete(
  url: URL,
  auth: TokenPayload,
  env: Env,
  cors: Record<string, string>,
  expectedProtection: "unknown" | "coop-invalid",
  label: "opaque" | "legacy co-op",
): Promise<Response> {
  const slot = parseSlot(url);
  const expectedDigest = url.searchParams.get("exactDigest") ?? "";
  if (slot == null || !/^[0-9a-f]{64}$/u.test(expectedDigest)) {
    return text(`Invalid ${label} session delete commitment.`, 400, cors);
  }
  const row = await env.DB.prepare("SELECT data FROM session_saves WHERE user_id = ? AND slot = ?")
    .bind(auth.uid, slot)
    .first<{ data: string }>();
  if (row == null) {
    return text("", 200, cors);
  }
  if (classifySessionProtection(row.data) !== expectedProtection) {
    return text(`${label} exact delete cannot remove a differently classified session.`, 409, cors);
  }
  if ((await sha256Hex(row.data)) !== expectedDigest) {
    return text(`${label} session changed before exact delete.`, 409, cors);
  }
  const strandedRun = expectedProtection === "coop-invalid" ? parseValidCoopRun(row.data) : null;
  const strandedRunId =
    expectedProtection === "coop-invalid" ? (strandedRun?.runId ?? parseTrustedCoopRunId(row.data)) : null;
  if (strandedRunId != null) {
    // A structurally invalid checkpoint can still carry trustworthy, exact run metadata. Preserve
    // the same resurrection fence as a fully materializable checkpoint: the tombstone insert and
    // byte-exact delete execute in one D1 batch, while duplicate live copies make both fail closed.
    await ensureCoopRunTombstones(env);
    const now = Date.now();
    const checkpointRevision = strandedRun?.checkpointRevision ?? COOP_FENCE_ONLY_CHECKPOINT_REVISION;
    const expected = {
      slot,
      checkpointRevision,
      digest: expectedDigest,
    };
    await env.DB.batch([
      env.DB.prepare(COOP_TOMBSTONE_INSERT_SQL).bind(
        auth.uid,
        slot,
        strandedRunId,
        checkpointRevision,
        expectedDigest,
        now,
        row.data,
      ),
      env.DB.prepare(COOP_TOMBSTONED_SESSION_DELETE_SQL).bind(
        auth.uid,
        slot,
        row.data,
        strandedRunId,
        checkpointRevision,
        expectedDigest,
      ),
    ]);
    return (await exactCoopDeleteSettled(env, auth.uid, strandedRunId, expected))
      ? text("", 200, cors)
      : text(`${label} session changed during tombstoned exact delete.`, 409, cors);
  }
  const result = await env.DB.prepare("DELETE FROM session_saves WHERE user_id = ?1 AND slot = ?2 AND data = ?3")
    .bind(auth.uid, slot, row.data)
    .run();
  if ((result.meta.changes ?? 0) > 0) {
    return text("", 200, cors);
  }
  const readback = await env.DB.prepare("SELECT data FROM session_saves WHERE user_id = ? AND slot = ?")
    .bind(auth.uid, slot)
    .first<{ data: string }>();
  return exactSessionDeleteSatisfied(0, readback?.data ?? null)
    ? text("", 200, cors)
    : text(`${label} session changed during exact delete.`, 409, cors);
}

async function handleOpaqueSessionExactDelete(
  url: URL,
  auth: TokenPayload,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  return handleClassifiedSessionExactDelete(url, auth, env, cors, "unknown", "opaque");
}

async function handleLegacyCoopSessionExactDelete(
  url: URL,
  auth: TokenPayload,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  return handleClassifiedSessionExactDelete(url, auth, env, cors, "coop-invalid", "legacy co-op");
}

async function handleSessionDelete(
  url: URL,
  auth: TokenPayload,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const slot = parseSlot(url);
  if (slot === null) {
    return text("Invalid slot.", 400, cors);
  }
  const existing = await env.DB.prepare("SELECT data FROM session_saves WHERE user_id = ? AND slot = ?")
    .bind(auth.uid, slot)
    .first<{ data: string }>();
  if (isCoopLikeSession(existing?.data ?? null)) {
    return text("Co-op session deletes require compare-and-swap.", 409, cors);
  }
  if (existing == null) {
    return text("", 200, cors);
  }
  const result = await env.DB.prepare("DELETE FROM session_saves WHERE user_id = ? AND slot = ? AND data = ?")
    .bind(auth.uid, slot, existing.data)
    .run();
  if ((result.meta.changes ?? 0) > 0) {
    return text("", 200, cors);
  }
  const readback = await env.DB.prepare("SELECT data FROM session_saves WHERE user_id = ? AND slot = ?")
    .bind(auth.uid, slot)
    .first<{ data: string }>();
  return exactSessionDeleteSatisfied(0, readback?.data ?? null)
    ? text("", 200, cors)
    : text("Session changed during legacy delete.", 409, cors);
}

async function handleSessionClear(
  request: Request,
  url: URL,
  auth: TokenPayload,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const slot = parseSlot(url);
  if (slot === null) {
    return json({ success: false, error: "Invalid slot." }, 400, cors);
  }
  // "Clear" = the run is FINISHED (victory or defeat) — DELETE the session row,
  // matching rogueserver semantics. The previous implementation UPSERTED the
  // final session instead, so the dead run survived server-side: /account/info
  // (lastSessionSlot = MAX(slot)) kept pointing at it, the menu offered
  // "Continue", and loading the all-fainted party instantly game-overed back to
  // the title in a loop. Run history for ghosts/analytics is captured separately
  // via POST /savedata/run, so nothing is lost by deleting here.
  const incoming = await readSaveBody(request); // drain the request body (final session)
  if (incoming == null) {
    return json({ success: false, error: "Save data too large." }, 413, cors);
  }
  const existing = await env.DB.prepare("SELECT data FROM session_saves WHERE user_id = ? AND slot = ?")
    .bind(auth.uid, slot)
    .first<{ data: string }>();
  if (isCoopLikeSession(existing?.data ?? null) || isCoopLikeSession(incoming)) {
    return json({ success: false, error: "Co-op session clears require compare-and-swap." }, 409, cors);
  }
  if (existing == null) {
    return json({ success: true }, 200, cors);
  }
  const result = await env.DB.prepare("DELETE FROM session_saves WHERE user_id = ? AND slot = ? AND data = ?")
    .bind(auth.uid, slot, existing.data)
    .run();
  if ((result.meta.changes ?? 0) > 0) {
    return json({ success: true }, 200, cors);
  }
  const readback = await env.DB.prepare("SELECT data FROM session_saves WHERE user_id = ? AND slot = ?")
    .bind(auth.uid, slot)
    .first<{ data: string }>();
  return exactSessionDeleteSatisfied(0, readback?.data ?? null)
    ? json({ success: true }, 200, cors)
    : json({ success: false, error: "Session changed during legacy clear." }, 409, cors);
}

async function handleUpdateAll(
  request: Request,
  auth: TokenPayload,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const raw = await readSaveBody(request);
  if (raw === null) {
    return text("Save data too large.", 413, cors);
  }
  let payload: { system?: unknown; session?: unknown; sessionSlotId?: unknown };
  try {
    payload = JSON.parse(raw);
  } catch {
    return text("Invalid save data.", 400, cors);
  }
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  let sessionMutation: { index: number; slot: number; data: string } | null = null;
  let storedSystem: string | null = null;
  if (payload.system !== undefined && payload.system !== null) {
    const sys = typeof payload.system === "string" ? payload.system : JSON.stringify(payload.system);
    const allowReset = new URL(request.url).searchParams.get("allowReset") === "1";
    const guard = await guardSystemOverwrite(env, auth.uid, sys, allowReset, cors);
    if (guard) {
      return guard;
    }
    storedSystem = await compressSave(sys);
  }
  const slotRaw = String(payload.sessionSlotId ?? "");
  const slot = /^\d+$/u.test(slotRaw) ? Number(slotRaw) : Number.NaN;
  const sessionPayload = payload.session;
  const hasSession = sessionPayload !== undefined && sessionPayload !== null;
  if (hasSession && (!Number.isSafeInteger(slot) || slot < 0 || slot > 4)) {
    return text("Invalid session slot in updateAll.", 400, cors);
  }
  if (hasSession) {
    const sess = typeof sessionPayload === "string" ? sessionPayload : JSON.stringify(sessionPayload);
    const existing = await env.DB.prepare("SELECT data FROM session_saves WHERE user_id = ? AND slot = ?")
      .bind(auth.uid, slot)
      .first<{ data: string }>();
    if (isCoopLikeSession(existing?.data ?? null) || isCoopLikeSession(sess)) {
      return text("Co-op session updateAll writes require compare-and-swap.", 409, cors);
    }
    const statement =
      existing == null
        ? env.DB.prepare(
            `INSERT INTO session_saves (user_id, slot, data, updated_at)
           VALUES (?1, ?2, ?3, ?4) ON CONFLICT(user_id, slot) DO NOTHING`,
          ).bind(auth.uid, slot, sess, now)
        : env.DB.prepare(
            `UPDATE session_saves SET data = ?1, updated_at = ?2
           WHERE user_id = ?3 AND slot = ?4 AND data = ?5`,
          ).bind(sess, now, auth.uid, slot, existing.data);
    sessionMutation = { index: stmts.length, slot, data: sess };
    stmts.push(statement);
  }
  let systemMutationIndex: number | null = null;
  if (storedSystem != null) {
    systemMutationIndex = stmts.length;
    stmts.push(
      sessionMutation == null
        ? env.DB.prepare(
            `INSERT INTO system_saves (user_id, data, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(user_id) DO UPDATE SET data = ?2, updated_at = ?3`,
          ).bind(auth.uid, storedSystem, now)
        : env.DB.prepare(UPDATE_ALL_CONDITIONAL_SYSTEM_SQL).bind(
            auth.uid,
            storedSystem,
            now,
            sessionMutation.slot,
            sessionMutation.data,
          ),
    );
  }
  if (stmts.length > 0) {
    const results = await env.DB.batch(stmts);
    if (sessionMutation != null) {
      const sessionChanged = (results[sessionMutation.index]?.meta.changes ?? 0) > 0;
      const systemChanged = systemMutationIndex == null || (results[systemMutationIndex]?.meta.changes ?? 0) > 0;
      if (sessionChanged && !systemChanged) {
        return text("System save did not commit with the accepted session update.", 500, cors);
      }
      if (sessionChanged) {
        return text("", 200, cors);
      }
      const readback = await env.DB.prepare("SELECT data FROM session_saves WHERE user_id = ? AND slot = ?")
        .bind(auth.uid, sessionMutation.slot)
        .first<{ data: string }>();
      if (!systemChanged || !exactSessionWriteSatisfied(0, readback?.data ?? null, sessionMutation.data)) {
        return text("Session changed during updateAll.", 409, cors);
      }
    }
  }
  return text("", 200, cors);
}

// #endregion
// #region misc endpoints

// "Players online" = distinct accounts whose save was written in the last 5
// minutes (the client autosaves while playing), NOT total registered accounts.
// Cached for 60s via the Cache API so the underlying COUNT runs at most once per
// minute regardless of how many clients poll — keeps us well under D1 read quota.
const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const TITLE_STATS_CACHE_KEY = "https://er-save-api.internal/__title-stats";

async function handleTitleStats(env: Env, cors: Record<string, string>): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request(TITLE_STATS_CACHE_KEY);

  const hit = await cache.match(cacheKey);
  if (hit) {
    return json(JSON.parse(await hit.text()) as unknown, 200, cors);
  }

  const cutoff = Date.now() - ONLINE_WINDOW_MS;
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM (
       SELECT user_id FROM session_saves WHERE updated_at > ?1
       UNION
       SELECT user_id FROM system_saves  WHERE updated_at > ?1
     )`,
  )
    .bind(cutoff)
    .first<{ c: number }>();

  const payload = { playerCount: row?.c ?? 0, battleCount: 0 };
  // Store under a 60s TTL (Cache API honours Cache-Control max-age).
  await cache.put(
    cacheKey,
    new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json", "Cache-Control": "max-age=60" },
    }),
  );
  return json(payload, 200, cors);
}

function handleDailySeed(cors: Record<string, string>): Response {
  // Deterministic per-UTC-day seed (daily challenges aren't run server-side in
  // ER, but the client may request one). 24-char alnum, like the run seed.
  const day = Math.floor(Date.now() / 86_400_000);
  let seed = "";
  let n = day;
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  for (let i = 0; i < 24; i++) {
    n = (n * 1103515245 + 12345) & 0x7fffffff;
    seed += alphabet[n % alphabet.length];
  }
  return text(seed, 200, cors);
}

// #endregion
// #region run history (ghost-team pool + analytics)

/** Record a finished run (win or loss). Idempotent by client-generated `id`. */
async function handleRunCreate(
  request: Request,
  auth: TokenPayload,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const raw = await readSaveBody(request);
  if (raw === null) {
    return text("Run data too large.", 413, cors);
  }
  let run: {
    id?: unknown;
    outcome?: unknown;
    isVictory?: unknown;
    difficulty?: unknown;
    mode?: unknown;
    wave?: unknown;
    waveReached?: unknown;
    timestamp?: unknown;
    party?: unknown;
    opponentName?: unknown;
    opponentParty?: unknown;
    starters?: unknown;
    challenges?: unknown;
    killedByGhost?: unknown;
    ghostSourceName?: unknown;
    ghostSourceRunId?: unknown;
    /** ER Ghost Trainer Editor: the uploader's authored presentation blob (additive/optional). */
    presentation?: unknown;
    /** ER (relics): the run's active relics at capture, records-only (additive/optional). */
    relics?: unknown;
    /** ER ghost notifications: every ghost this run fought (additive/optional). */
    ghostsFought?: unknown;
  };
  try {
    run = JSON.parse(raw);
  } catch {
    return text("Invalid run data.", 400, cors);
  }
  const id = typeof run.id === "string" && run.id.length > 0 ? run.id : null;
  const party = Array.isArray(run.party) ? run.party : null;
  if (!id || !party) {
    return text("Run is missing id or party.", 400, cors);
  }
  // Sanitize IVs on the way in - clamp each member's IVs to the legal 0..31. Legit IVs
  // never exceed 31, so this is a no-op for honest runs; for a hacked save (IV 999 ->
  // ~2000-stat ghost) it neutralizes the team WITHOUT rejecting the upload (a hard reject
  // would just have cheaters' clients retry-spam). The run is still stored for stats; it
  // just can't be fielded as an unbeatable ghost.
  for (const member of party) {
    const ivs = (member as { ivs?: unknown })?.ivs;
    if (Array.isArray(ivs)) {
      (member as { ivs: number[] }).ivs = ivs.map(iv => {
        const n = Math.floor(Number(iv));
        return Number.isFinite(n) ? Math.max(0, Math.min(31, n)) : 0;
      });
    }
  }
  const outcome =
    run.outcome === "victory" || run.outcome === "defeat" ? run.outcome : run.isVictory ? "victory" : "defeat";
  const wave = Number.parseInt(String(run.wave ?? run.waveReached ?? ""), 10);
  const createdAt = Number.parseInt(String(run.timestamp ?? ""), 10);
  // ER (#384): usage-tier inputs ride the SAME single insert - no extra
  // requests or writes. Lazy one-time column migration below.
  const starters = Array.isArray(run.starters) ? run.starters.filter(v => typeof v === "number") : null;
  const challenges = Array.isArray(run.challenges) ? run.challenges : null;
  // ER Ghost Trainer Editor: the uploader's authored presentation blob. Stored
  // verbatim (opaque) but size-capped so a malicious client can't bloat the row;
  // store only when it round-trips as valid JSON under the cap (never a truncated
  // fragment), else null. The encountering client sanitises it before applying.
  const presentationStr =
    run.presentation && typeof run.presentation === "object" ? JSON.stringify(run.presentation) : null;
  const presentationBlob = presentationStr && presentationStr.length <= 4096 ? presentationStr : null;
  // ER (relics): the run's active relics at capture. RECORDS-ONLY - stored verbatim
  // (opaque JSON, size-capped) for analytics; the encountering client NEVER reads or
  // applies these to the fielded ghost. Old clients omit `relics` -> stays null.
  const relicsStr = Array.isArray(run.relics) ? JSON.stringify(run.relics) : null;
  const relicsBlob = relicsStr && relicsStr.length <= 2048 ? relicsStr : null;
  await ensureRunStatColumns(env);
  await env.DB.prepare(
    `INSERT INTO runs (id, user_id, username, outcome, difficulty, mode, wave, created_at, player_team, opponent_name, opponent_team, starters, challenges, killed_by_ghost, ghost_source_name, ghost_source_run_id, presentation, relics)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
       ON CONFLICT(id) DO NOTHING`,
  )
    .bind(
      id,
      auth.uid,
      auth.u,
      outcome,
      typeof run.difficulty === "string" ? run.difficulty : null,
      typeof run.mode === "string" ? run.mode : null,
      Number.isFinite(wave) ? wave : null,
      Number.isFinite(createdAt) ? createdAt : Date.now(),
      JSON.stringify(party),
      typeof run.opponentName === "string" ? run.opponentName : null,
      Array.isArray(run.opponentParty) ? JSON.stringify(run.opponentParty) : null,
      starters && starters.length > 0 ? JSON.stringify(starters) : null,
      challenges && challenges.length > 0 ? JSON.stringify(challenges) : null,
      run.killedByGhost === true ? 1 : null,
      typeof run.ghostSourceName === "string" ? run.ghostSourceName : null,
      typeof run.ghostSourceRunId === "string" ? run.ghostSourceRunId : null,
      presentationBlob,
      relicsBlob,
    )
    .run();
  // ER ghost notifications (ADDITIVE): record every ghost this run fought so the
  // ghost's OWNER can read it back on login. Old clients omit `ghostsFought`, so
  // this no-ops for them. Best-effort + isolated table — a failure here must NEVER
  // affect the run save above (already committed) or `saves`.
  await recordGhostBattles(env, id, auth.u, run.ghostsFought);
  return text("", 200, cors);
}

/** Lazily create the (isolated) ghost-battle log. Mirrors the devtest_events pattern. */
async function ensureGhostBattlesTable(env: Env): Promise<void> {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS ghost_battles (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       ghost_owner TEXT NOT NULL,
       owner_run_id TEXT,
       victim TEXT NOT NULL,
       victim_run_id TEXT NOT NULL,
       beaten_count INTEGER NOT NULL DEFAULT 0,
       ended_run INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL
     )`,
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_ghost_battles_owner ON ghost_battles (ghost_owner, created_at)",
  ).run();
}

// ---------------------------------------------------------------------------
// General per-player notifications (rewards / announcements). The client inbox
// polls /savedata/notifications since its last-seen ts (like ghost-notifications),
// so the server can push ANY message to ANY player. `payload` is an optional JSON
// blob the client renders (e.g. {species, shiny, variant} for a reward icon).
// Rows are inserted server-side (reward grants / admin).
// ---------------------------------------------------------------------------
let notificationsTableReady = false;
async function ensureNotificationsTable(env: Env): Promise<void> {
  if (notificationsTableReady) {
    return;
  }
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS notifications (
       id         INTEGER PRIMARY KEY AUTOINCREMENT,
       username   TEXT    NOT NULL,
       kind       TEXT    NOT NULL DEFAULT 'system',
       title      TEXT    NOT NULL DEFAULT '',
       body       TEXT    NOT NULL DEFAULT '',
       payload    TEXT,
       created_at INTEGER NOT NULL
     )`,
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (username, created_at)",
  ).run();
  notificationsTableReady = true;
}

async function handleNotifications(
  url: URL,
  auth: TokenPayload,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const sinceParsed = Number.parseInt(url.searchParams.get("since") ?? "", 10);
  const since = Number.isFinite(sinceParsed) ? Math.max(sinceParsed, 0) : 0;
  await ensureNotificationsTable(env);
  const rows = await env.DB.prepare(
    `SELECT id, kind, title, body, payload, created_at
       FROM notifications
      WHERE lower(username) = lower(?1) AND created_at > ?2
      ORDER BY created_at DESC
      LIMIT 50`,
  )
    .bind(auth.u, since)
    .all();
  const safeParse = (s: unknown): unknown => {
    if (typeof s !== "string") {
      return null;
    }
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  const items = (rows.results ?? []).map(r => {
    const row = r as Record<string, unknown>;
    return {
      id: `notif:${row.id}`,
      kind: typeof row.kind === "string" ? row.kind : "system",
      title: typeof row.title === "string" ? row.title : "",
      body: typeof row.body === "string" ? row.body : "",
      payload: safeParse(row.payload),
      when: typeof row.created_at === "number" ? row.created_at : 0,
    };
  });
  return json({ items }, 200, cors);
}

/** Write one ghost_battles row per ghost the victim fought. Best-effort (swallows errors). */
async function recordGhostBattles(env: Env, victimRunId: string, victim: string, ghostsFought: unknown): Promise<void> {
  try {
    if (!Array.isArray(ghostsFought) || ghostsFought.length === 0) {
      return;
    }
    const entries = ghostsFought
      .filter(
        (e): e is { owner: string; ownerRunId?: unknown; beaten?: unknown; endedRun?: unknown } =>
          !!e && typeof e === "object" && typeof (e as { owner?: unknown }).owner === "string",
      )
      .slice(0, 12);
    if (entries.length === 0) {
      return;
    }
    await ensureGhostBattlesTable(env);
    const now = Date.now();
    const stmt = env.DB.prepare(
      `INSERT INTO ghost_battles (ghost_owner, owner_run_id, victim, victim_run_id, beaten_count, ended_run, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    );
    await env.DB.batch(
      entries.map(e =>
        stmt.bind(
          e.owner,
          typeof e.ownerRunId === "string" ? e.ownerRunId : null,
          victim,
          victimRunId,
          typeof e.beaten === "number" && Number.isFinite(e.beaten) ? Math.max(0, Math.trunc(e.beaten)) : 0,
          e.endedRun === true ? 1 : 0,
          now,
        ),
      ),
    );
  } catch (err) {
    console.error("er-save-api recordGhostBattles (non-fatal):", err);
  }
}

/** Lazily index runs by ghost_source_name so the derived notification scan is cheap. */
async function ensureRunsGhostIndex(env: Env): Promise<void> {
  try {
    await env.DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_runs_ghost_source ON runs (ghost_source_name, created_at)",
    ).run();
  } catch {
    // Index is an optimization only; the query is correct without it.
  }
}

/**
 * ER ghost notifications: the battles where the CALLER's ghost fought another
 * player, since `?since=<ts>` (the client tracks last-seen locally — no write).
 *
 * Two sources, merged + deduped by victim run:
 *  (1) `ghost_battles` — precise per-ghost rows (incl. "fought but didn't end")
 *      written when a client sends `ghostsFought`. Empty until clients do so.
 *  (2) DERIVED from the `runs` table — every run a victim already wrote records
 *      `ghost_source_name` (= the ghost owner's username, see captureGhostTeam)
 *      when a ghost ENDED it. So "did my ghost beat anyone" is a read of data
 *      already present: no client recording, and it works retroactively.
 * Each row is joined to the victim's team + the ghost's source-run team for the
 * comparison.
 */
async function handleGhostNotifications(
  url: URL,
  auth: TokenPayload,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const sinceParsed = Number.parseInt(url.searchParams.get("since") ?? "", 10);
  const since = Number.isFinite(sinceParsed) ? Math.max(sinceParsed, 0) : 0;
  const safeParse = (s: unknown): unknown => {
    if (typeof s !== "string") {
      return null;
    }
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  const teamLen = (t: unknown): number => (Array.isArray(t) ? t.length : 0);

  await ensureGhostBattlesTable(env);
  await ensureRunsGhostIndex(env);

  const precise = await env.DB.prepare(
    `SELECT gb.victim, gb.beaten_count, gb.ended_run, gb.created_at, gb.victim_run_id,
            v.player_team AS victim_team, o.player_team AS ghost_team
       FROM ghost_battles gb
       LEFT JOIN runs v ON v.id = gb.victim_run_id
       LEFT JOIN runs o ON o.id = gb.owner_run_id
      WHERE gb.ghost_owner = ?1 AND gb.created_at > ?2
      ORDER BY gb.created_at DESC
      LIMIT 50`,
  )
    .bind(auth.u, since)
    .all();

  const derived = await env.DB.prepare(
    `SELECT r.username AS victim, r.id AS victim_run_id, r.created_at AS created_at,
            r.player_team AS victim_team, g.player_team AS ghost_team
       FROM runs r
       LEFT JOIN runs g ON g.id = r.ghost_source_run_id
      WHERE r.ghost_source_name = ?1 AND r.ghost_source_run_id IS NOT NULL
        AND r.username != ?1 AND r.created_at > ?2
      ORDER BY r.created_at DESC
      LIMIT 50`,
  )
    .bind(auth.u, since)
    .all();

  const seen = new Set<string>();
  const items: Record<string, unknown>[] = [];
  for (const r of precise.results ?? []) {
    const row = r as Record<string, unknown>;
    seen.add(String(row.victim_run_id ?? `${row.victim}:${row.created_at}`));
    items.push({
      victim: row.victim,
      beaten: row.beaten_count,
      endedRun: row.ended_run === 1,
      when: row.created_at,
      victimTeam: safeParse(row.victim_team),
      ghostTeam: safeParse(row.ghost_team),
    });
  }
  for (const r of derived.results ?? []) {
    const row = r as Record<string, unknown>;
    const key = String(row.victim_run_id ?? `${row.victim}:${row.created_at}`);
    if (seen.has(key)) {
      continue; // a precise ghost_battles row already covers this victim run
    }
    const victimTeam = safeParse(row.victim_team);
    items.push({
      victim: row.victim,
      // Ghost ENDED their run, so their active party went down: report its size.
      beaten: Math.min(6, teamLen(victimTeam)),
      endedRun: true,
      when: row.created_at,
      victimTeam,
      ghostTeam: safeParse(row.ghost_team),
    });
  }
  items.sort((a, b) => (b.when as number) - (a.when as number));
  return json({ items: items.slice(0, 50) }, 200, cors);
}

/** Row shape returned by the ghost-sample query. */
type RunSampleRow = {
  id: string;
  username: string | null;
  outcome: string | null;
  difficulty: string | null;
  mode: string | null;
  wave: number | null;
  created_at: number;
  player_team: string;
  opponent_name: string | null;
  opponent_team: string | null;
  challenges: string | null;
  presentation?: string | null;
};

/** Sample winning runs (excluding the caller's own) as ghost-team snapshots. */
async function handleRunSample(
  url: URL,
  auth: TokenPayload,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const difficulty = url.searchParams.get("difficulty") ?? "";
  const requested = Number.parseInt(url.searchParams.get("count") ?? "", 10);
  const count = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 20) : 8;
  // Only sample runs that reached at least `minWave` — a run that ended at wave W
  // must never be fielded as a ghost trainer past wave W (its team is only proven
  // viable up to where it died).
  const minWaveParsed = Number.parseInt(url.searchParams.get("minWave") ?? "", 10);
  const minWave = Number.isFinite(minWaveParsed) ? Math.max(minWaveParsed, 0) : 0;
  // Pool from EVERYONE, across all difficulties — a ghost can come from any
  // player's run of any difficulty, as long as it got deep enough (wave >=
  // minWave) and isn't the caller's own. (`difficulty` is accepted for forward
  // compat and as a display fallback but no longer restricts the pool.) The wave
  // floor + re-levelling on spawn keep the opponent appropriately strong
  // regardless of its origin tier.
  // ER (#131): the old `ORDER BY RANDOM() LIMIT ?` had NO usable index for its
  // `user_id != ? AND wave >= ?` filter, so D1 read the ENTIRE runs table on every
  // ghost fetch and blew past the rows-read budget; the query errored and the client
  // SILENTLY fell back to the player's OWN teams ("same ghost over and over").
  // The first fix replaced it with ONE random-rowid window - a seek + walk forward for
  // `count` CONSECUTIVE eligible rows. That reads ~count rows (good) but returns a
  // temporally-adjacent BLOCK (bad): each run's pool was clustered, so the thin
  // high-wave bands (wave 137/163) were missed ~half the time and the ghost challenge
  // then fielded a far-deeper team that had to be devolved (the "unevolved ghosts").
  // Now: many INDEPENDENT random-rowid seeks, each taking the FIRST eligible row at/after
  // its point (LIMIT 1) via the PK index, run as one batch. Still ~constant rows read,
  // but a uniform SPREAD across the whole table - diverse uploaders, every wave band
  // reachable. Dedup by id; top up from the table start only if the eligible set is sparse.
  // Endless contamination guard: a classic/challenge run ends at wave 200 (game-mode.ts
  // isWaveFinal), while ENDLESS runs go to 250, 500, 1000+ with absurdly over-levelled,
  // over-itemed teams. Fielding one as a ghost in a classic run is the reported bug.
  // Exclude them two ways: (a) `mode` (new uploads tag classic/challenge; endless/daily
  // never upload now) - `mode IS NULL` keeps legacy rows; (b) a hard `wave <= 200` ceiling,
  // which catches already-stored endless rows that predate the `mode` tag (their depth is
  // the only signal). No classic run exceeds 200, so this never drops a legitimate team.
  const MAX_GHOST_SAMPLE_WAVE = 200;
  const NON_GHOST_MODES = "'endless', 'spliced_endless', 'daily'";
  const cols =
    "id, username, outcome, difficulty, mode, wave, created_at, player_team, opponent_name, opponent_team, challenges, presentation";
  const maxRow = await env.DB.prepare("SELECT MAX(rowid) AS m FROM runs").first<{ m: number | null }>();
  const maxRowId = maxRow?.m ?? 0;
  const seen = new Set<string>();
  let results: RunSampleRow[] = [];
  if (maxRowId > 0) {
    const seekStmt = (start: number) =>
      env.DB.prepare(
        `SELECT ${cols} FROM runs WHERE rowid >= ?1 AND user_id != ?2 AND wave >= ?3 AND wave <= ?4 AND (mode IS NULL OR mode NOT IN (${NON_GHOST_MODES})) ORDER BY rowid LIMIT 1`,
      ).bind(start, auth.uid, minWave, MAX_GHOST_SAMPLE_WAVE);
    const seeks = Math.min(count * 2, 40);
    const stmts = Array.from({ length: seeks }, () => seekStmt(Math.floor(Math.random() * (maxRowId + 1))));
    const batched = await env.DB.batch<RunSampleRow>(stmts);
    for (const r of batched) {
      for (const row of r.results ?? []) {
        if (!seen.has(row.id)) {
          seen.add(row.id);
          results.push(row);
        }
      }
    }
    if (results.length < count) {
      // Sparse eligible set: some seeks landed past the last eligible row. Top up from
      // the start of the table (a contiguous read of the shallow end) to reach `count`.
      const fill = await env.DB.prepare(
        `SELECT ${cols} FROM runs WHERE user_id != ?1 AND wave >= ?2 AND wave <= ?3 AND (mode IS NULL OR mode NOT IN (${NON_GHOST_MODES})) ORDER BY rowid LIMIT ?4`,
      )
        .bind(auth.uid, minWave, MAX_GHOST_SAMPLE_WAVE, count * 2)
        .all<RunSampleRow>();
      for (const row of fill.results ?? []) {
        if (!seen.has(row.id)) {
          seen.add(row.id);
          results.push(row);
        }
      }
    }
  }
  results = results.slice(0, count);
  const teams = (results ?? [])
    .map(row => {
      try {
        return {
          id: row.id,
          trainerName: row.username ?? "Trainer",
          difficulty: row.difficulty ?? difficulty,
          mode: row.mode ?? undefined,
          waveReached: row.wave ?? 0,
          isVictory: row.outcome === "victory",
          timestamp: row.created_at,
          party: JSON.parse(row.player_team),
          opponentName: row.opponent_name ?? undefined,
          opponentParty: row.opponent_team ? JSON.parse(row.opponent_team) : undefined,
          challenges: row.challenges ? JSON.parse(row.challenges) : undefined,
          // ER Ghost Trainer Editor: pass the authored presentation through to the
          // encountering client (which sanitises it before applying). Bad JSON -> omit.
          presentation: row.presentation ? JSON.parse(row.presentation) : undefined,
        };
      } catch {
        return null;
      }
    })
    .filter(t => t !== null);
  return json({ teams }, 200, cors);
}

/**
 * The "deadliest" ghost team(s): the source runs whose ghost trainers dealt the
 * killing blow to the most OTHER players' runs. Aggregates the kill columns
 * (killed_by_ghost / ghost_source_run_id) written on every losing run, joins
 * back to the source run, and returns its team as a ghost-team snapshot with a
 * `kills` count. Used for the ER Colosseum's climactic final ghost. Optional
 * `difficulty` filters by the SOURCE run's difficulty; `count` (default 1) and
 * `minWave` mirror /sample.
 */
async function handleRunDeadliest(
  url: URL,
  auth: TokenPayload,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const difficulty = url.searchParams.get("difficulty") ?? "";
  const requested = Number.parseInt(url.searchParams.get("count") ?? "", 10);
  const count = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 10) : 1;
  const minWaveParsed = Number.parseInt(url.searchParams.get("minWave") ?? "", 10);
  const minWave = Number.isFinite(minWaveParsed) ? Math.max(minWaveParsed, 0) : 0;

  // Rank source runs by how many losing runs name them as the killer ghost.
  // Join the kill rows (k) to the source run (r) to fetch its team; exclude the
  // caller's own runs and honour the wave floor + optional difficulty filter.
  const filterDifficulty = difficulty && difficulty !== "any";
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.username, r.outcome, r.difficulty, r.wave, r.created_at, r.player_team,
            r.opponent_name, r.opponent_team, r.presentation, COUNT(*) AS kills
       FROM runs k
       JOIN runs r ON r.id = k.ghost_source_run_id
       WHERE k.killed_by_ghost = 1 AND k.ghost_source_run_id IS NOT NULL
         AND r.user_id != ?1 AND r.wave >= ?2
         ${filterDifficulty ? "AND r.difficulty = ?4" : ""}
       GROUP BY k.ghost_source_run_id
       ORDER BY kills DESC
       LIMIT ?3`,
  )
    .bind(...(filterDifficulty ? [auth.uid, minWave, count, difficulty] : [auth.uid, minWave, count]))
    .all<{
      id: string;
      username: string | null;
      outcome: string | null;
      difficulty: string | null;
      wave: number | null;
      created_at: number;
      player_team: string;
      opponent_name: string | null;
      opponent_team: string | null;
      presentation: string | null;
      kills: number;
    }>();
  const teams = (results ?? [])
    .map(row => {
      try {
        return {
          id: row.id,
          trainerName: row.username ?? "Trainer",
          difficulty: row.difficulty ?? difficulty,
          waveReached: row.wave ?? 0,
          isVictory: row.outcome === "victory",
          timestamp: row.created_at,
          kills: row.kills ?? 0,
          party: JSON.parse(row.player_team),
          opponentName: row.opponent_name ?? undefined,
          opponentParty: row.opponent_team ? JSON.parse(row.opponent_team) : undefined,
          presentation: row.presentation ? JSON.parse(row.presentation) : undefined,
        };
      } catch {
        return null;
      }
    })
    .filter(t => t !== null);
  return json({ teams }, 200, cors);
}

// #endregion
// #region dev test-suite progress (shared, staging only)

// The in-game dev TEST SUITE (staging build only) posts every Pass / Fail /
// Send-Logs here so the QA team shares one progress ledger — nobody re-runs a
// scenario a teammate already passed. These routes are PUBLIC (no account): the
// suite is staging-only and the data is non-sensitive QA bookkeeping. The table
// is auto-created on first hit so an already-deployed DB needs no migration.
let devTestTableReady = false;
async function ensureDevTestTable(env: Env): Promise<void> {
  if (devTestTableReady) {
    return;
  }
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS devtest_events (
       id       INTEGER PRIMARY KEY AUTOINCREMENT,
       kind     TEXT    NOT NULL,
       scenario TEXT    NOT NULL DEFAULT '',
       comment  TEXT    NOT NULL DEFAULT '',
       by       TEXT    NOT NULL DEFAULT '',
       at       INTEGER NOT NULL
     )`,
  ).run();
  devTestTableReady = true;
}

const DEVTEST_EVENT_KINDS = new Set(["PASS", "FAIL", "LOG", "UNPASS"]);

async function handleDevTestEvent(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  await ensureDevTestTable(env);
  const body = await parseFormBody(request);
  const kind = (body.kind ?? "").toUpperCase();
  if (!DEVTEST_EVENT_KINDS.has(kind)) {
    return json({ error: "invalid kind" }, 422, cors);
  }
  const scenario = (body.scenario ?? "").slice(0, 200);
  if ((kind === "PASS" || kind === "FAIL" || kind === "UNPASS") && scenario.length === 0) {
    return json({ error: "scenario required" }, 422, cors);
  }
  const comment = (body.comment ?? "").slice(0, 2000);
  const by = (body.by ?? "").slice(0, 60);
  await env.DB.prepare("INSERT INTO devtest_events (kind, scenario, comment, by, at) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(kind, scenario, comment, by, Date.now())
    .run();
  return json({ ok: true }, 200, cors);
}

async function handleDevTestProgress(env: Env, cors: Record<string, string>): Promise<Response> {
  await ensureDevTestTable(env);
  // "passed" = scenarios whose most-recent PASS/UNPASS event is a PASS. Resolve
  // in JS (the dataset is tiny — one QA team) by folding events oldest→newest.
  const { results: pe } = await env.DB.prepare(
    "SELECT scenario, kind FROM devtest_events WHERE kind IN ('PASS','UNPASS') ORDER BY at ASC, id ASC",
  ).all<{ scenario: string; kind: string }>();
  const latest = new Map<string, string>();
  for (const row of pe ?? []) {
    latest.set(row.scenario, row.kind);
  }
  const passed = [...latest.entries()].filter(([, k]) => k === "PASS").map(([s]) => s);

  const { results: recent } = await env.DB.prepare(
    "SELECT kind, scenario, comment, by, at FROM devtest_events ORDER BY at DESC, id DESC LIMIT 50",
  ).all<{ kind: string; scenario: string; comment: string; by: string; at: number }>();

  return json({ passed, recent: recent ?? [] }, 200, cors);
}

// #endregion

let runStatColumnsEnsured = false;
/** One-time per-isolate: add the #384 columns if this DB predates them. */
async function ensureRunStatColumns(env: Env): Promise<void> {
  if (runStatColumnsEnsured) {
    return;
  }
  runStatColumnsEnsured = true;
  for (const col of [
    "starters TEXT",
    "challenges TEXT",
    // ER (Colosseum): the killer ghost on a run-ending defeat. Additive +
    // nullable - old clients simply send null. No new request/write (rides the
    // existing run-create INSERT).
    "killed_by_ghost INTEGER",
    "ghost_source_name TEXT",
    "ghost_source_run_id TEXT",
    // ER Ghost Trainer Editor: the uploader's authored presentation (sprite/name/
    // title/dialogue/FX) JSON blob. Additive + nullable; opaque to the worker
    // (the encountering client sanitises it before applying).
    "presentation TEXT",
    // ER (relics): the run's active relics at capture. RECORDS-ONLY JSON blob
    // (analytics); never read back / applied to a fielded ghost. Additive + nullable.
    "relics TEXT",
  ]) {
    try {
      await env.DB.prepare(`ALTER TABLE runs ADD COLUMN ${col}`).run();
    } catch {
      // Column already exists.
    }
  }
}

// =============================================================================
// ER (#384) - nightly usage-tier aggregation (cron). ONE invocation per day:
// scans the 30-day run window and commits per-starter-LINE signals to
// usage-tiers.json on Heraklines/er-assets (jsDelivr-served, zero worker reads):
// deduped usage %, raw win % + avg wave, and the SKILL-ADJUSTED win/wave lift
// (each run scored vs the picking player's OWN average, EB-shrunk, to strip the
// player-skill confound). The CLIENT bins these into OU/UU/RU/PU/NU (rank ->
// blend -> quantile -> usage-cap -> egg gate). Prod-only: staging workers must
// never overwrite the shared er-assets feed with their smaller staging D1 sample.
// =============================================================================
const USAGE_TIER_CHALLENGE_ID = 12; // Challenges.USAGE_TIER - excluded from usage stats

export function canPublishUsageTiers(
  env: Pick<Env, "PUBLISH_USAGE_TIERS" | "USAGE_TIER_SOURCE" | "ER_ASSETS_TOKEN">,
): boolean {
  return env.PUBLISH_USAGE_TIERS === "1" && env.USAGE_TIER_SOURCE === "prod" && !!env.ER_ASSETS_TOKEN;
}

const usageTierMin = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export function hasPublishableUsageTierSample(
  env: Pick<Env, "USAGE_TIER_MIN_PLAYERS" | "USAGE_TIER_MIN_RUNS">,
  players: number,
  runs: number,
): boolean {
  return (
    players >= usageTierMin(env.USAGE_TIER_MIN_PLAYERS, 500) && runs >= usageTierMin(env.USAGE_TIER_MIN_RUNS, 5000)
  );
}

async function computeAndPublishUsageTiers(env: Env): Promise<void> {
  if (!canPublishUsageTiers(env)) {
    return;
  }
  await ensureRunStatColumns(env);
  const since = Date.now() - 30 * 24 * 3600 * 1000;
  const { results } = await env.DB.prepare(
    "SELECT user_id, starters, challenges, wave, outcome FROM runs WHERE created_at >= ?1 AND starters IS NOT NULL",
  )
    .bind(since)
    .all<{
      user_id: string;
      starters: string;
      challenges: string | null;
      wave: number | null;
      outcome: string;
    }>();

  // Parse each run once. A usage-tier-CHALLENGE run is a FORCED pick inside a
  // restricted pool, so it is kept OUT of the usage numerator (counting it would
  // feed the tiers back into themselves); its win/wave still inform performance.
  type Run = { uid: string; lines: number[]; inUsageTier: boolean; win: number; wave: number };
  const runs: Run[] = [];
  for (const row of results ?? []) {
    let starters: number[];
    let challenges: [number, number][] = [];
    try {
      starters = JSON.parse(row.starters);
      challenges = row.challenges ? JSON.parse(row.challenges) : [];
    } catch {
      continue;
    }
    if (!Array.isArray(starters) || starters.length === 0) {
      continue;
    }
    const lineIds = [...new Set(starters.filter(x => typeof x === "number"))];
    if (lineIds.length === 0) {
      continue;
    }
    runs.push({
      uid: row.user_id,
      lines: lineIds,
      inUsageTier: challenges.some(([cid, value]) => cid === USAGE_TIER_CHALLENGE_ID && value > 0),
      win: row.outcome === "victory" ? 1 : 0,
      wave: row.wave ?? 0,
    });
  }

  // Per-player baseline (win rate + avg wave, classic/challenge waves <=200 only).
  // The SKILL-ADJUSTED lift below scores each run against the SAME player's own
  // average, so a starter piloted mostly by beginners is judged vs those beginners,
  // not the field - removing the player-skill confound. The client turns these
  // signals into the actual tiers (rank -> blend -> bin -> usage-cap -> egg gate).
  const players = new Map<string, { n: number; winSum: number; waveSum: number; waveN: number }>();
  for (const r of runs) {
    let p = players.get(r.uid);
    if (!p) {
      p = { n: 0, winSum: 0, waveSum: 0, waveN: 0 };
      players.set(r.uid, p);
    }
    p.n++;
    p.winSum += r.win;
    if (r.wave <= 200) {
      p.waveSum += r.wave;
      p.waveN++;
    }
  }
  if (players.size === 0) {
    return; // No starter-tagged runs yet - keep the seed file as-is.
  }
  if (!hasPublishableUsageTierSample(env, players.size, runs.length)) {
    console.warn(
      `[usage-tiers] refusing to publish from too-small sample: players=${players.size}, runs=${runs.length}`,
    );
    return;
  }
  let gWinSum = 0;
  let gWaveSum = 0;
  let gWaveN = 0;
  for (const r of runs) {
    gWinSum += r.win;
    if (r.wave <= 200) {
      gWaveSum += r.wave;
      gWaveN++;
    }
  }

  // Per-line aggregate: deduped usage players (non-usage-tier runs), raw win/wave,
  // and the skill-adjusted win/wave lift (run result minus the player's own mean).
  type Agg = {
    usagePlayers: Set<string>;
    runs: number;
    wins: number;
    waveSum: number;
    waveN: number;
    winLift: number;
    waveLift: number;
    waveLiftN: number;
  };
  const agg = new Map<number, Agg>();
  for (const r of runs) {
    const p = players.get(r.uid)!;
    const pWin = p.winSum / p.n;
    const pWave = p.waveN ? p.waveSum / p.waveN : 0;
    for (const line of r.lines) {
      let o = agg.get(line);
      if (!o) {
        o = { usagePlayers: new Set(), runs: 0, wins: 0, waveSum: 0, waveN: 0, winLift: 0, waveLift: 0, waveLiftN: 0 };
        agg.set(line, o);
      }
      if (!r.inUsageTier) {
        o.usagePlayers.add(r.uid);
      }
      o.runs++;
      o.wins += r.win;
      o.winLift += r.win - pWin;
      if (r.wave <= 200) {
        o.waveSum += r.wave;
        o.waveN++;
        o.waveLift += r.wave - pWave;
        o.waveLiftN++;
      }
    }
  }

  // Empirical-Bayes shrinkage: K phantom runs pull a small-sample line toward the
  // no-signal mean (its lift toward 0), so a 1-pick line can't sit at an extreme.
  const K = 20;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const lines: Record<
    number,
    { usagePct: number; win: number; wave: number; winLift: number; waveLift: number; sample: number }
  > = {};
  for (const [line, o] of agg) {
    lines[line] = {
      usagePct: Math.round((100 * o.usagePlayers.size * 1000) / players.size) / 1000,
      win: Math.round((1000 * o.wins) / o.runs) / 10,
      wave: o.waveN ? Math.round(o.waveSum / o.waveN) : 0,
      winLift: r2((o.winLift / (o.runs + K)) * 100),
      waveLift: r2(o.waveLiftN ? o.waveLift / (o.waveLiftN + K) : 0),
      sample: o.runs,
    };
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    windowDays: 30,
    players: players.size,
    runs: runs.length,
    source: {
      generatedBy: "er-save-api-cron",
      publisher: env.USAGE_TIER_SOURCE,
    },
    baseWinPct: r2((100 * gWinSum) / runs.length),
    globalWave: gWaveN ? Math.round((10 * gWaveSum) / gWaveN) / 10 : 0,
    lines,
  };
  const body = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(payload, null, 1))));
  const gh = (path: string, init?: RequestInit) =>
    fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${env.ER_ASSETS_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "er-usage-tiers-cron",
        ...(init?.headers ?? {}),
      },
    });
  const current = await gh("/repos/Heraklines/er-assets/contents/usage-tiers.json");
  const sha = current.ok ? ((await current.json()) as { sha?: string }).sha : undefined;
  await gh("/repos/Heraklines/er-assets/contents/usage-tiers.json", {
    method: "PUT",
    body: JSON.stringify({ message: "usage-tiers: nightly aggregation (#384)", content: body, sha }),
  });
}

// #region community challenges (P1)
// =============================================================================
// Player-authored "community challenges": a run configuration other trainers
// browse, play, bookmark, and clear. Three self-creating D1 tables back this
// (challenge DEFINITION + denormalized counters; one current attempt per
// (challenge,user); per-user bookmarks) on the SAME `DB` binding, lazily created
// once per isolate exactly like ensureNotificationsTable / ensureDevTestTable.
//
// Routes (wired into the fetch router below):
//   public : GET  /community/challenges   (browse feed; ALWAYS 200, empty when none)
//            GET  /community/challenge?id= (full config + stats + recent + board)
//            GET  /community/achv-tally    (live tracked-achv holder tally; ALWAYS 200)
//   authed : POST /community/challenge     (create draft -> {id})
//            POST /community/attempt        (idempotent run-start record)
//            POST /community/clear          (verification SEAM - stub, see TODO P1-G)
//            POST /community/bookmark        (toggle)
//            GET  /community/bookmarks       (list)
//            POST /community/achv            (report this player's tracked achv unlocks)
//
// Empty-launch is structural, not special-cased: a challenge is `status='draft'`
// until its founder clear publishes it, and browse only reads `status='active'`,
// so the feed returns {featured:[], selected:null, totalCount:0} cleanly with no
// placeholder rows. Counter maintenance is incremental (O(1) read+write per
// attempt), NOT a recount - deliberately avoiding the full-table-scan trap.
// =============================================================================

let communityTablesReady = false;
async function ensureCommunityTables(env: Env): Promise<void> {
  if (communityTablesReady) {
    return;
  }
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS community_challenges (
       id               TEXT    PRIMARY KEY,
       title            TEXT    NOT NULL DEFAULT '',
       subtitle         TEXT    NOT NULL DEFAULT '',
       description      TEXT    NOT NULL DEFAULT '',
       config_json      TEXT    NOT NULL,
       seed             TEXT,
       difficulty       TEXT,
       game_mode_id     INTEGER,
       target_wave      INTEGER,
       tags             TEXT,
       art_json         TEXT,
       emblem_json      TEXT,
       created_by       TEXT,
       created_by_uid   INTEGER,
       created_at       INTEGER NOT NULL,
       published_at     INTEGER,
       status           TEXT    NOT NULL DEFAULT 'draft',
       founder_clear_id TEXT,
       featured_rank    INTEGER NOT NULL DEFAULT 0,
       trending_score   REAL    NOT NULL DEFAULT 0,
       attempts_total   INTEGER NOT NULL DEFAULT 0,
       cleared_count    INTEGER NOT NULL DEFAULT 0,
       failed_count     INTEGER NOT NULL DEFAULT 0,
       inprogress_count INTEGER NOT NULL DEFAULT 0,
       best_wave        INTEGER,
       fastest_clear_ms INTEGER,
       first_clear_user TEXT,
       first_clear_at   INTEGER,
       updated_at       INTEGER NOT NULL
     )`,
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_cc_browse ON community_challenges (status, featured_rank DESC, trending_score DESC)",
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_cc_newest ON community_challenges (status, created_at DESC)",
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_cc_author ON community_challenges (created_by_uid, created_at DESC)",
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS community_challenge_attempts (
       challenge_id  TEXT    NOT NULL,
       user_id       INTEGER NOT NULL,
       username      TEXT,
       status        TEXT    NOT NULL,
       wave          INTEGER,
       clear_time_ms INTEGER,
       player_team   TEXT,
       challenges    TEXT,
       run_seed      TEXT,
       verified      INTEGER NOT NULL DEFAULT 0,
       replay_trace  TEXT,
       started_at    INTEGER NOT NULL,
       updated_at    INTEGER NOT NULL,
       PRIMARY KEY (challenge_id, user_id)
     )`,
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_cca_board ON community_challenge_attempts (challenge_id, verified, status, wave DESC, clear_time_ms ASC)",
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_cca_recent ON community_challenge_attempts (challenge_id, status, updated_at DESC)",
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_cca_user ON community_challenge_attempts (user_id, updated_at DESC)",
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS community_challenge_bookmarks (
       user_id      INTEGER NOT NULL,
       challenge_id TEXT    NOT NULL,
       created_at   INTEGER NOT NULL,
       PRIMARY KEY (user_id, challenge_id)
     )`,
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_ccb_user ON community_challenge_bookmarks (user_id, created_at DESC)",
  ).run();
  // Tracked-achievement tally: one row per (user, tracked achv) recording the
  // player's EARLIEST unlock. Backs the live holder-count / rarity shown on the
  // featured Inferno card (client-reported since system saves are encrypted).
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS achievement_holders (
       user_id    INTEGER NOT NULL,
       achv_id    TEXT    NOT NULL,
       at         INTEGER NOT NULL,
       updated_at INTEGER NOT NULL,
       PRIMARY KEY (user_id, achv_id)
     )`,
  ).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_ah_achv ON achievement_holders (achv_id)").run();
  communityTablesReady = true;
}

// ---------------------------------------------------------------------------
// Tracked-achievement tally. A small server-side ALLOW-LIST of achievement ids
// whose holder count / rarity is surfaced publicly (currently just the Inferno
// apex). Anything else the client reports is ignored (anti-abuse). Kept a Set so
// more featured achievements can be added without touching the route logic.
// ---------------------------------------------------------------------------
const TRACKED_ACHV_IDS = new Set(["INFERNO"]);

// ---------------------------------------------------------------------------
// Shared config validator. This is a VERBATIM copy of the client's
// `validateChallengeConfig` (src/data/elite-redux/er-community-challenges.ts) -
// workers can't import from `src/`. A parity vitest asserts the two agree
// (test/tests/elite-redux/er-community-challenge-validator-parity.test.ts).
// Keep the bodies byte-identical when either is edited.
// ---------------------------------------------------------------------------

/** Result of validating an untrusted community-challenge config. */
export interface ChallengeConfigValidation {
  ok: boolean;
  errors: string[];
}

// The `Challenges` enum (src/enums/challenges.ts) has 15 members (0..14),
// SINGLE_GENERATION..GHOST_TRAINERS. Hardcoded as a constant so the worker copy
// and the client copy bind the same range without importing the enum.
const CC_CHALLENGE_ID_MAX = 14;
const CC_VALID_DIFFICULTIES = ["youngster", "ace", "elite", "hell"];
const CC_MAX_NAME = 60;
const CC_MAX_SUBTITLE = 80;
const CC_MAX_DESC = 600;
const CC_MAX_TAGS = 8;
const CC_MAX_TAG_LEN = 24;
const CC_MAX_BASE_CHALLENGES = 20;
const CC_MAX_ALLOWED_SPECIES = 300;
const CC_MAX_TARGET_WAVE = 200;

export function validateChallengeConfig(config: unknown): ChallengeConfigValidation {
  const errors: string[] = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { ok: false, errors: ["config must be an object"] };
  }
  const c = config as Record<string, unknown>;
  if (typeof c.name !== "string" || c.name.trim().length === 0) {
    errors.push("name is required");
  } else if (c.name.length > CC_MAX_NAME) {
    errors.push(`name must be <= ${CC_MAX_NAME} characters`);
  }
  if (c.subtitle !== undefined && (typeof c.subtitle !== "string" || c.subtitle.length > CC_MAX_SUBTITLE)) {
    errors.push(`subtitle must be a string <= ${CC_MAX_SUBTITLE} characters`);
  }
  if (c.description !== undefined && (typeof c.description !== "string" || c.description.length > CC_MAX_DESC)) {
    errors.push(`description must be a string <= ${CC_MAX_DESC} characters`);
  }
  if (typeof c.difficulty !== "string" || !CC_VALID_DIFFICULTIES.includes(c.difficulty)) {
    errors.push("difficulty must be one of youngster|ace|elite|hell");
  }
  if (
    typeof c.difficultyTier !== "number"
    || !Number.isInteger(c.difficultyTier)
    || c.difficultyTier < 1
    || c.difficultyTier > 5
  ) {
    errors.push("difficultyTier must be an integer 1..5");
  }
  if (typeof c.gameModeId !== "number" || !Number.isFinite(c.gameModeId)) {
    errors.push("gameModeId must be a number");
  }
  if (Array.isArray(c.baseChallenges)) {
    if (c.baseChallenges.length > CC_MAX_BASE_CHALLENGES) {
      errors.push(`baseChallenges must have <= ${CC_MAX_BASE_CHALLENGES} entries`);
    }
    for (const entry of c.baseChallenges) {
      if (!Array.isArray(entry) || entry.length < 2) {
        errors.push("each baseChallenge must be [id, value, severity?]");
        continue;
      }
      const id = entry[0];
      const value = entry[1];
      const severity = entry[2];
      if (typeof id !== "number" || !Number.isInteger(id) || id < 0 || id > CC_CHALLENGE_ID_MAX) {
        errors.push(`baseChallenge id ${String(id)} is out of range 0..${CC_CHALLENGE_ID_MAX}`);
      }
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.push("baseChallenge value must be a number");
      }
      if (severity !== undefined && (typeof severity !== "number" || !Number.isFinite(severity))) {
        errors.push("baseChallenge severity must be a number");
      }
    }
  } else {
    errors.push("baseChallenges must be an array");
  }
  if (c.allowedSpecies !== null && !Array.isArray(c.allowedSpecies)) {
    errors.push("allowedSpecies must be null or an array");
  } else if (Array.isArray(c.allowedSpecies)) {
    if (c.allowedSpecies.length > CC_MAX_ALLOWED_SPECIES) {
      errors.push(`allowedSpecies must have <= ${CC_MAX_ALLOWED_SPECIES} entries`);
    }
    for (const sp of c.allowedSpecies) {
      if (typeof sp !== "number" || !Number.isInteger(sp) || sp <= 0) {
        errors.push("allowedSpecies entries must be positive integers");
        break;
      }
    }
  }
  if (
    typeof c.targetWave !== "number"
    || !Number.isInteger(c.targetWave)
    || c.targetWave < 1
    || c.targetWave > CC_MAX_TARGET_WAVE
  ) {
    errors.push(`targetWave must be an integer 1..${CC_MAX_TARGET_WAVE}`);
  }
  if (Array.isArray(c.tags)) {
    if (c.tags.length > CC_MAX_TAGS) {
      errors.push(`tags must have <= ${CC_MAX_TAGS} entries`);
    }
    for (const tag of c.tags) {
      if (typeof tag !== "string" || tag.length === 0 || tag.length > CC_MAX_TAG_LEN) {
        errors.push(`each tag must be a non-empty string <= ${CC_MAX_TAG_LEN} characters`);
        break;
      }
    }
  } else {
    errors.push("tags must be an array");
  }
  if (
    c.restrictions !== undefined
    && (typeof c.restrictions !== "object" || c.restrictions === null || Array.isArray(c.restrictions))
  ) {
    errors.push("restrictions must be an object");
  }
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Read helpers: row -> CommunityChallengeEntry (the shape the browser binds; see
// src/data/elite-redux/er-community-challenges.ts).
// ---------------------------------------------------------------------------

/** Columns of `community_challenges` needed to build a feed entry. */
const CC_ENTRY_COLS =
  "id, config_json, status, attempts_total, cleared_count, inprogress_count, failed_count, first_clear_user, created_by, created_by_uid, created_at";

interface CommunityChallengeRow {
  id: string;
  config_json: string;
  status: string;
  attempts_total: number;
  cleared_count: number;
  inprogress_count: number;
  failed_count: number;
  first_clear_user: string | null;
  created_by: string | null;
  created_by_uid: number | null;
  created_at: number;
}

/** Derive the human-readable RULES list from a config's restrictions + meta. */
function deriveCommunityRules(config: Record<string, unknown>): { icon?: string; text: string }[] {
  const rules: { icon?: string; text: string }[] = [];
  const r = (config.restrictions ?? {}) as Record<string, unknown>;
  if (r.noLegendary) {
    rules.push({ text: "No Legendary Pokemon" });
  }
  if (r.noMythical) {
    rules.push({ text: "No Mythical Pokemon" });
  }
  if (r.noUltraBeasts) {
    rules.push({ text: "No Ultra Beasts" });
  }
  if (r.noRepeats) {
    rules.push({ text: "No repeats" });
  }
  if (r.starterNotGuaranteed) {
    rules.push({ text: "Starter is not guaranteed" });
  }
  if (Array.isArray(config.allowedSpecies)) {
    rules.push({ text: "Restricted Pokemon pool" });
  }
  if (typeof config.targetWave === "number") {
    rules.push({ text: `Reach wave ${config.targetWave}` });
  }
  return rules;
}

/** Build the CommunityChallengeEntry the browser screen binds, from a DB row. */
function buildCommunityEntry(
  row: CommunityChallengeRow,
  stats: {
    attempts: number;
    cleared: number;
    inProgress: number;
    failed: number;
    recent: { user: string; at: number }[];
  },
  bookmarked: boolean,
): unknown {
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(row.config_json) as Record<string, unknown>;
  } catch {
    config = {};
  }
  const allowed = Array.isArray(config.allowedSpecies) ? (config.allowedSpecies as number[]) : null;
  return {
    config,
    stats: {
      attempts: stats.attempts,
      cleared: stats.cleared,
      inProgress: stats.inProgress,
      failed: stats.failed,
      firstClearUser: row.first_clear_user ?? undefined,
      recent: stats.recent,
    },
    rules: deriveCommunityRules(config),
    allowedPreview: allowed ? allowed.slice(0, 9) : [],
    allowedCount: allowed ? allowed.length : 0,
    bookmarked,
  };
}

/** Map a `sort` query value to a whitelisted ORDER BY clause (no injection). */
function communitySortOrder(sort: string): string {
  switch (sort) {
    case "newest":
      return "created_at DESC";
    case "clearRate":
      return "(CAST(cleared_count AS REAL) / NULLIF(attempts_total, 0)) DESC, attempts_total DESC";
    case "attempts":
      return "attempts_total DESC";
    case "hardest":
      return "CASE difficulty WHEN 'hell' THEN 4 WHEN 'elite' THEN 3 WHEN 'ace' THEN 2 WHEN 'youngster' THEN 1 ELSE 0 END DESC, attempts_total DESC";
    default:
      // "trending"
      return "featured_rank DESC, trending_score DESC, created_at DESC";
  }
}

// ---------------------------------------------------------------------------
// Public routes.
// ---------------------------------------------------------------------------

/**
 * GET /community/challenges - the browse / featured feed. Filter (difficulty,
 * tag, q), sort, and page. ALWAYS returns 200 with a CommunityChallengeFeed;
 * `{featured:[], selected:null, totalCount:0}` when empty (never errors on empty).
 */
async function handleCommunityList(url: URL, env: Env, cors: Record<string, string>): Promise<Response> {
  await ensureCommunityTables(env);
  const sort = url.searchParams.get("sort") ?? "trending";
  const difficulty = url.searchParams.get("difficulty") ?? "";
  const tag = url.searchParams.get("tag") ?? "";
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const limitParsed = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitParsed) ? Math.min(Math.max(limitParsed, 1), 30) : 12;
  const offsetParsed = Number.parseInt(url.searchParams.get("offset") ?? "", 10);
  const offset = Number.isFinite(offsetParsed) ? Math.max(offsetParsed, 0) : 0;

  const where: string[] = ["status = 'active'"];
  const binds: unknown[] = [];
  if (difficulty && CC_VALID_DIFFICULTIES.includes(difficulty)) {
    where.push("difficulty = ?");
    binds.push(difficulty);
  }
  if (tag) {
    // tags is a JSON array string e.g. ["NUZLOCKE","HARDCORE"]; match a quoted token.
    where.push("tags LIKE ?");
    binds.push(`%${JSON.stringify(tag).slice(1, -1)}%`);
  }
  if (q) {
    where.push("(lower(title) LIKE ? OR lower(description) LIKE ?)");
    binds.push(`%${q}%`, `%${q}%`);
  }
  const whereSql = where.join(" AND ");

  const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS c FROM community_challenges WHERE ${whereSql}`)
    .bind(...binds)
    .first<{ c: number }>();
  const totalCount = totalRow?.c ?? 0;

  const { results } = await env.DB.prepare(
    `SELECT ${CC_ENTRY_COLS} FROM community_challenges WHERE ${whereSql} ORDER BY ${communitySortOrder(sort)} LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit, offset)
    .all<CommunityChallengeRow>();

  const featured = (results ?? []).map((row: CommunityChallengeRow) =>
    buildCommunityEntry(
      row,
      {
        attempts: row.attempts_total,
        cleared: row.cleared_count,
        inProgress: row.inprogress_count,
        failed: row.failed_count,
        recent: [],
      },
      false,
    ),
  );
  return json({ featured, selected: featured[0] ?? null, totalCount }, 200, cors);
}

/**
 * GET /community/challenge?id= - full config + stats + recent completions +
 * leaderboard, in one round-trip. Stats are derived from the attempts table.
 * 404 when missing or hidden/rejected.
 */
async function handleCommunityDetail(url: URL, env: Env, cors: Record<string, string>): Promise<Response> {
  await ensureCommunityTables(env);
  const id = url.searchParams.get("id") ?? "";
  if (!id) {
    return text("Missing challenge id.", 400, cors);
  }
  const row = await env.DB.prepare(`SELECT ${CC_ENTRY_COLS} FROM community_challenges WHERE id = ?`)
    .bind(id)
    .first<CommunityChallengeRow>();
  if (!row || row.status === "hidden" || row.status === "rejected") {
    return text("Challenge not found.", 404, cors);
  }

  // Stats derivation (clear rate / attempts / in-progress / failed) straight off
  // the attempts table - the 3-way status partition sums to the attempt total.
  const { results: statusRows } = await env.DB.prepare(
    "SELECT status, COUNT(*) AS c FROM community_challenge_attempts WHERE challenge_id = ? GROUP BY status",
  )
    .bind(id)
    .all<{ status: string; c: number }>();
  let cleared = 0;
  let inProgress = 0;
  let failed = 0;
  for (const sc of statusRows ?? []) {
    if (sc.status === "cleared") {
      cleared = sc.c;
    } else if (sc.status === "in_progress") {
      inProgress = sc.c;
    } else if (sc.status === "failed") {
      failed = sc.c;
    }
  }
  const attempts = cleared + inProgress + failed;

  const { results: recentRows } = await env.DB.prepare(
    "SELECT username, updated_at FROM community_challenge_attempts WHERE challenge_id = ? AND status = 'cleared' ORDER BY updated_at DESC LIMIT 5",
  )
    .bind(id)
    .all<{ username: string | null; updated_at: number }>();
  const recent = (recentRows ?? []).map((r: { username: string | null; updated_at: number }) => ({
    user: r.username ?? "Trainer",
    at: r.updated_at,
  }));

  const { results: boardRows } = await env.DB.prepare(
    "SELECT username, wave, clear_time_ms, updated_at FROM community_challenge_attempts WHERE challenge_id = ? AND verified = 1 AND status = 'cleared' ORDER BY wave DESC, clear_time_ms ASC LIMIT 10",
  )
    .bind(id)
    .all<{ username: string | null; wave: number | null; clear_time_ms: number | null; updated_at: number }>();
  const leaderboard = (boardRows ?? []).map(
    (r: { username: string | null; wave: number | null; clear_time_ms: number | null; updated_at: number }) => ({
      username: r.username ?? "Trainer",
      wave: r.wave ?? 0,
      clearTimeMs: r.clear_time_ms,
      when: r.updated_at,
    }),
  );

  const challenge = buildCommunityEntry(row, { attempts, cleared, inProgress, failed, recent }, false);
  return json({ challenge, leaderboard }, 200, cors);
}

// ---------------------------------------------------------------------------
// Authenticated routes.
// ---------------------------------------------------------------------------

/**
 * POST /community/challenge - create a DRAFT challenge. Body is the
 * CommunityChallengeConfig (or `{ config }`). Validated, then inserted with
 * `status='draft'`; it stays invisible to browse until its founder clear
 * publishes it. Returns `{ id }`.
 */
async function handleCommunityCreate(
  request: Request,
  auth: TokenPayload,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  await ensureCommunityTables(env);
  const raw = await readSaveBody(request);
  if (raw === null) {
    return text("Challenge data too large.", 413, cors);
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return text("Invalid challenge data.", 400, cors);
  }
  const wrapper = body as Record<string, unknown> | null;
  const config = (wrapper && typeof wrapper === "object" && wrapper.config ? wrapper.config : body) as Record<
    string,
    unknown
  >;
  const validation = validateChallengeConfig(config);
  if (!validation.ok) {
    return json({ error: "invalid config", errors: validation.errors }, 422, cors);
  }
  const now = Date.now();
  const id = `cc-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const asStr = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
  // The server owns id/author/createdAt; persist the canonical config alongside.
  const stored = {
    ...config,
    id,
    schemaVersion: typeof config.schemaVersion === "number" ? config.schemaVersion : 1,
    author: auth.u,
    authorId: auth.uid,
    createdAt: now,
  };
  const tags = Array.isArray(config.tags) ? config.tags : [];
  await env.DB.prepare(
    `INSERT INTO community_challenges
       (id, title, subtitle, description, config_json, seed, difficulty, game_mode_id, target_wave, tags, art_json, emblem_json, created_by, created_by_uid, created_at, status, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 'draft', ?15)`,
  )
    .bind(
      id,
      asStr(config.name, CC_MAX_NAME),
      asStr(config.subtitle, CC_MAX_SUBTITLE),
      asStr(config.description, CC_MAX_DESC),
      JSON.stringify(stored),
      typeof config.seed === "string" && config.seed.length > 0 ? config.seed : null,
      typeof config.difficulty === "string" ? config.difficulty : null,
      typeof config.gameModeId === "number" ? config.gameModeId : null,
      typeof config.targetWave === "number" ? config.targetWave : null,
      JSON.stringify(tags),
      config.art ? JSON.stringify(config.art) : null,
      null,
      auth.u,
      auth.uid,
      now,
    )
    .run();
  return json({ id }, 200, cors);
}

/**
 * Incremental attempt UPSERT + O(1) counter maintenance. Reads the old status (1
 * read), computes the (old->new) bucket delta, then batches [attempt upsert,
 * counter update, optional first-clear stamp]. `cleared` is STICKY (never
 * downgrades). Returns the effective (post-sticky) status.
 */
async function upsertCommunityAttempt(
  env: Env,
  p: {
    challengeId: string;
    userId: number;
    username: string;
    status: "in_progress" | "cleared" | "failed";
    wave: number | null;
    clearTimeMs: number | null;
    verified: number;
    now: number;
  },
): Promise<"in_progress" | "cleared" | "failed"> {
  const existing = await env.DB.prepare(
    "SELECT status FROM community_challenge_attempts WHERE challenge_id = ? AND user_id = ?",
  )
    .bind(p.challengeId, p.userId)
    .first<{ status: string }>();
  const oldStatus = existing?.status ?? null;
  // Sticky: once cleared, status never downgrades.
  const effective: "in_progress" | "cleared" | "failed" = oldStatus === "cleared" ? "cleared" : p.status;
  const isNew = oldStatus === null;
  const dAttempts = isNew ? 1 : 0;
  const dInprogress = (effective === "in_progress" ? 1 : 0) - (oldStatus === "in_progress" ? 1 : 0);
  const dCleared = (effective === "cleared" ? 1 : 0) - (oldStatus === "cleared" ? 1 : 0);
  const dFailed = (effective === "failed" ? 1 : 0) - (oldStatus === "failed" ? 1 : 0);

  const stmts = [
    env.DB.prepare(
      `INSERT INTO community_challenge_attempts
           (challenge_id, user_id, username, status, wave, clear_time_ms, verified, started_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
         ON CONFLICT(challenge_id, user_id) DO UPDATE SET
           username = ?3,
           status = ?4,
           wave = MAX(COALESCE(community_challenge_attempts.wave, 0), COALESCE(?5, 0)),
           clear_time_ms = CASE
             WHEN ?6 IS NOT NULL AND (community_challenge_attempts.clear_time_ms IS NULL OR ?6 < community_challenge_attempts.clear_time_ms)
             THEN ?6 ELSE community_challenge_attempts.clear_time_ms END,
           verified = MAX(community_challenge_attempts.verified, ?7),
           updated_at = ?8`,
    ).bind(p.challengeId, p.userId, p.username, effective, p.wave, p.clearTimeMs, p.verified, p.now),
    env.DB.prepare(
      `UPDATE community_challenges SET
           attempts_total = attempts_total + ?2,
           inprogress_count = inprogress_count + ?3,
           cleared_count = cleared_count + ?4,
           failed_count = failed_count + ?5,
           best_wave = MAX(COALESCE(best_wave, 0), COALESCE(?6, 0)),
           fastest_clear_ms = CASE
             WHEN ?7 = 'cleared' AND ?8 IS NOT NULL AND (fastest_clear_ms IS NULL OR ?8 < fastest_clear_ms)
             THEN ?8 ELSE fastest_clear_ms END,
           updated_at = ?9
         WHERE id = ?1`,
    ).bind(p.challengeId, dAttempts, dInprogress, dCleared, dFailed, p.wave, effective, p.clearTimeMs, p.now),
  ];
  if (effective === "cleared") {
    stmts.push(
      env.DB.prepare(
        "UPDATE community_challenges SET first_clear_user = ?2, first_clear_at = ?3 WHERE id = ?1 AND first_clear_user IS NULL",
      ).bind(p.challengeId, p.username, p.now),
    );
  }
  await env.DB.batch(stmts);
  return effective;
}

/**
 * POST /community/attempt - record a run START (in-progress) for this player.
 * Idempotent: keyed (challenge_id, user_id), it no-ops if a row already exists
 * (so re-entering a challenge never double-counts or downgrades a clear).
 */
async function handleCommunityAttempt(
  request: Request,
  auth: TokenPayload,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  await ensureCommunityTables(env);
  const body = await parseFormBody(request);
  const challengeId = (body.challengeId ?? "").slice(0, 128);
  if (!challengeId) {
    return json({ error: "challengeId required" }, 422, cors);
  }
  const exists = await env.DB.prepare("SELECT id FROM community_challenges WHERE id = ?")
    .bind(challengeId)
    .first<{ id: string }>();
  if (!exists) {
    return text("Challenge not found.", 404, cors);
  }
  const waveParsed = Number.parseInt(body.wave ?? "", 10);
  const wave = Number.isFinite(waveParsed) ? Math.max(0, Math.min(200, waveParsed)) : null;
  const now = Date.now();

  // Idempotent: only the FIRST attempt for (challenge,user) inserts + bumps. A
  // pre-existing row (in_progress OR a sticky clear) is left untouched.
  const existing = await env.DB.prepare(
    "SELECT status FROM community_challenge_attempts WHERE challenge_id = ? AND user_id = ?",
  )
    .bind(challengeId, auth.uid)
    .first<{ status: string }>();
  if (existing) {
    return json({ ok: true, status: existing.status, recorded: false }, 200, cors);
  }
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO community_challenge_attempts
           (challenge_id, user_id, username, status, wave, verified, started_at, updated_at)
         VALUES (?1, ?2, ?3, 'in_progress', ?4, 0, ?5, ?5)
         ON CONFLICT(challenge_id, user_id) DO NOTHING`,
    ).bind(challengeId, auth.uid, auth.u, wave, now),
    env.DB.prepare(
      `UPDATE community_challenges SET
           attempts_total = attempts_total + 1,
           inprogress_count = inprogress_count + 1,
           best_wave = MAX(COALESCE(best_wave, 0), COALESCE(?2, 0)),
           updated_at = ?3
         WHERE id = ?1`,
    ).bind(challengeId, wave, now),
  ]);
  return json({ ok: true, status: "in_progress", recorded: true }, 200, cors);
}

/**
 * POST /community/clear - the verification SEAM (full anti-cheat is P1-G). Today
 * it validates the body shape, records the attempt with the claimed outcome, and
 * lays the founder-publish seam. The config-match + IV-clamp + ban checks that
 * gate a VERIFIED clear are stubbed - see the TODO(P1-G) below.
 */
/** Compare two [id, value, severity?] challenge lists order-insensitively (id->value, value!=0). */
function baseChallengesEqual(a: unknown, b: unknown): boolean {
  const norm = (x: unknown): Map<number, number> => {
    const m = new Map<number, number>();
    if (Array.isArray(x)) {
      for (const t of x) {
        if (Array.isArray(t) && typeof t[0] === "number") {
          const value = typeof t[1] === "number" ? t[1] : 0;
          if (value !== 0) {
            m.set(t[0], value);
          }
        }
      }
    }
    return m;
  };
  const ma = norm(a);
  const mb = norm(b);
  if (ma.size !== mb.size) {
    return false;
  }
  for (const [id, value] of ma) {
    if (mb.get(id) !== value) {
      return false;
    }
  }
  return true;
}

/**
 * Anti-cheat config-match for a community clear. Verified only when the submitted run is
 * a GENUINE victory at/after the target wave AND its difficulty / game mode / base
 * challenges / seed match the stored challenge. (Party-level checks need the species
 * graph the worker lacks; they stay a follow-up.)
 */
function communityRunMatchesConfig(
  body: Record<string, unknown>,
  row: { target_wave: number | null; seed: string | null; difficulty: string | null; game_mode_id: number | null },
  config: Record<string, unknown>,
  wave: number | null,
  isVictory: boolean,
): boolean {
  if (!isVictory) {
    return false;
  }
  const target = typeof row.target_wave === "number" ? row.target_wave : 200;
  if (wave === null || wave < target || wave > 200) {
    return false;
  }
  const cfgDifficulty = typeof config.difficulty === "string" ? config.difficulty : row.difficulty;
  if (typeof body.difficulty === "string" && cfgDifficulty != null && body.difficulty !== cfgDifficulty) {
    return false;
  }
  const cfgMode = typeof config.gameModeId === "number" ? config.gameModeId : row.game_mode_id;
  if (body.gameModeId != null && cfgMode != null && Number(body.gameModeId) !== cfgMode) {
    return false;
  }
  if (row.seed != null && row.seed.length > 0 && body.seed !== row.seed) {
    return false;
  }
  return baseChallengesEqual(config.baseChallenges, body.baseChallenges);
}

/**
 * Party-level anti-cheat for a verified clear: reject impossible IVs (a tampered run)
 * and, when the challenge has a species whitelist, require every party ROOT (the
 * client-computed `partyRoots`) to be allowed. Whitelist-less challenges skip the roots
 * check. (Deeper ghost-legal bans need the species graph the worker lacks - a follow-up.)
 */
function communityPartyLegal(body: Record<string, unknown>, config: Record<string, unknown>): boolean {
  const party = Array.isArray(body.party) ? body.party : [];
  for (const member of party) {
    const ivs = (member as { ivs?: unknown })?.ivs;
    if (Array.isArray(ivs)) {
      for (const iv of ivs) {
        const n = Number(iv);
        if (!Number.isFinite(n) || n < 0 || n > 31) {
          return false; // an out-of-range IV can only come from a tampered client.
        }
      }
    }
  }
  const allowed = Array.isArray(config.allowedSpecies) ? (config.allowedSpecies as unknown[]) : null;
  if (allowed && allowed.length > 0) {
    const allowedSet = new Set(allowed.map(Number));
    const roots = Array.isArray(body.partyRoots) ? body.partyRoots : null;
    if (!roots) {
      return false; // whitelist challenge but no roots to check -> cannot verify.
    }
    for (const r of roots) {
      if (!allowedSet.has(Number(r))) {
        return false;
      }
    }
  }
  return true;
}

async function handleCommunityClear(
  request: Request,
  auth: TokenPayload,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  await ensureCommunityTables(env);
  const raw = await readSaveBody(request);
  if (raw === null) {
    return text("Run data too large.", 413, cors);
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return text("Invalid run data.", 400, cors);
  }
  // Body-shape validation (the seam): a clear claim must name a challenge and
  // carry a party array, exactly like handleRunCreate requires id + party.
  const challengeId =
    typeof body.challengeId === "string" ? body.challengeId : typeof body.id === "string" ? body.id : "";
  if (!challengeId) {
    return json({ error: "challengeId required" }, 422, cors);
  }
  const party = Array.isArray(body.party) ? body.party : null;
  if (!party) {
    return json({ error: "party required" }, 422, cors);
  }
  const row = await env.DB.prepare(
    "SELECT id, status, created_by_uid, target_wave, seed, config_json, difficulty, game_mode_id FROM community_challenges WHERE id = ?",
  )
    .bind(challengeId)
    .first<{
      id: string;
      status: string;
      created_by_uid: number | null;
      target_wave: number | null;
      seed: string | null;
      config_json: string;
      difficulty: string | null;
      game_mode_id: number | null;
    }>();
  if (!row) {
    return text("Challenge not found.", 404, cors);
  }
  const isCreator = row.created_by_uid === auth.uid;
  // Only the creator may submit against a not-yet-live challenge (the publish path).
  if (row.status !== "active" && !isCreator) {
    return text("Challenge is not available.", 403, cors);
  }
  const isVictory = body.outcome === "victory" || body.isVictory === true;
  const waveParsed = Number.parseInt(String(body.wave ?? body.waveReached ?? ""), 10);
  const wave = Number.isFinite(waveParsed) ? Math.max(0, Math.min(200, waveParsed)) : null;
  const clearTimeParsed = Number.parseInt(String(body.clearTimeMs ?? body.clearTime ?? ""), 10);
  const clearTimeMs = Number.isFinite(clearTimeParsed) ? Math.max(0, clearTimeParsed) : null;
  const now = Date.now();

  // -------------------------------------------------------------------------
  // CONFIG-MATCH (anti-cheat "you must PROPERLY win it"). A clear is verified only
  // when the submitted run matches the stored challenge - a genuine victory at/after
  // the target wave with the SAME difficulty / game mode / base challenges / seed
  // (communityRunMatchesConfig) AND a legal party (communityPartyLegal: no impossible
  // IVs; every party root in the species whitelist). The publish below is gated on
  // verified===1, so an unmatched / tampered run never goes live. (Deeper ghost-legal
  // species bans need the evolution graph the worker lacks - a follow-up.)
  // -------------------------------------------------------------------------
  let storedConfig: Record<string, unknown> = {};
  try {
    storedConfig = JSON.parse(row.config_json) as Record<string, unknown>;
  } catch {
    storedConfig = {};
  }
  const verified: number =
    communityRunMatchesConfig(body, row, storedConfig, wave, isVictory) && communityPartyLegal(body, storedConfig)
      ? 1
      : 0;
  const status: "cleared" | "failed" = isVictory ? "cleared" : "failed";
  const effective = await upsertCommunityAttempt(env, {
    challengeId,
    userId: auth.uid,
    username: auth.u,
    status,
    wave,
    clearTimeMs,
    verified,
    now,
  });

  // Founder-publish: the creator's first VERIFIED victory flips the draft live.
  // Gated on verified===1 so a tampered / mismatched run can never publish.
  let published = false;
  if (isCreator && isVictory && verified === 1 && row.status === "draft") {
    await env.DB.prepare(
      "UPDATE community_challenges SET status = 'active', published_at = ?2, founder_clear_id = ?3, updated_at = ?2 WHERE id = ?1 AND status = 'draft'",
    )
      .bind(challengeId, now, typeof body.id === "string" ? body.id : challengeId)
      .run();
    published = true;
  }
  return json({ ok: true, status: effective, verified: verified === 1, published }, 200, cors);
}

/** POST /community/bookmark - toggle a bookmark on/off for this player. */
async function handleCommunityBookmark(
  request: Request,
  auth: TokenPayload,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  await ensureCommunityTables(env);
  const body = await parseFormBody(request);
  const challengeId = (body.challengeId ?? "").slice(0, 128);
  if (!challengeId) {
    return json({ error: "challengeId required" }, 422, cors);
  }
  const on = body.on === undefined ? true : body.on === "true" || body.on === "1";
  const now = Date.now();
  if (on) {
    await env.DB.prepare(
      "INSERT INTO community_challenge_bookmarks (user_id, challenge_id, created_at) VALUES (?1, ?2, ?3) ON CONFLICT(user_id, challenge_id) DO NOTHING",
    )
      .bind(auth.uid, challengeId, now)
      .run();
  } else {
    await env.DB.prepare("DELETE FROM community_challenge_bookmarks WHERE user_id = ?1 AND challenge_id = ?2")
      .bind(auth.uid, challengeId)
      .run();
  }
  return json({ ok: true, bookmarked: on }, 200, cors);
}

/** GET /community/bookmarks - this player's bookmarked challenges as entries. */
async function handleCommunityBookmarks(auth: TokenPayload, env: Env, cors: Record<string, string>): Promise<Response> {
  await ensureCommunityTables(env);
  // Qualify every column with `c.` - `created_at` exists in BOTH joined tables.
  const cols = CC_ENTRY_COLS.split(", ")
    .map(col => `c.${col}`)
    .join(", ");
  const { results } = await env.DB.prepare(
    `SELECT ${cols}
       FROM community_challenge_bookmarks b
       JOIN community_challenges c ON c.id = b.challenge_id
      WHERE b.user_id = ?
      ORDER BY b.created_at DESC
      LIMIT 100`,
  )
    .bind(auth.uid)
    .all<CommunityChallengeRow>();
  const items = (results ?? [])
    .filter((row: CommunityChallengeRow) => row.status !== "hidden" && row.status !== "rejected")
    .map((row: CommunityChallengeRow) =>
      buildCommunityEntry(
        row,
        {
          attempts: row.attempts_total,
          cleared: row.cleared_count,
          inProgress: row.inprogress_count,
          failed: row.failed_count,
          recent: [],
        },
        true,
      ),
    );
  return json({ items }, 200, cors);
}

/**
 * GET /community/mine - this player's OWN challenges (MY CHALLENGES tab). Returns ANY
 * status EXCEPT hidden/rejected so unpublished DRAFTS show alongside published ones, with
 * the denormalized attempt counters. Uses idx_cc_author (created_by_uid, created_at DESC).
 */
async function handleCommunityMine(auth: TokenPayload, env: Env, cors: Record<string, string>): Promise<Response> {
  await ensureCommunityTables(env);
  const { results } = await env.DB.prepare(
    `SELECT ${CC_ENTRY_COLS}
       FROM community_challenges
      WHERE created_by_uid = ?
      ORDER BY created_at DESC
      LIMIT 100`,
  )
    .bind(auth.uid)
    .all<CommunityChallengeRow>();
  const items = (results ?? [])
    .filter((row: CommunityChallengeRow) => row.status !== "hidden" && row.status !== "rejected")
    .map((row: CommunityChallengeRow) =>
      buildCommunityEntry(
        row,
        {
          attempts: row.attempts_total,
          cleared: row.cleared_count,
          inProgress: row.inprogress_count,
          failed: row.failed_count,
          recent: [],
        },
        false,
      ),
    );
  return json({ items }, 200, cors);
}

/**
 * POST /community/achv - the player REPORTS their tracked achievement unlocks (the
 * client sends these because system saves are encrypted and the worker can't read
 * achvUnlocks itself). Body: `{ unlocked: Array<{ id: string; at?: number }> }`.
 * Only ids in TRACKED_ACHV_IDS are stored (anything else is ignored - anti-abuse).
 * The UPSERT keeps the EARLIEST unlock time per (user, achv). Always `{ ok: true }`.
 */
async function handleCommunityAchvReport(
  request: Request,
  auth: TokenPayload,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  await ensureCommunityTables(env);
  const raw = await readSaveBody(request);
  if (raw === null) {
    return text("Report too large.", 413, cors);
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return text("Invalid report data.", 400, cors);
  }
  const unlocked = Array.isArray(body.unlocked) ? body.unlocked : [];
  const now = Date.now();
  // Cap the number of processed entries to bound work per request. Build the
  // statement batch functionally (a bare `[]` would infer `never[]`), matching the
  // other batched community handlers - drop malformed / non-tracked ids (anti-abuse).
  const stmts = unlocked.slice(0, 32).flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== "string" || !TRACKED_ACHV_IDS.has(id)) {
      return [];
    }
    const rawAt = Number((entry as { at?: unknown }).at);
    const at = Number.isFinite(rawAt) && rawAt > 0 ? Math.floor(rawAt) : now;
    return [
      env.DB.prepare(
        `INSERT INTO achievement_holders (user_id, achv_id, at, updated_at)
           VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(user_id, achv_id) DO UPDATE SET
             at = MIN(achievement_holders.at, excluded.at),
             updated_at = excluded.updated_at`,
      ).bind(auth.uid, id, at, now),
    ];
  });
  if (stmts.length > 0) {
    await env.DB.batch(stmts);
  }
  return json({ ok: true }, 200, cors);
}

/**
 * GET /community/achv-tally - PUBLIC live holder tally for the tracked achievements.
 * Optional `?ids=INFERNO,X` (defaults to all TRACKED_ACHV_IDS; non-tracked ids are
 * dropped). ALWAYS 200 (empty tally when none), like the browse feed. Returns
 * `{ tally: { <id>: { count, holders: [{ user, at }] } }, totalTrainers }` where
 * `count` is the distinct holder count, `holders` are the earliest 12 (username via
 * JOIN users), and `totalTrainers` is COUNT(*) FROM system_saves (rarity denominator).
 */
async function handleCommunityAchvTally(url: URL, env: Env, cors: Record<string, string>): Promise<Response> {
  await ensureCommunityTables(env);
  const idsParam = (url.searchParams.get("ids") ?? "").trim();
  const requested = idsParam
    ? idsParam
        .split(",")
        .map(s => s.trim())
        .filter(id => TRACKED_ACHV_IDS.has(id))
    : [...TRACKED_ACHV_IDS];
  const ids = [...new Set(requested)];

  const tally: Record<string, { count: number; holders: { user: string; at: number }[] }> = {};
  for (const id of ids) {
    const countRow = await env.DB.prepare("SELECT COUNT(*) AS c FROM achievement_holders WHERE achv_id = ?")
      .bind(id)
      .first<{ c: number }>();
    const { results } = await env.DB.prepare(
      `SELECT u.username AS username, h.at AS at
         FROM achievement_holders h
         LEFT JOIN users u ON u.id = h.user_id
        WHERE h.achv_id = ?
        ORDER BY h.at ASC
        LIMIT 12`,
    )
      .bind(id)
      .all<{ username: string | null; at: number }>();
    const holders = (results ?? []).map((r: { username: string | null; at: number }) => ({
      user: r.username ?? "Trainer",
      at: r.at,
    }));
    tally[id] = { count: countRow?.c ?? 0, holders };
  }

  const totalRow = await env.DB.prepare("SELECT COUNT(*) AS c FROM system_saves").first<{ c: number }>();
  const totalTrainers = totalRow?.c ?? 0;
  return json({ tally, totalTrainers }, 200, cors);
}

// #endregion
// #region showdown escrow (Task D1)
// -----------------------------------------------------------------------------
// Showdown 1v1 stake escrow. The PURE state machine + settlement logic lives in
// ./showdown-escrow.ts (unit-tested with no CF deps); this layer only persists
// records to D1 and shuttles the pure decisions. Saves are opaque, so the server
// NEVER edits a save — it records outcomes and stores per-uid MUTATION records
// that honest clients fetch (/showdown/pending) + apply + ack.
//
// Routes (all authed via authUser):
//   POST /showdown/match          register + hold both stakes (conditional-claim)
//   POST /showdown/battle-entered  both clients ping at battle start (sets flag)
//   POST /showdown/result          dual-attestation report -> settle | void
//   GET  /showdown/pending         unapplied settlement mutations for this uid
//   POST /showdown/pending/ack     mark settlement rows applied
// -----------------------------------------------------------------------------

/** Lone-report silence timer: a survivor's solo forfeit/timeout win settles only after this. */
const SHOWDOWN_SILENCE_MS = 120_000;
/** Defensive body cap for the small showdown POSTs (stakes/reports are tiny JSON). */
const SHOWDOWN_MAX_BODY = 8_192;

let showdownTablesReady = false;
async function ensureShowdownTables(env: Env): Promise<void> {
  if (showdownTablesReady) {
    return;
  }
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS showdown_matches (
       id               TEXT    PRIMARY KEY,
       host_uid         TEXT    NOT NULL,
       guest_uid        TEXT    NOT NULL,
       host_stake_json  TEXT    NOT NULL,
       guest_stake_json TEXT    NOT NULL,
       state            TEXT    NOT NULL DEFAULT 'open',
       battle_entered   INTEGER NOT NULL DEFAULT 0,
       host_report_json TEXT,
       guest_report_json TEXT,
       winner           TEXT,
       created_at       INTEGER NOT NULL,
       resolved_at      INTEGER
     )`,
  ).run();
  // One row per (uid, staked-unlock): a stake can't be committed to two live matches
  // at once. Claimed via INSERT ... ON CONFLICT DO NOTHING + meta.changes (the same
  // conditional-claim idiom as er-coop-api handleLobbyPick). Released on settle/void.
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS showdown_stake_holds (
       uid        TEXT    NOT NULL,
       stake_key  TEXT    NOT NULL,
       match_id   TEXT    NOT NULL,
       created_at INTEGER NOT NULL,
       PRIMARY KEY (uid, stake_key)
     )`,
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS showdown_settlements (
       id            INTEGER PRIMARY KEY AUTOINCREMENT,
       match_id      TEXT    NOT NULL,
       uid           TEXT    NOT NULL,
       mutation_json TEXT    NOT NULL,
       created_at    INTEGER NOT NULL,
       applied_at    INTEGER
     )`,
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_showdown_settle_uid ON showdown_settlements (uid, applied_at)",
  ).run();
  showdownTablesReady = true;
}

/** Best-effort per-uid rate limit (per isolate; bounds abuse within a warm worker). */
const showdownRate = new Map<string, { count: number; resetAt: number }>();
const SHOWDOWN_RATE_WINDOW_MS = 60_000;
const SHOWDOWN_RATE_MAX = 120;
function showdownRateLimited(uid: string, now: number): boolean {
  const slot = showdownRate.get(uid);
  if (!slot || now >= slot.resetAt) {
    showdownRate.set(uid, { count: 1, resetAt: now + SHOWDOWN_RATE_WINDOW_MS });
    return false;
  }
  slot.count++;
  return slot.count > SHOWDOWN_RATE_MAX;
}

/** Read a JSON body under the size cap, or null on oversize/parse failure. */
async function readShowdownBody(request: Request): Promise<Record<string, unknown> | null> {
  const raw = await request.text();
  if (raw.length > SHOWDOWN_MAX_BODY) {
    return null;
  }
  try {
    const obj = JSON.parse(raw);
    return typeof obj === "object" && obj !== null ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Canonical stake identity (uid + this == the staked unlock) for the hold table. */
function stakeKey(s: StakeRecord): string {
  return `${s.speciesId}:${s.shiny ? 1 : 0}:${s.variant}:${s.erBlackShiny ? 1 : 0}`;
}

/** Deserialize a persisted match row into the pure `ShowdownMatchRecord`. */
function rowToMatch(row: Record<string, unknown>): ShowdownMatchRecord | null {
  try {
    const parse = (s: unknown) => (typeof s === "string" && s.length > 0 ? JSON.parse(s) : null);
    return {
      id: String(row.id),
      hostUid: String(row.host_uid),
      guestUid: String(row.guest_uid),
      hostStake: parse(row.host_stake_json) as StakeRecord,
      guestStake: parse(row.guest_stake_json) as StakeRecord,
      state: row.state as ShowdownMatchRecord["state"],
      battlePhaseEntered: Number(row.battle_entered) === 1,
      hostReport: parse(row.host_report_json),
      guestReport: parse(row.guest_report_json),
      winner: (row.winner as MatchRole | null) ?? null,
      createdAt: Number(row.created_at),
      resolvedAt: row.resolved_at == null ? null : Number(row.resolved_at),
    };
  } catch {
    return null;
  }
}

async function loadMatch(env: Env, id: string): Promise<ShowdownMatchRecord | null> {
  const row = await env.DB.prepare("SELECT * FROM showdown_matches WHERE id = ?1").bind(id).first();
  return row ? rowToMatch(row as Record<string, unknown>) : null;
}

/** Statement that writes a match's mutable state (report/winner/state/battle flag). */
function persistMatchStmt(env: Env, m: ShowdownMatchRecord) {
  return env.DB.prepare(
    `UPDATE showdown_matches
        SET state = ?2, battle_entered = ?3, host_report_json = ?4, guest_report_json = ?5,
            winner = ?6, resolved_at = ?7
      WHERE id = ?1`,
  ).bind(
    m.id,
    m.state,
    m.battlePhaseEntered ? 1 : 0,
    m.hostReport ? JSON.stringify(m.hostReport) : null,
    m.guestReport ? JSON.stringify(m.guestReport) : null,
    m.winner,
    m.resolvedAt,
  );
}

/**
 * On settlement: store the per-uid mutation records (idempotent — ON CONFLICT is
 * impossible without a natural key, so guard by only writing when none exist yet)
 * and release BOTH stake holds. Batched so it commits atomically with the match update.
 */
async function finalizeSettlement(env: Env, m: ShowdownMatchRecord, now: number): Promise<void> {
  const stmts = [persistMatchStmt(env, m)];
  // Release the escrow holds for this match (settle or void both free the stakes).
  stmts.push(env.DB.prepare("DELETE FROM showdown_stake_holds WHERE match_id = ?1").bind(m.id));
  if (m.state === "settled") {
    // Guard idempotency: only emit settlement rows the first time (none exist yet).
    const existing = await env.DB.prepare("SELECT COUNT(*) AS c FROM showdown_settlements WHERE match_id = ?1")
      .bind(m.id)
      .first<{ c: number }>();
    if ((existing?.c ?? 0) === 0) {
      for (const mut of resolveSettlement(m)) {
        stmts.push(
          env.DB.prepare(
            "INSERT INTO showdown_settlements (match_id, uid, mutation_json, created_at, applied_at) VALUES (?1, ?2, ?3, ?4, NULL)",
          ).bind(m.id, mut.uid, JSON.stringify(mut), now),
        );
      }
    }
  }
  await env.DB.batch(stmts);
}

/**
 * M1: sweep a uid's OPEN matches and settle any lone survivor report past the silence window
 * (lazy finalization on the pending poll — no cron). Best-effort; a sweep failure never blocks
 * the poll (the caller still gets whatever rows already exist).
 */
async function sweepExpiredLoneReports(env: Env, uid: string): Promise<void> {
  try {
    const now = Date.now();
    const { results } = await env.DB.prepare(
      "SELECT * FROM showdown_matches WHERE state = 'open' AND (host_uid = ?1 OR guest_uid = ?1) LIMIT 50",
    )
      .bind(uid)
      .all();
    for (const row of results ?? []) {
      const m = rowToMatch(row as Record<string, unknown>);
      if (m == null) {
        continue;
      }
      const finalized = finalizeExpiredLoneReport(m, now, SHOWDOWN_SILENCE_MS);
      if (finalized.resolution === "settled" || finalized.resolution === "void") {
        await finalizeSettlement(env, finalized.match, now);
      }
    }
  } catch (err) {
    console.error("er-save-api sweepExpiredLoneReports (non-fatal):", err);
  }
}

async function handleShowdownVoid(request: Request, auth: TokenPayload, env: Env, cors: Record<string, string>) {
  const now = Date.now();
  if (showdownRateLimited(auth.u, now)) {
    return text("Too many requests.", 429, cors);
  }
  const body = await readShowdownBody(request);
  if (body == null) {
    return json({ error: "invalid body" }, 400, cors);
  }
  await ensureShowdownTables(env);
  const id = typeof body.matchId === "string" ? body.matchId : "";
  const m = await loadMatch(env, id);
  if (!m) {
    return json({ error: "no such match" }, 404, cors);
  }
  if (roleOf(m, auth.u) === null) {
    return json({ error: "not a participant" }, 403, cors);
  }
  // Idempotent: only an OPEN match transitions to void; a resolved match returns its state unchanged.
  const voided = voidMatch(m, now);
  if (voided !== m) {
    // Release both stake holds via the same finalize path (void emits no settlement rows).
    await finalizeSettlement(env, voided, now);
  }
  return json({ ok: true, state: voided.state }, 200, cors);
}

async function handleShowdownMatch(request: Request, auth: TokenPayload, env: Env, cors: Record<string, string>) {
  const now = Date.now();
  if (showdownRateLimited(auth.u, now)) {
    return text("Too many requests.", 429, cors);
  }
  const body = await readShowdownBody(request);
  if (body == null) {
    return json({ error: "invalid body" }, 400, cors);
  }
  await ensureShowdownTables(env);

  const id = typeof body.matchId === "string" ? body.matchId : "";
  const hostUid = typeof body.hostUid === "string" ? body.hostUid : "";
  const guestUid = typeof body.guestUid === "string" ? body.guestUid : "";
  const hostStake = body.hostStake;
  const guestStake = body.guestStake;
  // The caller MUST be one of the two named participants (anti-spoof: you can't register
  // a match between two other players). Identity = the token username (auth.u).
  if (auth.u !== hostUid && auth.u !== guestUid) {
    return json({ error: "not a participant" }, 403, cors);
  }
  if (!isStakeRecord(hostStake) || !isStakeRecord(guestStake)) {
    return json({ error: "malformed stake" }, 400, cors);
  }

  // Idempotent: a re-register of the same id returns the existing match. M3: surface the row's
  // STATE explicitly and mark a TERMINAL row (settled/void) as not-ok, so the client treats a stale
  // matchId as a failure (re-register fresh or fall back to Friendly) rather than entering battle on
  // an already-resolved escrow.
  const existing = await loadMatch(env, id);
  if (existing) {
    const terminal = existing.state !== "open";
    return json({ ok: !terminal, matchId: existing.id, state: existing.state }, 200, cors);
  }

  const reg = registerMatch(id, hostUid, guestUid, hostStake, guestStake, now);
  if (!reg.ok) {
    return json({ error: reg.error }, 422, cors);
  }
  const m = reg.match;

  // Claim BOTH stake holds + insert the match atomically. ON CONFLICT DO NOTHING makes
  // an already-held stake a no-op (changes = 0); if either failed to claim we roll back
  // our own inserts (the match + any hold WE added) and report the conflict.
  const holdInsert = (uid: string, s: StakeRecord) =>
    env.DB.prepare(
      "INSERT INTO showdown_stake_holds (uid, stake_key, match_id, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(uid, stake_key) DO NOTHING",
    ).bind(uid, stakeKey(s), m.id, now);
  const results = await env.DB.batch([
    holdInsert(m.hostUid, m.hostStake),
    holdInsert(m.guestUid, m.guestStake),
    env.DB.prepare(
      `INSERT INTO showdown_matches
           (id, host_uid, guest_uid, host_stake_json, guest_stake_json, state, battle_entered, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'open', 0, ?6)
         ON CONFLICT(id) DO NOTHING`,
    ).bind(m.id, m.hostUid, m.guestUid, JSON.stringify(m.hostStake), JSON.stringify(m.guestStake), now),
  ]);
  const hostClaimed = (results[0]?.meta.changes ?? 0) > 0;
  const guestClaimed = (results[1]?.meta.changes ?? 0) > 0;
  if (!hostClaimed || !guestClaimed) {
    // Lost the race on at least one stake. Roll back our own inserts.
    await env.DB.batch([
      env.DB.prepare("DELETE FROM showdown_stake_holds WHERE match_id = ?1").bind(m.id),
      env.DB.prepare("DELETE FROM showdown_matches WHERE id = ?1").bind(m.id),
    ]);
    return json({ error: "a stake is already committed to another match" }, 409, cors);
  }
  return json({ ok: true, matchId: m.id, state: "open" }, 200, cors);
}

async function handleShowdownBattleEntered(
  request: Request,
  auth: TokenPayload,
  env: Env,
  cors: Record<string, string>,
) {
  const now = Date.now();
  if (showdownRateLimited(auth.u, now)) {
    return text("Too many requests.", 429, cors);
  }
  const body = await readShowdownBody(request);
  if (body == null) {
    return json({ error: "invalid body" }, 400, cors);
  }
  await ensureShowdownTables(env);
  const id = typeof body.matchId === "string" ? body.matchId : "";
  const m = await loadMatch(env, id);
  if (!m) {
    return json({ error: "no such match" }, 404, cors);
  }
  if (roleOf(m, auth.u) === null) {
    return json({ error: "not a participant" }, 403, cors);
  }
  const next = recordBattlePhaseEntered(m);
  if (next !== m) {
    await persistMatchStmt(env, next).run();
  }
  return json({ ok: true, state: next.state, battleEntered: next.battlePhaseEntered }, 200, cors);
}

async function handleShowdownResult(request: Request, auth: TokenPayload, env: Env, cors: Record<string, string>) {
  const now = Date.now();
  if (showdownRateLimited(auth.u, now)) {
    return text("Too many requests.", 429, cors);
  }
  const body = await readShowdownBody(request);
  if (body == null) {
    return json({ error: "invalid body" }, 400, cors);
  }
  await ensureShowdownTables(env);
  const id = typeof body.matchId === "string" ? body.matchId : "";
  const winner = body.winner;
  const reason = body.reason;
  if (winner !== "host" && winner !== "guest") {
    return json({ error: "invalid winner" }, 400, cors);
  }
  if (reason !== "victory" && reason !== "forfeit" && reason !== "timeout") {
    return json({ error: "invalid reason" }, 400, cors);
  }
  const m = await loadMatch(env, id);
  if (!m) {
    return json({ error: "no such match" }, 404, cors);
  }
  if (roleOf(m, auth.u) === null) {
    return json({ error: "not a participant" }, 403, cors);
  }
  const applied = applyResultReport(m, auth.u, winner as MatchRole, reason as ResultReason, now, SHOWDOWN_SILENCE_MS);
  if (applied.resolution === "settled" || applied.resolution === "void") {
    await finalizeSettlement(env, applied.match, now);
  } else {
    await persistMatchStmt(env, applied.match).run();
  }
  return json({ ok: true, resolution: applied.resolution, state: applied.match.state }, 200, cors);
}

async function handleShowdownPending(auth: TokenPayload, env: Env, cors: Record<string, string>) {
  await ensureShowdownTables(env);
  // M1 (lazy finalization, no cron): before returning rows, sweep THIS uid's OPEN matches and settle
  // any lone survivor report that is now past the silence window - so an honest survivor's payout
  // materializes on its next poll.
  await sweepExpiredLoneReports(env, auth.u);
  const { results } = await env.DB.prepare(
    "SELECT id, match_id, mutation_json FROM showdown_settlements WHERE uid = ?1 AND applied_at IS NULL ORDER BY id ASC LIMIT 200",
  )
    .bind(auth.u)
    .all<{ id: number; match_id: string; mutation_json: string }>();
  const items = (results ?? [])
    .map(r => {
      try {
        return { id: r.id, matchId: r.match_id, mutation: JSON.parse(r.mutation_json) as SettlementMutation };
      } catch {
        return null;
      }
    })
    .filter((x): x is { id: number; matchId: string; mutation: SettlementMutation } => x !== null);
  return json({ items }, 200, cors);
}

async function handleShowdownPendingAck(request: Request, auth: TokenPayload, env: Env, cors: Record<string, string>) {
  const now = Date.now();
  const body = await readShowdownBody(request);
  if (body == null) {
    return json({ error: "invalid body" }, 400, cors);
  }
  await ensureShowdownTables(env);
  const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is number => Number.isInteger(v)).slice(0, 200) : [];
  if (ids.length === 0) {
    return json({ ok: true, acked: 0 }, 200, cors);
  }
  // Only ack rows belonging to THIS uid (a client can't ack someone else's settlement).
  const placeholders = ids.map((_, i) => `?${i + 2}`).join(",");
  const res = await env.DB.prepare(
    `UPDATE showdown_settlements SET applied_at = ?1 WHERE applied_at IS NULL AND uid = ?${ids.length + 2} AND id IN (${placeholders})`,
  )
    .bind(now, ...ids, auth.u)
    .run();
  return json({ ok: true, acked: res.meta.changes ?? 0 }, 200, cors);
}

/**
 * TOURNAMENT reward delivery (server-to-server, called by the er-telemetry tournament worker).
 * Pushes each winner's reward mutations into the SAME showdown_settlements store the escrow flow
 * uses, so winners receive them on their next login sweep exactly like a staked payout. Auth is a
 * shared worker secret (X-Grant-Auth == SHOWDOWN_GRANT_SECRET), NOT a session token — this is not a
 * player-facing route. Idempotent: rows are keyed by the synthetic match id `tour:<tournamentId>`,
 * and (like escrow) we only insert when NONE exist yet for that match id, so a retry never
 * double-grants. Ledger discipline is unchanged: the client applies each row once (row id + ledger).
 */
async function handleShowdownTournamentGrant(request: Request, env: Env, cors: Record<string, string>) {
  const secret = env.SHOWDOWN_GRANT_SECRET;
  if (!secret) {
    return json({ error: "tournament grant delivery not configured" }, 503, cors);
  }
  const provided = request.headers.get("X-Grant-Auth") ?? "";
  if (!timingSafeEqual(enc.encode(provided), enc.encode(secret))) {
    return json({ error: "unauthorized" }, 401, cors);
  }
  const body = await readShowdownBody(request);
  if (body == null) {
    return json({ error: "invalid body" }, 400, cors);
  }
  const tournamentId = typeof body.tournamentId === "string" ? body.tournamentId : "";
  const grants = Array.isArray(body.grants) ? body.grants : null;
  if (!tournamentId || !grants) {
    return json({ error: "missing tournamentId or grants" }, 400, cors);
  }
  await ensureShowdownTables(env);
  const matchId = `tour:${tournamentId}`;
  const now = Date.now();
  // Idempotency guard (mirrors finalizeSettlement): only insert when no rows exist for this tournament.
  const existing = await env.DB.prepare("SELECT COUNT(*) AS c FROM showdown_settlements WHERE match_id = ?1")
    .bind(matchId)
    .first<{ c: number }>();
  if ((existing?.c ?? 0) > 0) {
    return json({ ok: true, delivered: 0, alreadyDelivered: true }, 200, cors);
  }
  const stmts: D1PreparedStatement[] = [];
  for (const g of grants) {
    if (!g || typeof g !== "object") {
      continue;
    }
    const uid = typeof g.uid === "string" ? g.uid : "";
    const mutation = g.mutation;
    if (!uid || !mutation || typeof mutation !== "object") {
      continue;
    }
    // Stamp the uid INTO the stored mutation json (client mutations carry no uid; escrow rows do).
    const stored = { uid, ...mutation };
    stmts.push(
      env.DB.prepare(
        "INSERT INTO showdown_settlements (match_id, uid, mutation_json, created_at, applied_at) VALUES (?1, ?2, ?3, ?4, NULL)",
      ).bind(matchId, uid, JSON.stringify(stored), now),
    );
  }
  if (stmts.length > 0) {
    await env.DB.batch(stmts);
  }
  return json({ ok: true, delivered: stmts.length }, 200, cors);
}

// #endregion
// #region showdown ranked ladder
// -----------------------------------------------------------------------------
// Showdown ranked ladder (Pokemon-Champions-style). The PURE progression + dual-attestation
// logic lives in ./showdown-rank.ts (unit-tested, no CF deps); this layer only persists rows
// to D1 and shuttles the pure decisions. A ranked result is applied to BOTH players' rows only
// when both clients report the SAME winner (settled), reusing the escrow's double-report/void
// reconciliation, so a single lying client can never self-promote.
//
// Routes (all authed via authUser):
//   GET  /showdown/rank         this player's own ranked state (lazy season reconcile)
//   POST /showdown/rank/result  dual-attestation ranked report -> apply to both rows | void
// -----------------------------------------------------------------------------

let showdownRankTablesReady = false;
async function ensureShowdownRankTables(env: Env): Promise<void> {
  if (showdownRankTablesReady) {
    return;
  }
  // One ranked-state row per player (the ladder position). All self-created on first hit
  // (mirrors ensureShowdownTables), so an already-deployed DB needs no migration.
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS showdown_ranks (
       uid          TEXT    PRIMARY KEY,
       season_id    TEXT    NOT NULL,
       tier         INTEGER NOT NULL DEFAULT 0,
       rank         INTEGER NOT NULL DEFAULT 4,
       segments     INTEGER NOT NULL DEFAULT 0,
       streak       INTEGER NOT NULL DEFAULT 0,
       highest_tier INTEGER NOT NULL DEFAULT 0,
       career_best  INTEGER NOT NULL DEFAULT 0,
       updated_at   INTEGER NOT NULL
     )`,
  ).run();
  // Per (player, opponent) season win counter for anti-win-trading diminishing returns.
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS showdown_rank_opponents (
       uid          TEXT    NOT NULL,
       opponent_uid TEXT    NOT NULL,
       season_id    TEXT    NOT NULL,
       wins         INTEGER NOT NULL DEFAULT 0,
       PRIMARY KEY (uid, opponent_uid)
     )`,
  ).run();
  // Dual-attestation reconciliation ledger for ranked results (mirrors showdown_matches).
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS showdown_rank_matches (
       id                TEXT    PRIMARY KEY,
       host_uid          TEXT    NOT NULL,
       guest_uid         TEXT    NOT NULL,
       state             TEXT    NOT NULL DEFAULT 'open',
       host_report_json  TEXT,
       guest_report_json TEXT,
       winner            TEXT,
       created_at        INTEGER NOT NULL,
       resolved_at       INTEGER
     )`,
  ).run();
  // Per-uid settled-match events queued for the OTHER participant (the first reporter, who got
  // 'pending' at report time) to drain on its next GET /showdown/rank — so both sides' reward
  // hooks fire. The settler receives its events inline in the POST response.
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS showdown_rank_events (
       id          INTEGER PRIMARY KEY AUTOINCREMENT,
       uid         TEXT    NOT NULL,
       match_id    TEXT    NOT NULL,
       events_json TEXT    NOT NULL,
       created_at  INTEGER NOT NULL,
       consumed_at INTEGER
     )`,
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_showdown_rank_events_uid ON showdown_rank_events (uid, consumed_at)",
  ).run();
  showdownRankTablesReady = true;
}

/** Deserialize a persisted rank row into the pure `RankState` (defaulting to the season floor). */
function rowToRankState(row: Record<string, unknown> | null, seasonId: string): RankState {
  if (row == null) {
    return initialRankState(seasonId, MIN_TIER);
  }
  return {
    seasonId: String(row.season_id),
    tier: Number(row.tier) as RankTier,
    rank: Number(row.rank),
    segments: Number(row.segments),
    streak: Number(row.streak),
    highestTierReached: Number(row.highest_tier) as RankTier,
    careerBestTier: Number(row.career_best) as RankTier,
  };
}

/** Upsert statement for a player's rank row. */
function writeRankStateStmt(env: Env, uid: string, s: RankState, now: number) {
  return env.DB.prepare(
    `INSERT INTO showdown_ranks (uid, season_id, tier, rank, segments, streak, highest_tier, career_best, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT(uid) DO UPDATE SET season_id=?2, tier=?3, rank=?4, segments=?5, streak=?6, highest_tier=?7, career_best=?8, updated_at=?9`,
  ).bind(uid, s.seasonId, s.tier, s.rank, s.segments, s.streak, s.highestTierReached, s.careerBestTier, now);
}

/** Load a player's per-opponent season win counter (defaulting to 0 for the current season). */
async function loadOpponentWins(
  env: Env,
  uid: string,
  opponentUid: string,
  seasonId: string,
): Promise<OpponentWinCount> {
  const row = await env.DB.prepare(
    "SELECT season_id, wins FROM showdown_rank_opponents WHERE uid = ?1 AND opponent_uid = ?2",
  )
    .bind(uid, opponentUid)
    .first<{ season_id: string; wins: number }>();
  if (!row) {
    return { seasonId, wins: 0 };
  }
  return { seasonId: String(row.season_id), wins: Number(row.wins) };
}

/** Upsert statement for a per-opponent season win counter. */
function writeOpponentWinsStmt(env: Env, uid: string, opponentUid: string, c: OpponentWinCount) {
  return env.DB.prepare(
    `INSERT INTO showdown_rank_opponents (uid, opponent_uid, season_id, wins)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(uid, opponent_uid) DO UPDATE SET season_id=?3, wins=?4`,
  ).bind(uid, opponentUid, c.seasonId, c.wins);
}

/** Deserialize a rank-match row into the pure `RankMatchRecord`. */
function rowToRankMatch(row: Record<string, unknown>): RankMatchRecord | null {
  try {
    const parse = (s: unknown) => (typeof s === "string" && s.length > 0 ? JSON.parse(s) : null);
    return {
      id: String(row.id),
      hostUid: String(row.host_uid),
      guestUid: String(row.guest_uid),
      state: row.state as RankMatchRecord["state"],
      hostReport: parse(row.host_report_json),
      guestReport: parse(row.guest_report_json),
      winner: (row.winner as RankRole | null) ?? null,
      createdAt: Number(row.created_at),
      resolvedAt: row.resolved_at == null ? null : Number(row.resolved_at),
    };
  } catch {
    return null;
  }
}

/** Persist a rank-match record's mutable state. */
function persistRankMatchStmt(env: Env, m: RankMatchRecord) {
  return env.DB.prepare(
    `INSERT INTO showdown_rank_matches (id, host_uid, guest_uid, state, host_report_json, guest_report_json, winner, created_at, resolved_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT(id) DO UPDATE SET state=?4, host_report_json=?5, guest_report_json=?6, winner=?7, resolved_at=?9`,
  ).bind(
    m.id,
    m.hostUid,
    m.guestUid,
    m.state,
    m.hostReport ? JSON.stringify(m.hostReport) : null,
    m.guestReport ? JSON.stringify(m.guestReport) : null,
    m.winner,
    m.createdAt,
    m.resolvedAt,
  );
}

/**
 * Apply a SETTLED ranked match to both players' rows: the winner gains, the loser loses, each
 * counting the other as the opponent (anti-win-trading). Idempotent by match id (the settlement
 * rows are written once; a re-settle is a no-op because the match is already 'settled'). Returns
 * the CALLER's result events (for the inline POST response); the OTHER participant's events are
 * queued for it to drain on GET /showdown/rank.
 */
async function applyRankSettlement(
  env: Env,
  m: RankMatchRecord,
  callerUid: string,
  now: number,
): Promise<RankResultEvents> {
  const seasonId = seasonIdFromTime(now);
  const winnerRole = m.winner;
  const winnerUid = winnerRole === "host" ? m.hostUid : m.guestUid;
  const loserUid = winnerRole === "host" ? m.guestUid : m.hostUid;

  const [winnerRow, loserRow] = await Promise.all([
    env.DB.prepare("SELECT * FROM showdown_ranks WHERE uid = ?1").bind(winnerUid).first(),
    env.DB.prepare("SELECT * FROM showdown_ranks WHERE uid = ?1").bind(loserUid).first(),
  ]);
  const winnerCounter = await loadOpponentWins(env, winnerUid, loserUid, seasonId);
  const loserCounter = await loadOpponentWins(env, loserUid, winnerUid, seasonId);

  const winnerRes = applyRankedResult(
    rowToRankState(winnerRow as Record<string, unknown> | null, seasonId),
    winnerCounter,
    {
      won: true,
      now,
    },
  );
  const loserRes = applyRankedResult(
    rowToRankState(loserRow as Record<string, unknown> | null, seasonId),
    loserCounter,
    {
      won: false,
      now,
    },
  );

  const callerEvents = callerUid === winnerUid ? winnerRes.events : loserRes.events;
  const otherUid = callerUid === winnerUid ? loserUid : winnerUid;
  const otherEvents = callerUid === winnerUid ? loserRes.events : winnerRes.events;

  await env.DB.batch([
    writeRankStateStmt(env, winnerUid, winnerRes.state, now),
    writeRankStateStmt(env, loserUid, loserRes.state, now),
    writeOpponentWinsStmt(env, winnerUid, loserUid, winnerRes.opponentWins),
    writeOpponentWinsStmt(env, loserUid, winnerUid, loserRes.opponentWins),
    // Queue the OTHER participant's events for it to drain on its next GET (it got 'pending' earlier).
    env.DB.prepare(
      "INSERT INTO showdown_rank_events (uid, match_id, events_json, created_at, consumed_at) VALUES (?1, ?2, ?3, ?4, NULL)",
    ).bind(otherUid, m.id, JSON.stringify(otherEvents), now),
  ]);
  return callerEvents;
}

async function handleShowdownRank(auth: TokenPayload, env: Env, cors: Record<string, string>): Promise<Response> {
  const now = Date.now();
  await ensureShowdownRankTables(env);
  const seasonId = seasonIdFromTime(now);
  const row = await env.DB.prepare("SELECT * FROM showdown_ranks WHERE uid = ?1").bind(auth.u).first();
  const stored = rowToRankState(row as Record<string, unknown> | null, seasonId);
  // Lazy season reconcile: a stale-season row resets to the pokeball floor and surfaces the prior
  // final tier ONCE for the season-end reward hook (fires on first login of a new season, not only
  // on the first match).
  const { state, seasonEndedFinalTier } = reconcileSeason(stored, now);
  if (row != null && state !== stored) {
    await writeRankStateStmt(env, auth.u, state, now).run();
  }
  // Drain any queued settled-match events for this uid (the first-reporter delivery path).
  const pending = await env.DB.prepare(
    "SELECT id, events_json FROM showdown_rank_events WHERE uid = ?1 AND consumed_at IS NULL ORDER BY id ASC LIMIT 50",
  )
    .bind(auth.u)
    .all<{ id: number; events_json: string }>();
  const pendingEvents: RankResultEvents[] = [];
  const drainedIds: number[] = [];
  for (const r of pending.results ?? []) {
    try {
      pendingEvents.push(JSON.parse(r.events_json) as RankResultEvents);
      drainedIds.push(r.id);
    } catch {
      drainedIds.push(r.id); // drop a corrupt row so it doesn't wedge the queue
    }
  }
  if (drainedIds.length > 0) {
    const ph = drainedIds.map((_, i) => `?${i + 2}`).join(",");
    await env.DB.prepare(`UPDATE showdown_rank_events SET consumed_at = ?1 WHERE id IN (${ph})`)
      .bind(now, ...drainedIds)
      .run();
  }
  return json({ ok: true, state, seasonEndedFinalTier, pendingEvents }, 200, cors);
}

async function handleShowdownRankResult(
  request: Request,
  auth: TokenPayload,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const now = Date.now();
  if (showdownRateLimited(auth.u, now)) {
    return text("Too many requests.", 429, cors);
  }
  const body = await readShowdownBody(request);
  if (body == null) {
    return json({ error: "invalid body" }, 400, cors);
  }
  await ensureShowdownRankTables(env);
  const id = typeof body.matchId === "string" ? body.matchId : "";
  const hostUid = typeof body.hostUid === "string" ? body.hostUid : "";
  const guestUid = typeof body.guestUid === "string" ? body.guestUid : "";
  const winner = body.winner;
  if (!id || !hostUid || !guestUid || hostUid === guestUid) {
    return json({ error: "invalid match" }, 400, cors);
  }
  if (winner !== "host" && winner !== "guest") {
    return json({ error: "invalid winner" }, 400, cors);
  }
  // The reporter MUST be one of the two named participants (anti-spoof: you can't report someone
  // else's ranked match). Identity = the token username.
  if (auth.u !== hostUid && auth.u !== guestUid) {
    return json({ error: "not a participant" }, 403, cors);
  }
  const existingRow = await env.DB.prepare("SELECT * FROM showdown_rank_matches WHERE id = ?1").bind(id).first();
  const match = existingRow
    ? rowToRankMatch(existingRow as Record<string, unknown>)
    : newRankMatch(id, hostUid, guestUid, now);
  if (match == null) {
    return json({ error: "corrupt match" }, 500, cors);
  }
  if (rankRoleOf(match, auth.u) === null) {
    return json({ error: "not a participant" }, 403, cors);
  }
  // Capture whether the match was ALREADY resolved BEFORE this report, so a duplicate/retry report
  // of an already-settled match can never re-apply the ladder progression (rank rows are mutable, not
  // append-only — double-applying would corrupt them). Progression applies ONLY on the transition.
  const wasResolved = match.state !== "open";
  const applied = applyRankReport(match, auth.u, winner as RankRole, now);
  await persistRankMatchStmt(env, applied.match).run();
  if (applied.resolution === "settled" && !wasResolved) {
    const events = await applyRankSettlement(env, applied.match, auth.u, now);
    const seasonId = seasonIdFromTime(now);
    const row = await env.DB.prepare("SELECT * FROM showdown_ranks WHERE uid = ?1").bind(auth.u).first();
    return json(
      {
        ok: true,
        resolution: "settled",
        state: rowToRankState(row as Record<string, unknown> | null, seasonId),
        events,
      },
      200,
      cors,
    );
  }
  return json({ ok: true, resolution: applied.resolution, state: null }, 200, cors);
}

// #endregion

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(computeAndPublishUsageTiers(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(env, origin);
    const { pathname } = url;
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      // ---- public (no auth) ----
      if (pathname === "/account/register" && method === "POST") {
        return await handleRegister(request, env, cors);
      }
      if (pathname === "/account/login" && method === "POST") {
        return await handleLogin(request, env, cors);
      }
      if (pathname === "/game/titlestats" && method === "GET") {
        return await handleTitleStats(env, cors);
      }
      if (pathname === "/daily/seed" && method === "GET") {
        return handleDailySeed(cors);
      }
      // Shared dev TEST-SUITE progress (staging-only suite; public, non-sensitive).
      if (pathname === "/devtest/progress" && method === "GET") {
        return await handleDevTestProgress(env, cors);
      }
      if (pathname === "/devtest/event" && method === "POST") {
        return await handleDevTestEvent(request, env, cors);
      }
      // Community challenges - read surface is public (browse feed + detail), like
      // /devtest/* and /game/titlestats. Always 200 on an empty feed.
      if (pathname === "/community/challenges" && method === "GET") {
        return await handleCommunityList(url, env, cors);
      }
      if (pathname === "/community/challenge" && method === "GET") {
        return await handleCommunityDetail(url, env, cors);
      }
      // Live tracked-achievement holder tally (Inferno rarity). Public, always 200.
      if (pathname === "/community/achv-tally" && method === "GET") {
        return await handleCommunityAchvTally(url, env, cors);
      }
      // Logout is harmless without a valid token (tokens are stateless); the
      // client clears its cookie regardless.
      if (pathname === "/account/logout" && method === "GET") {
        return text("", 200, cors);
      }

      // Tournament reward delivery — server-to-server from er-telemetry, authenticated by the shared
      // SHOWDOWN_GRANT_SECRET (X-Grant-Auth), NOT a session token. Placed in the unauthenticated block.
      if (pathname === "/showdown/tournament-grant" && method === "POST") {
        return await handleShowdownTournamentGrant(request, env, cors);
      }

      // ---- authenticated ----
      const auth = await authUser(request, env);
      if (!auth) {
        return text("Unauthorized.", 401, cors);
      }

      if (pathname === "/account/info" && method === "GET") {
        return await handleAccountInfo(auth, env, cors);
      }
      if (pathname === "/account/coop-ticket" && method === "GET") {
        return await handleCoopIdentityTicket(auth, env, cors);
      }
      if (pathname === "/account/changepw" && method === "POST") {
        return await handleChangePassword(request, auth, env, cors);
      }
      if (pathname === "/savedata/system/get" && method === "GET") {
        return await handleSystemGet(auth, env, cors);
      }
      if (pathname === "/savedata/system/verify" && method === "GET") {
        return await handleSystemVerify(auth, env, cors);
      }
      if (pathname === "/savedata/system/update" && method === "POST") {
        return await handleSystemUpdate(request, url, auth, env, cors);
      }
      if (pathname === "/savedata/session/get" && method === "GET") {
        return await handleSessionGet(url, auth, env, cors);
      }
      if (pathname === "/savedata/session/update" && method === "POST") {
        return await handleSessionUpdate(request, url, auth, env, cors);
      }
      if (pathname === "/savedata/session/coop-cas-update" && method === "POST") {
        return await handleCoopSessionCasUpdate(request, url, auth, env, cors);
      }
      if (pathname === "/savedata/session/coop-cas-delete" && method === "POST") {
        return await handleCoopSessionCasDelete(url, auth, env, cors);
      }
      if (pathname === "/savedata/session/coop-duplicate-exact-delete" && method === "POST") {
        return await handleCoopDuplicateExactDelete(url, auth, env, cors);
      }
      if (pathname === "/savedata/session/coop-run-status" && method === "GET") {
        return await handleCoopRunStatus(url, auth, env, cors);
      }
      if (pathname === "/savedata/session/opaque-exact-delete" && method === "POST") {
        return await handleOpaqueSessionExactDelete(url, auth, env, cors);
      }
      if (pathname === "/savedata/session/legacy-coop-exact-delete" && method === "POST") {
        return await handleLegacyCoopSessionExactDelete(url, auth, env, cors);
      }
      if (pathname === "/savedata/session/delete" && method === "GET") {
        return await handleSessionDelete(url, auth, env, cors);
      }
      if (pathname === "/savedata/session/clear" && method === "POST") {
        return await handleSessionClear(request, url, auth, env, cors);
      }
      if (pathname === "/savedata/session/newclear" && method === "GET") {
        // Report the run as newly cleared (client uses this for first-clear UX).
        return json(true, 200, cors);
      }
      if (pathname === "/savedata/updateall" && method === "POST") {
        return await handleUpdateAll(request, auth, env, cors);
      }
      if (pathname === "/savedata/run" && method === "POST") {
        return await handleRunCreate(request, auth, env, cors);
      }
      if (pathname === "/savedata/run/sample" && method === "GET") {
        return await handleRunSample(url, auth, env, cors);
      }
      if (pathname === "/savedata/run/deadliest" && method === "GET") {
        return await handleRunDeadliest(url, auth, env, cors);
      }
      if (pathname === "/savedata/run/ghost-notifications" && method === "GET") {
        return await handleGhostNotifications(url, auth, env, cors);
      }
      if (pathname === "/savedata/notifications" && method === "GET") {
        return await handleNotifications(url, auth, env, cors);
      }
      // Community challenges - authed write surface (create / attempt / clear /
      // bookmark) + the player's bookmarks list.
      if (pathname === "/community/challenge" && method === "POST") {
        return await handleCommunityCreate(request, auth, env, cors);
      }
      if (pathname === "/community/attempt" && method === "POST") {
        return await handleCommunityAttempt(request, auth, env, cors);
      }
      if (pathname === "/community/clear" && method === "POST") {
        return await handleCommunityClear(request, auth, env, cors);
      }
      if (pathname === "/community/bookmark" && method === "POST") {
        return await handleCommunityBookmark(request, auth, env, cors);
      }
      if (pathname === "/community/bookmarks" && method === "GET") {
        return await handleCommunityBookmarks(auth, env, cors);
      }
      if (pathname === "/community/mine" && method === "GET") {
        return await handleCommunityMine(auth, env, cors);
      }
      // Player reports their tracked achievement unlocks (system saves are encrypted,
      // so the worker can't read achvUnlocks itself). Only TRACKED_ACHV_IDS are stored.
      if (pathname === "/community/achv" && method === "POST") {
        return await handleCommunityAchvReport(request, auth, env, cors);
      }
      // Showdown 1v1 escrow (D1). All authed; the pure state machine is in ./showdown-escrow.ts.
      if (pathname === "/showdown/match" && method === "POST") {
        return await handleShowdownMatch(request, auth, env, cors);
      }
      if (pathname === "/showdown/battle-entered" && method === "POST") {
        return await handleShowdownBattleEntered(request, auth, env, cors);
      }
      if (pathname === "/showdown/result" && method === "POST") {
        return await handleShowdownResult(request, auth, env, cors);
      }
      if (pathname === "/showdown/void" && method === "POST") {
        return await handleShowdownVoid(request, auth, env, cors);
      }
      if (pathname === "/showdown/pending" && method === "GET") {
        return await handleShowdownPending(auth, env, cors);
      }
      if (pathname === "/showdown/pending/ack" && method === "POST") {
        return await handleShowdownPendingAck(request, auth, env, cors);
      }
      // Showdown ranked ladder (Pokemon-Champions-style). Pure logic in ./showdown-rank.ts.
      if (pathname === "/showdown/rank" && method === "GET") {
        return await handleShowdownRank(auth, env, cors);
      }
      if (pathname === "/showdown/rank/result" && method === "POST") {
        return await handleShowdownRankResult(request, auth, env, cors);
      }

      return text("Not found.", 404, cors);
    } catch (err) {
      console.error("er-save-api error:", err);
      return text("Internal server error.", 500, cors);
    }
  },
};
