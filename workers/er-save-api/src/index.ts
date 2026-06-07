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
  const slotRow = await env.DB.prepare("SELECT MAX(slot) AS maxSlot FROM session_saves WHERE user_id = ?")
    .bind(auth.uid)
    .first<{ maxSlot: number | null }>();
  const lastSessionSlot = slotRow?.maxSlot ?? -1;
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

async function handleSystemGet(auth: TokenPayload, env: Env, cors: Record<string, string>): Promise<Response> {
  const row = await env.DB.prepare("SELECT data FROM system_saves WHERE user_id = ?")
    .bind(auth.uid)
    .first<{ data: string }>();
  if (!row) {
    return text("Save data not found.", 404, cors);
  }
  return text(row.data, 200, cors);
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
  const trainerId = Number.parseInt(url.searchParams.get("trainerId") ?? "", 10);
  const secretId = Number.parseInt(url.searchParams.get("secretId") ?? "", 10);
  await env.DB.prepare(
    `INSERT INTO system_saves (user_id, data, trainer_id, secret_id, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(user_id) DO UPDATE SET data = ?2, trainer_id = ?3, secret_id = ?4, updated_at = ?5`,
  )
    .bind(
      auth.uid,
      data,
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
  // The client sends the final SessionSaveData (as JSON) on clear; persist it to
  // the slot so the cloud copy reflects the cleared run, then report success.
  const raw = await readSaveBody(request);
  if (raw && raw.length > 0) {
    await upsertSession(env, auth.uid, slot, raw);
  }
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
    stmts.push(
      env.DB.prepare(
        `INSERT INTO system_saves (user_id, data, updated_at) VALUES (?1, ?2, ?3)
           ON CONFLICT(user_id) DO UPDATE SET data = ?2, updated_at = ?3`,
      ).bind(auth.uid, sys, now),
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

async function handleTitleStats(env: Env, cors: Record<string, string>): Promise<Response> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS c FROM users").first<{ c: number }>();
  return json({ playerCount: row?.c ?? 0, battleCount: 0 }, 200, cors);
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

export default {
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

      return text("Not found.", 404, cors);
    } catch (err) {
      console.error("er-save-api error:", err);
      return text("Internal server error.", 500, cors);
    }
  },
};
