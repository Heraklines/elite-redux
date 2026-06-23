/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

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
// pure HMAC check (no DB read), which keeps us well inside the free-tier request
// budget.
//
// Storage: D1 (SQLite). One row per account in `users`, one `system_saves` row
// per user, up to five `session_saves` rows per user. Saves are opaque blobs
// (the client encrypts them); the server never inspects them.
//
// Capacity (free tier): the binding limit is D1 writes (100k/day) and Worker
// requests (100k/day). With the client's debounced sync (~40 writes/day/active
// player) that comfortably hosts ~1,000-1,500 daily-active players; the $5/mo
// Workers Paid plan (50M writes/mo) scales to ~40,000.
// =============================================================================

interface Env {
  DB: D1Database;
  /** Secret used to sign/verify session tokens. Set via `wrangler secret put`. */
  SESSION_SECRET: string;
  /** Optional comma-separated origin allowlist; "*" / unset = allow all. */
  ALLOWED_ORIGIN?: string;
  MIN_USERNAME_LENGTH?: string;
  MIN_PASSWORD_LENGTH?: string;
  /** PAT with push access to Heraklines/er-assets (usage-tiers cron). Set via `wrangler secret put`. */
  ER_ASSETS_TOKEN?: string;
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

const enc = new TextEncoder();
const dec = new TextDecoder();

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_LEN = 32;
/** Max accepted save-blob size (defensive; ER system saves are well under this). */
const MAX_SAVE_BYTES = 4_000_000;

// #region helpers — encoding

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) {
    s += String.fromCharCode(b);
  }
  return btoa(s);
}
function fromBase64(b64: string): Uint8Array {
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

async function pbkdf2(password: string, salt: Uint8Array, iterations: number, keyLen: number): Promise<Uint8Array> {
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

async function hmacSha256(data: Uint8Array, secret: string): Promise<Uint8Array> {
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
  const slot = Number.parseInt(url.searchParams.get("slot") ?? "", 10);
  if (!Number.isFinite(slot) || slot < 0 || slot > 4) {
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

async function upsertSession(env: Env, userId: number, slot: number, data: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO session_saves (user_id, slot, data, updated_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(user_id, slot) DO UPDATE SET data = ?3, updated_at = ?4`,
  )
    .bind(userId, slot, data, Date.now())
    .run();
}

async function handleSessionUpdate(
  request: Request,
  url: URL,
  auth: TokenPayload,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const slot = parseSlot(url);
  if (slot === null) {
    return text("Invalid slot.", 400, cors);
  }
  const data = await readSaveBody(request);
  if (data === null) {
    return text("Save data too large.", 413, cors);
  }
  await upsertSession(env, auth.uid, slot, data);
  return text("", 200, cors);
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
  await env.DB.prepare("DELETE FROM session_saves WHERE user_id = ? AND slot = ?").bind(auth.uid, slot).run();
  return text("", 200, cors);
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
  await readSaveBody(request); // drain the request body (final session, unused)
  await env.DB.prepare("DELETE FROM session_saves WHERE user_id = ? AND slot = ?").bind(auth.uid, slot).run();
  return json({ success: true }, 200, cors);
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
  if (payload.system !== undefined && payload.system !== null) {
    const sys = typeof payload.system === "string" ? payload.system : JSON.stringify(payload.system);
    const allowReset = new URL(request.url).searchParams.get("allowReset") === "1";
    const guard = await guardSystemOverwrite(env, auth.uid, sys, allowReset, cors);
    if (guard) {
      return guard;
    }
    const storedSys = await compressSave(sys);
    stmts.push(
      env.DB.prepare(
        `INSERT INTO system_saves (user_id, data, updated_at) VALUES (?1, ?2, ?3)
           ON CONFLICT(user_id) DO UPDATE SET data = ?2, updated_at = ?3`,
      ).bind(auth.uid, storedSys, now),
    );
  }
  const slot = Number.parseInt(String(payload.sessionSlotId ?? ""), 10);
  if (payload.session !== undefined && payload.session !== null && Number.isFinite(slot) && slot >= 0 && slot <= 4) {
    const sess = typeof payload.session === "string" ? payload.session : JSON.stringify(payload.session);
    stmts.push(
      env.DB.prepare(
        `INSERT INTO session_saves (user_id, slot, data, updated_at) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(user_id, slot) DO UPDATE SET data = ?3, updated_at = ?4`,
      ).bind(auth.uid, slot, sess, now),
    );
  }
  if (stmts.length > 0) {
    await env.DB.batch(stmts);
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
  const outcome =
    run.outcome === "victory" || run.outcome === "defeat" ? run.outcome : run.isVictory ? "victory" : "defeat";
  const wave = Number.parseInt(String(run.wave ?? run.waveReached ?? ""), 10);
  const createdAt = Number.parseInt(String(run.timestamp ?? ""), 10);
  // ER (#384): usage-tier inputs ride the SAME single insert - no extra
  // requests or writes. Lazy one-time column migration below.
  const starters = Array.isArray(run.starters) ? run.starters.filter(v => typeof v === "number") : null;
  const challenges = Array.isArray(run.challenges) ? run.challenges : null;
  await ensureRunStatColumns(env);
  await env.DB.prepare(
    `INSERT INTO runs (id, user_id, username, outcome, difficulty, mode, wave, created_at, player_team, opponent_name, opponent_team, starters, challenges, killed_by_ghost, ghost_source_name, ghost_source_run_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
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
  const { results } = await env.DB.prepare(
    `SELECT id, username, outcome, difficulty, wave, created_at, player_team, opponent_name, opponent_team
       FROM runs
       WHERE user_id != ?1 AND wave >= ?2
       ORDER BY RANDOM() LIMIT ?3`,
  )
    .bind(auth.uid, minWave, count)
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
          party: JSON.parse(row.player_team),
          opponentName: row.opponent_name ?? undefined,
          opponentParty: row.opponent_team ? JSON.parse(row.opponent_team) : undefined,
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
            r.opponent_name, r.opponent_team, COUNT(*) AS kills
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
// scans the 30-day run window, computes deduped per-player usage + shrunken
// per-difficulty wave lift per starter LINE, and commits usage-tiers.json to
// Heraklines/er-assets (served to clients by jsDelivr - zero worker reads).
// Skips silently when ER_ASSETS_TOKEN is unset.
// =============================================================================
const USAGE_TIER_CHALLENGE_ID = 12; // Challenges.USAGE_TIER - excluded from usage stats

async function computeAndPublishUsageTiers(env: Env): Promise<void> {
  if (!env.ER_ASSETS_TOKEN) {
    return;
  }
  await ensureRunStatColumns(env);
  const since = Date.now() - 30 * 24 * 3600 * 1000;
  const { results } = await env.DB.prepare(
    "SELECT user_id, starters, challenges, difficulty, wave, outcome FROM runs WHERE created_at >= ?1 AND starters IS NOT NULL",
  )
    .bind(since)
    .all<{
      user_id: string;
      starters: string;
      challenges: string | null;
      difficulty: string | null;
      wave: number | null;
      outcome: string;
    }>();

  const players = new Set<string>();
  const linePlayers = new Map<number, Set<string>>();
  const stratWaves = new Map<string, number[]>();
  const lineWaves = new Map<number, Map<string, number[]>>();
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
    const inUsageTierRun = challenges.some(([cid, value]) => cid === USAGE_TIER_CHALLENGE_ID && value > 0);
    const diff = row.difficulty ?? "unknown";
    const wave = row.wave ?? 0;
    players.add(row.user_id);
    let sw = stratWaves.get(diff);
    if (!sw) {
      sw = [];
      stratWaves.set(diff, sw);
    }
    sw.push(wave);
    for (const line of new Set(starters)) {
      // Usage-tier-challenge runs are FORCED picks within a restricted pool;
      // counting them would feed the tiers back into themselves. Their
      // PERFORMANCE still counts (cleanest in-tier signal).
      if (!inUsageTierRun) {
        let lp = linePlayers.get(line);
        if (!lp) {
          lp = new Set();
          linePlayers.set(line, lp);
        }
        lp.add(row.user_id);
      }
      let byDiff = lineWaves.get(line);
      if (!byDiff) {
        byDiff = new Map();
        lineWaves.set(line, byDiff);
      }
      let lw = byDiff.get(diff);
      if (!lw) {
        lw = [];
        byDiff.set(diff, lw);
      }
      lw.push(wave);
    }
  }
  if (players.size === 0) {
    return; // No starter-tagged runs yet - keep the seed file as-is.
  }

  const stratMean = new Map<string, number>();
  for (const [diff, waves] of stratWaves) {
    stratMean.set(diff, waves.reduce((a, b) => a + b, 0) / waves.length);
  }
  const lines: Record<number, { usagePct: number; lift: number; sample: number }> = {};
  for (const [line, byDiff] of lineWaves) {
    let liftSum = 0;
    let n = 0;
    for (const [diff, waves] of byDiff) {
      const mu = stratMean.get(diff) ?? 0;
      // Empirical-Bayes shrinkage: 25 phantom runs at the stratum mean.
      const shrunk = (waves.reduce((a, b) => a + b, 0) + 25 * mu) / (waves.length + 25);
      liftSum += (shrunk - mu) * waves.length;
      n += waves.length;
    }
    lines[line] = {
      usagePct: Math.round((100 * (linePlayers.get(line)?.size ?? 0) * 1000) / players.size) / 1000,
      lift: n > 0 ? Math.round((liftSum / n) * 100) / 100 : 0,
      sample: n,
    };
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    windowDays: 30,
    players: players.size,
    runs: results?.length ?? 0,
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
      // Logout is harmless without a valid token (tokens are stateless); the
      // client clears its cookie regardless.
      if (pathname === "/account/logout" && method === "GET") {
        return text("", 200, cors);
      }

      // ---- authenticated ----
      const auth = await authUser(request, env);
      if (!auth) {
        return text("Unauthorized.", 401, cors);
      }

      if (pathname === "/account/info" && method === "GET") {
        return await handleAccountInfo(auth, env, cors);
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

      return text("Not found.", 404, cors);
    } catch (err) {
      console.error("er-save-api error:", err);
      return text("Internal server error.", 500, cors);
    }
  },
};
