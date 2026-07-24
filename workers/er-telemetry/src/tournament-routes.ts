/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown TOURNAMENT worker routes (P1). D1 persistence + HTTP dispatch around
// the PURE domain (tournament.ts / tournament-bracket.ts). Mirrors the escrow
// worker's discipline:
//   - admin routes (create / close-registration / cancel / resolve) are gated by
//     a numeric-uid ALLOWLIST (TOURNAMENT_ADMIN_UIDS wrangler var), checked off the
//     verified token uid — a client cannot forge it.
//   - the result route requires ATTESTATION: the reporter is the authenticated
//     account, and applyResultReport only accepts a winner that is one of the two
//     PAIRED accounts of that match; a result settles only from AGREEING dual
//     reports (escrow's dual-attestation), never a lone or third-party report.
// The authoritative match state is the bracket JSON on the tournament row.
// =============================================================================

import {
  applyScheduledClose,
  type BattleFormat,
  cancelTournament,
  classifyRegistration,
  closeRegistration,
  computeRewardGrants,
  createCommunityTournament,
  createTournament,
  type EntrantRecord,
  editTournament,
  type GhostIconSummary,
  type GrantDeliveryResult,
  kickEntrant,
  makeEntrant,
  type RewardPool,
  reseedTournament,
  type SeriesFormat,
  sanitizeGhostIcon,
  sanitizeRewardPool,
  syncCompletion,
  type TournamentGrantSettlement,
  type TournamentRecord,
  tournamentGrantSettlements,
  winsNeededForSeries,
  withdrawEntrant,
} from "./tournament";
import {
  applyResultReport,
  applySeriesGameReport,
  type Bracket,
  findMatch,
  manualResolve,
  recordPresence,
  resolveExpiredMatches,
  seriesScore,
} from "./tournament-bracket";

// Minimal structural D1 surface (the subset this module uses). Declared locally so
// the module stays free of `@cloudflare/workers-types` and imports cleanly into a
// plain vitest (the escrow "zero CF deps" pattern) — the real `D1Database` and the
// test's in-memory fake both structurally satisfy it.
export interface D1StmtLike {
  bind(...args: unknown[]): D1StmtLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
}
export interface D1Like {
  prepare(sql: string): D1StmtLike;
}

export interface TournamentEnv {
  DB: D1Like;
  /** Comma-separated numeric admin account uids (from wrangler var). */
  TOURNAMENT_ADMIN_UIDS?: string;
  /**
   * Shared team EDITOR password (the SAME secret as er-editor-api's EDITOR_PASSWORD). A caller
   * presenting it in the `X-Editor-Auth` header is granted tournament ADMIN, in addition to the
   * uid allowlist — so any teammate using the editor page's existing password can administer
   * tournaments without a personal admin-uid entry. Unset = editor-password auth disabled.
   */
  EDITOR_PASSWORD?: string | undefined;
  /** er-editor-api base URL - the delegated editor-password verifier (zero-setup team admin). */
  EDITOR_API_URL?: string;
  /** Base URL of the er-save-api worker (settlement store) for server-to-server reward delivery. */
  SAVE_API_URL?: string;
  /**
   * Shared secret authenticating the tournament→save-api reward push (the SAME value must be set
   * on er-save-api as SHOWDOWN_GRANT_SECRET). Sent as `X-Grant-Auth`. Unset = delivery disabled.
   */
  SHOWDOWN_GRANT_SECRET?: string;
  /**
   * Test seam: overrides the server-to-server reward delivery. Production leaves this unset and
   * uses the default fetch-based sink (SAVE_API_URL + SHOWDOWN_GRANT_SECRET).
   */
  grantSink?: (tournamentId: string, settlements: TournamentGrantSettlement[]) => Promise<GrantDeliveryResult>;
}

/** The authenticated caller (mirrors index.ts TokenPayload). */
export interface Caller {
  uid: number;
  u: string;
  /** Set when the caller presented the shared editor password — grants admin regardless of uid. */
  editorAdmin?: boolean;
}

type Cors = Record<string, string>;
function json(body: unknown, status: number, cors: Cors): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
}

function isAdmin(env: TournamentEnv, caller: Caller): boolean {
  // The shared editor-password credential grants admin regardless of uid (team access).
  if (caller.editorAdmin === true) {
    return true;
  }
  const raw = env.TOURNAMENT_ADMIN_UIDS ?? "";
  return raw
    .split(",")
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .some(s => Number(s) === caller.uid);
}

/** Constant-time string compare (both operands are shared secrets, not attacker-chosen hashes). */
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** True when the request carries a valid `X-Editor-Auth` header matching the shared editor password. */
/**
 * Editor-password verification cache (per-isolate). Delegated checks hit er-editor-api over the
 * network; cache a short-lived verdict per provided value so the admin UI's bursts of calls cost
 * one probe. Values are never stored - only a digest of the provided credential.
 */
const editorAuthCache = new Map<string, { ok: boolean; until: number }>();

async function sha256Hex(v: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Zero-setup team admin (maintainer 2026-07-21): verify the shared editor password WITHOUT this
 * worker holding its own copy. If a local EDITOR_PASSWORD secret happens to be configured it is
 * used directly; otherwise the check is DELEGATED to er-editor-api's /auth-check (the service
 * that already owns the secret). Positive verdicts cache 5 minutes, negatives 30 seconds.
 */
async function editorAuthValid(request: Request, env: TournamentEnv): Promise<boolean> {
  const provided = request.headers.get("X-Editor-Auth");
  if (typeof provided !== "string" || provided.length === 0) {
    return false;
  }
  const secret = env.EDITOR_PASSWORD;
  if (secret) {
    return timingSafeEqualStr(provided, secret);
  }
  const base = env.EDITOR_API_URL;
  if (!base) {
    return false;
  }
  const key = await sha256Hex(provided);
  const now = Date.now();
  const hit = editorAuthCache.get(key);
  if (hit && hit.until > now) {
    return hit.ok;
  }
  let ok = false;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/auth-check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: provided }),
    });
    ok = res.status === 200;
  } catch {
    ok = false; // editor API unreachable -> fail closed; uid-allowlist admin still works
  }
  editorAuthCache.set(key, { ok, until: now + (ok ? 300_000 : 30_000) });
  return ok;
}

/** Synthetic identity for an editor-password-only caller (no personal account). uid < 0 never collides. */
const EDITOR_ADMIN_CALLER: Caller = { uid: -1, u: "editor", editorAdmin: true };

// #region storage

let tablesReady = false;
async function ensureTournamentTables(env: TournamentEnv): Promise<void> {
  if (tablesReady) {
    return;
  }
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS tournaments (
       id TEXT PRIMARY KEY, name TEXT NOT NULL, organizer TEXT NOT NULL, state TEXT NOT NULL,
       round_window_ms INTEGER NOT NULL, max_entrants INTEGER NOT NULL, created_at INTEGER NOT NULL,
       started_at INTEGER, champion TEXT, bracket_json TEXT,
       battle_format TEXT, series_format TEXT, reward_pool_json TEXT, close_at INTEGER, rewards_granted INTEGER )`,
  ).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_tour_state ON tournaments (state, created_at)").run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS tournament_entrants (
       tournament_id TEXT NOT NULL, participant TEXT NOT NULL, name TEXT NOT NULL, preset_name TEXT NOT NULL,
       seed INTEGER, registered_at INTEGER NOT NULL, ghost_json TEXT, last_seen INTEGER,
       ready_match_id TEXT, ready_opponent TEXT, ready_at INTEGER, waitlisted INTEGER,
       PRIMARY KEY (tournament_id, participant) )`,
  ).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_entrant_tour ON tournament_entrants (tournament_id)").run();
  // Additive online migration for tables created BEFORE these columns existed (the LIVE sample-cup
  // rows): SQLite has no "ADD COLUMN IF NOT EXISTS", so attempt each ALTER and swallow the
  // "duplicate column name" error once the column is already present.
  await addColumnIfMissing(env, "tournament_entrants", "ghost_json", "TEXT");
  await addColumnIfMissing(env, "tournament_entrants", "last_seen", "INTEGER");
  await addColumnIfMissing(env, "tournament_entrants", "ready_match_id", "TEXT");
  await addColumnIfMissing(env, "tournament_entrants", "ready_opponent", "TEXT");
  await addColumnIfMissing(env, "tournament_entrants", "ready_at", "INTEGER");
  await addColumnIfMissing(env, "tournament_entrants", "waitlisted", "INTEGER");
  await addColumnIfMissing(env, "tournaments", "battle_format", "TEXT");
  await addColumnIfMissing(env, "tournaments", "series_format", "TEXT");
  await addColumnIfMissing(env, "tournaments", "reward_pool_json", "TEXT");
  await addColumnIfMissing(env, "tournaments", "close_at", "INTEGER");
  await addColumnIfMissing(env, "tournaments", "rewards_granted", "INTEGER");
  await addColumnIfMissing(env, "tournaments", "community", "INTEGER");
  tablesReady = true;
}

/** Best-effort `ALTER TABLE ... ADD COLUMN` that no-ops when the column already exists. */
async function addColumnIfMissing(env: TournamentEnv, table: string, column: string, type: string): Promise<void> {
  try {
    await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
  } catch {
    // Column already present (duplicate column name) — expected on every warm start.
  }
}

interface TournamentRow {
  id: string;
  name: string;
  organizer: string;
  state: string;
  round_window_ms: number;
  max_entrants: number;
  created_at: number;
  started_at: number | null;
  champion: string | null;
  bracket_json: string | null;
  battle_format: string | null;
  series_format: string | null;
  reward_pool_json: string | null;
  close_at: number | null;
  rewards_granted: number | null;
  community: number | null;
}

function parseRewardPool(raw: string | null | undefined): RewardPool {
  if (!raw) {
    return [];
  }
  try {
    return sanitizeRewardPool(JSON.parse(raw));
  } catch {
    return [];
  }
}

function rowToRecord(row: TournamentRow): TournamentRecord {
  return {
    id: row.id,
    name: row.name,
    organizer: row.organizer,
    state: row.state as TournamentRecord["state"],
    roundWindowMs: row.round_window_ms,
    maxEntrants: row.max_entrants,
    createdAt: row.created_at,
    startedAt: row.started_at,
    champion: row.champion,
    bracket: row.bracket_json ? (JSON.parse(row.bracket_json) as Bracket) : null,
    battleFormat: (row.battle_format as BattleFormat) ?? "singles",
    seriesFormat: (row.series_format as SeriesFormat) ?? "single",
    rewardPool: parseRewardPool(row.reward_pool_json),
    closeAt: row.close_at ?? null,
    rewardsGranted: row.rewards_granted === 1,
    community: row.community === 1,
  };
}

async function loadTournament(env: TournamentEnv, id: string): Promise<TournamentRecord | null> {
  const row = await env.DB.prepare("SELECT * FROM tournaments WHERE id = ?").bind(id).first<TournamentRow>();
  return row ? rowToRecord(row) : null;
}

function parseGhost(raw: string | null | undefined): GhostIconSummary | null {
  if (!raw) {
    return null;
  }
  try {
    return sanitizeGhostIcon(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Load ALL rows (active + waitlisted), ordered by registration time. */
async function loadAllEntrants(env: TournamentEnv, id: string): Promise<EntrantRecord[]> {
  const res = await env.DB.prepare(
    "SELECT participant, name, preset_name, seed, registered_at, ghost_json, last_seen, ready_match_id, ready_opponent, ready_at, waitlisted FROM tournament_entrants WHERE tournament_id = ? ORDER BY registered_at",
  )
    .bind(id)
    .all<{
      participant: string;
      name: string;
      preset_name: string;
      seed: number | null;
      registered_at: number;
      ghost_json?: string | null;
      last_seen?: number | null;
      ready_match_id?: string | null;
      ready_opponent?: string | null;
      ready_at?: number | null;
      waitlisted?: number | null;
    }>();
  return (res.results ?? []).map(r => ({
    tournamentId: id,
    participant: r.participant,
    name: r.name,
    presetName: r.preset_name,
    seed: r.seed,
    registeredAt: r.registered_at,
    ghost: parseGhost(r.ghost_json),
    lastSeen: r.last_seen ?? null,
    readyMatchId: r.ready_match_id ?? null,
    readyOpponent: r.ready_opponent ?? null,
    readyAt: r.ready_at ?? null,
    waitlisted: r.waitlisted === 1,
  }));
}

/** The ACTIVE field (waitlist excluded) — what the bracket/close/seed paths operate on. */
async function loadEntrants(env: TournamentEnv, id: string): Promise<EntrantRecord[]> {
  return (await loadAllEntrants(env, id)).filter(e => !e.waitlisted);
}

/** The WAITLIST (queued beyond cap), in registration order (first = next to promote). */
async function loadWaitlist(env: TournamentEnv, id: string): Promise<EntrantRecord[]> {
  return (await loadAllEntrants(env, id)).filter(e => e.waitlisted);
}

async function insertTournament(env: TournamentEnv, t: TournamentRecord): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO tournaments (id, name, organizer, state, round_window_ms, max_entrants, created_at, started_at, champion, bracket_json, battle_format, series_format, reward_pool_json, close_at, rewards_granted, community)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)`,
  )
    .bind(
      t.id,
      t.name,
      t.organizer,
      t.state,
      t.roundWindowMs,
      t.maxEntrants,
      t.createdAt,
      t.startedAt,
      t.champion,
      t.bracket ? JSON.stringify(t.bracket) : null,
      t.battleFormat,
      t.seriesFormat,
      t.rewardPool.length > 0 ? JSON.stringify(t.rewardPool) : null,
      t.closeAt,
      t.rewardsGranted ? 1 : 0,
      t.community ? 1 : 0,
    )
    .run();
}

async function updateTournament(env: TournamentEnv, t: TournamentRecord): Promise<void> {
  await env.DB.prepare(
    `UPDATE tournaments SET name=?2, state=?3, started_at=?4, champion=?5, bracket_json=?6, round_window_ms=?7,
       max_entrants=?8, battle_format=?9, series_format=?10, reward_pool_json=?11, close_at=?12, rewards_granted=?13 WHERE id=?1`,
  )
    .bind(
      t.id,
      t.name,
      t.state,
      t.startedAt,
      t.champion,
      t.bracket ? JSON.stringify(t.bracket) : null,
      t.roundWindowMs,
      t.maxEntrants,
      t.battleFormat,
      t.seriesFormat,
      t.rewardPool.length > 0 ? JSON.stringify(t.rewardPool) : null,
      t.closeAt,
      t.rewardsGranted ? 1 : 0,
    )
    .run();
}

// #endregion
// #region serialization for the client

/** The public view of a tournament (list/bracket response). `entrants` is the ACTIVE field. */
function tournamentView(t: TournamentRecord, entrants: EntrantRecord[], waitlist: EntrantRecord[] = []) {
  return {
    id: t.id,
    name: t.name,
    organizer: t.organizer,
    state: t.state,
    roundWindowMs: t.roundWindowMs,
    maxEntrants: t.maxEntrants,
    createdAt: t.createdAt,
    startedAt: t.startedAt,
    champion: t.champion,
    // P3: format + reward exposure (engine enforcement is a separate workstream).
    battleFormat: t.battleFormat,
    seriesFormat: t.seriesFormat,
    rewardPool: t.rewardPool,
    closeAt: t.closeAt,
    rewardsGranted: t.rewardsGranted,
    community: t.community,
    // Kept in the light list view so a walked-over entrant is not still labelled registered.
    kicked: t.bracket?.kicked ?? [],
    entrantCount: entrants.length,
    entrants: entrants.map(e => ({
      participant: e.participant,
      name: e.name,
      seed: e.seed,
      ghost: e.ghost ?? null,
      lastSeen: e.lastSeen ?? null,
      readyMatchId: e.readyMatchId ?? null,
      readyOpponent: e.readyOpponent ?? null,
      readyAt: e.readyAt ?? null,
      presetName: e.presetName,
    })),
    // P3: the waitlist (admin surface) — queued beyond cap, in promotion order.
    waitlist: waitlist.map(e => ({
      participant: e.participant,
      name: e.name,
      ghost: e.ghost ?? null,
      lastSeen: e.lastSeen ?? null,
      presetName: e.presetName,
    })),
    bracket: t.bracket,
  };
}

// #endregion
// #region route handlers

async function handleCreate(body: any, caller: Caller, env: TournamentEnv, cors: Cors): Promise<Response> {
  if (!isAdmin(env, caller)) {
    return json({ error: "not authorized to create tournaments" }, 403, cors);
  }
  const id =
    typeof body?.id === "string" && body.id.length > 0 ? body.id : `t${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const res = createTournament(
    id,
    caller.u,
    {
      name: body?.name,
      roundWindowMs: body?.roundWindowMs,
      maxEntrants: body?.maxEntrants,
      battleFormat: body?.battleFormat,
      seriesFormat: body?.seriesFormat,
      rewardPool: body?.rewardPool,
      closeAt: body?.closeAt,
    },
    Date.now(),
  );
  if (!res.ok) {
    return json({ error: res.error }, 422, cors);
  }
  await ensureTournamentTables(env);
  await insertTournament(env, res.tournament);
  return json({ ok: true, tournament: tournamentView(res.tournament, []) }, 200, cors);
}

/** Count a creator's ACTIVE (registration / in_progress) tournaments — the community anti-spam gate. */
async function countActiveByOrganizer(env: TournamentEnv, organizer: string): Promise<number> {
  const res = await env.DB.prepare(
    "SELECT id FROM tournaments WHERE organizer = ? AND state IN ('registration','in_progress')",
  )
    .bind(organizer)
    .all<{ id: string }>();
  return (res.results ?? []).length;
}

/**
 * P3 COMMUNITY CREATE: any authenticated player (NOT just admins) may create a small, PRIZE-FREE
 * tournament in-game. The reward pool is forced empty and the cap is clamped to COMMUNITY_MAX_ENTRANTS
 * (both enforced in createCommunityTournament); anti-spam limits a creator to one active tournament.
 */
async function handleCommunityCreate(body: any, caller: Caller, env: TournamentEnv, cors: Cors): Promise<Response> {
  await ensureTournamentTables(env);
  const active = await countActiveByOrganizer(env, caller.u);
  const id =
    typeof body?.id === "string" && body.id.length > 0 ? body.id : `c${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const res = createCommunityTournament(
    id,
    caller.u,
    {
      name: body?.name,
      roundWindowMs: body?.roundWindowMs,
      maxEntrants: body?.maxEntrants,
      battleFormat: body?.battleFormat,
      seriesFormat: body?.seriesFormat,
      closeAt: body?.closeAt,
    },
    active,
    Date.now(),
  );
  if (!res.ok) {
    return json({ error: res.error }, 422, cors);
  }
  await insertTournament(env, res.tournament);
  return json({ ok: true, tournament: tournamentView(res.tournament, []) }, 200, cors);
}

async function handleCloseRegistration(body: any, caller: Caller, env: TournamentEnv, cors: Cors): Promise<Response> {
  if (!isAdmin(env, caller)) {
    return json({ error: "not authorized" }, 403, cors);
  }
  const t = await loadTournament(env, String(body?.id));
  if (!t) {
    return json({ error: "tournament not found" }, 404, cors);
  }
  const entrants = await loadEntrants(env, t.id);
  // P1: no ladder rank lookup wired here yet — seed by registration order (rankOf -> null).
  const res = closeRegistration(t, entrants, () => null, Date.now());
  if (!res.ok) {
    return json({ error: res.error }, 422, cors);
  }
  await updateTournament(env, res.tournament);
  await persistSeeds(env, t.id, res.seeded);
  const updated = await loadEntrants(env, t.id);
  const waitlist = await loadWaitlist(env, t.id);
  return json({ ok: true, tournament: tournamentView(res.tournament, updated, waitlist) }, 200, cors);
}

async function handleCancel(body: any, caller: Caller, env: TournamentEnv, cors: Cors): Promise<Response> {
  const t = await loadTournament(env, String(body?.id));
  if (!t) {
    return json({ error: "tournament not found" }, 404, cors);
  }
  // Admin, OR the ORGANIZER themselves (a community creator can cancel their OWN tournament).
  if (!isAdmin(env, caller) && caller.u !== t.organizer) {
    return json({ error: "not authorized" }, 403, cors);
  }
  const res = cancelTournament(t);
  if (!res.ok) {
    return json({ error: res.error }, 422, cors);
  }
  await updateTournament(env, res.tournament);
  return json({ ok: true }, 200, cors);
}

async function handleRegister(body: any, caller: Caller, env: TournamentEnv, cors: Cors): Promise<Response> {
  const loaded = await loadTournament(env, String(body?.id));
  if (!loaded) {
    return json({ error: "tournament not found" }, 404, cors);
  }
  const now = Date.now();
  // P3: enforce any scheduled registration close LAZILY before classifying this join.
  const t = await enforceScheduledClose(env, loaded, now);
  const entrants = await loadEntrants(env, t.id);
  const waitlist = await loadWaitlist(env, t.id);
  const presetName = String(body?.presetName ?? "");
  const outcome = classifyRegistration(t, entrants, waitlist, caller.u, presetName);
  if (!outcome.ok) {
    return json({ error: outcome.error }, 422, cors);
  }
  // P1.5: the registration payload carries the entrant's ghost-trainer appearance summary
  // (sprite key / name / title). Sanitize on receipt (the ghost-profile rule) before persisting.
  const ghost = sanitizeGhostIcon(body?.ghost);
  const waitlisted = outcome.kind === "waitlist";
  const entrant = makeEntrant(t.id, caller.u, presetName, now, waitlisted);
  await env.DB.prepare(
    "INSERT INTO tournament_entrants (tournament_id, participant, name, preset_name, seed, registered_at, ghost_json, last_seen, waitlisted) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
  )
    .bind(
      t.id,
      entrant.participant,
      entrant.name,
      entrant.presetName,
      null,
      entrant.registeredAt,
      ghost ? JSON.stringify(ghost) : null,
      now,
      waitlisted ? 1 : 0,
    )
    .run();

  if (waitlisted) {
    return json({ ok: true, waitlisted: true, autoClosed: false }, 200, cors);
  }

  // P1.5 AUTO-CLOSE AT CAP: the moment this successful insert fills maxEntrants, run the SAME
  // seeded close/generate path the admin close-registration route uses — no organizer step.
  const afterInsert = await loadEntrants(env, t.id);
  let autoClosed = false;
  if (t.state === "registration" && afterInsert.length >= t.maxEntrants) {
    const closed = closeRegistration(t, afterInsert, () => null, now);
    if (closed.ok) {
      await updateTournament(env, closed.tournament);
      await persistSeeds(env, t.id, closed.seeded);
      autoClosed = true;
    }
  }
  return json({ ok: true, waitlisted: false, autoClosed }, 200, cors);
}

/** Persist assigned seeds back onto the entrant rows. */
async function persistSeeds(
  env: TournamentEnv,
  id: string,
  seeded: { participant: string; seed: number }[],
): Promise<void> {
  for (const s of seeded) {
    await env.DB.prepare("UPDATE tournament_entrants SET seed=?3 WHERE tournament_id=?1 AND participant=?2")
      .bind(id, s.participant, s.seed)
      .run();
  }
}

/**
 * P3 LAZY scheduled close (no cron): if a closeAt has passed while the tournament is still in
 * registration with enough entrants, close + generate NOW and persist. Returns the possibly-updated
 * record so the caller reads the post-close state. Called at the top of read/register handlers.
 */
async function enforceScheduledClose(env: TournamentEnv, t: TournamentRecord, now: number): Promise<TournamentRecord> {
  if (t.state !== "registration" || t.closeAt === null || now < t.closeAt) {
    return t;
  }
  const entrants = await loadEntrants(env, t.id);
  const res = applyScheduledClose(t, entrants, () => null, now);
  if (!res.closed) {
    return t;
  }
  await updateTournament(env, res.tournament);
  await persistSeeds(env, t.id, res.seeded);
  return res.tournament;
}

/** Build a seed lookup (participant -> seed) from the active field, for the deadline resolver. */
function seedLookup(entrants: EntrantRecord[]): (participant: string) => number | null {
  const bySeed = new Map<string, number | null>();
  for (const e of entrants) {
    bySeed.set(e.participant, e.seed);
  }
  return (p: string) => bySeed.get(p) ?? null;
}

/**
 * P2 LAZY DEADLINE AUTO-RESOLUTION (no cron): resolve every expired, undecided match on this read
 * (presence-based activity win; higher seed when neither/both present). IDEMPOTENT — a decided match
 * is never re-resolved. Persists the advanced bracket + any completion, then fires reward granting
 * automatically if the final resolved. Returns the possibly-updated record. Safe on non-started
 * tournaments (no-op). Called alongside {@link enforceScheduledClose} at the top of read handlers.
 */
async function enforceDeadlines(env: TournamentEnv, t: TournamentRecord, now: number): Promise<TournamentRecord> {
  if (t.state !== "in_progress" || t.bracket === null) {
    return t;
  }
  const entrants = await loadEntrants(env, t.id);
  const { resolved } = resolveExpiredMatches(t.bracket, seedLookup(entrants), now);
  if (resolved.length === 0) {
    return t;
  }
  const synced = syncCompletion({ ...t, bracket: t.bracket });
  await updateTournament(env, synced);
  return maybeAutoGrantRewards(env, synced);
}

/** Scheduled close THEN deadline auto-resolution — the full lazy refresh applied on every read. */
async function refreshTournament(env: TournamentEnv, t: TournamentRecord, now: number): Promise<TournamentRecord> {
  const closed = await enforceScheduledClose(env, t, now);
  return enforceDeadlines(env, closed, now);
}

/**
 * Deliver a completed tournament's reward pool through the settlement pipeline (er-save-api's
 * pending-settlement store — same trusted client-apply as stakes). Idempotent server-side, so a
 * retry after a partial failure never double-grants. Shared by the manual /grant-rewards route and
 * the automatic on-completion grant.
 */
async function deliverRewards(env: TournamentEnv, t: TournamentRecord): Promise<GrantDeliveryResult> {
  const settlements = tournamentGrantSettlements(t);
  const sink = env.grantSink ?? ((id, s) => defaultGrantSink(env, id, s));
  return sink(t.id, settlements);
}

/**
 * P2 CHAMPION COMPLETION: when a tournament is complete with an ungranted, non-empty reward pool,
 * grant + deliver the rewards AUTOMATICALLY (no admin click needed) — invoked after any path that can
 * complete the tournament (result report, manual resolve, kick-walkover, deadline auto-resolution).
 * Delivery runs BEFORE the rewardsGranted flag is set and is idempotent server-side, so a failure
 * leaves the flag false (retried on the next completing read or via the manual route). Returns the
 * (possibly flag-updated) record.
 */
async function maybeAutoGrantRewards(env: TournamentEnv, t: TournamentRecord): Promise<TournamentRecord> {
  if (t.state !== "complete" || t.rewardsGranted || t.rewardPool.length === 0) {
    return t;
  }
  const delivery = await deliverRewards(env, t);
  if (!delivery.ok) {
    return t; // leave rewardsGranted false — retryable
  }
  const granted: TournamentRecord = { ...t, rewardsGranted: true };
  await updateTournament(env, granted);
  return granted;
}

async function handleWithdraw(body: any, caller: Caller, env: TournamentEnv, cors: Cors): Promise<Response> {
  const t = await loadTournament(env, String(body?.id));
  if (!t) {
    return json({ error: "tournament not found" }, 404, cors);
  }
  const entrants = await loadEntrants(env, t.id);
  const res = withdrawEntrant(t, entrants, caller.u);
  if (!res.ok) {
    return json({ error: res.error }, 422, cors);
  }
  await env.DB.prepare("DELETE FROM tournament_entrants WHERE tournament_id=?1 AND participant=?2")
    .bind(t.id, caller.u)
    .run();
  return json({ ok: true }, 200, cors);
}

/**
 * P1.5 PRESENCE PING: the client pings while sitting on the board / in the tournament lobby;
 * the worker stamps `last_seen` for this entrant so the board can show "A: FIGHT" (present) vs
 * "last seen <ago>". DISPLAY-only for now — the P2 activity-win logic is out of scope. No-op
 * (still 200) if the caller is not an entrant of this tournament.
 */
async function handlePing(body: any, caller: Caller, env: TournamentEnv, cors: Cors): Promise<Response> {
  const t = await loadTournament(env, String(body?.id ?? body?.tournamentId));
  if (!t) {
    return json({ error: "tournament not found" }, 404, cors);
  }
  const now = Date.now();
  await env.DB.prepare("UPDATE tournament_entrants SET last_seen=?3 WHERE tournament_id=?1 AND participant=?2")
    .bind(t.id, caller.u, now)
    .run();
  // P2: stamp the per-window presence aggregate on this player's open match(es) so the deadline
  // resolver can award an activity win to a lone-present player. Persist the bracket only if changed.
  if (t.bracket !== null && t.state === "in_progress" && recordPresence(t.bracket, caller.u, now)) {
    await updateTournament(env, t);
  }
  return json({ ok: true }, 200, cors);
}

/**
 * Mark readiness for one exact pairing. Both the match id and opponent are persisted so a reseed or
 * admin opponent swap cannot accidentally carry readiness into a different pairing at the same slot.
 */
function activePairing(
  t: TournamentRecord,
  participant: string,
  matchId: string,
): { matchId: string; opponent: string } | null {
  if (t.state !== "in_progress" || t.bracket === null) {
    return null;
  }
  const match = findMatch(t.bracket, matchId);
  const opponent = match?.a === participant ? match.b : match?.b === participant ? match.a : null;
  return match?.winner === null && match.a !== null && match.b !== null && opponent !== null
    ? { matchId: match.id, opponent }
    : null;
}

async function readyResponse(
  t: TournamentRecord,
  caller: string,
  matchId: string,
  env: TournamentEnv,
  cors: Cors,
): Promise<Response> {
  const entrants = await loadEntrants(env, t.id);
  const waitlist = await loadWaitlist(env, t.id);
  const pairing = activePairing(t, caller, matchId);
  const opponentEntrant = entrants.find(e => e.participant === pairing?.opponent);
  const opponentReady =
    pairing !== null && opponentEntrant?.readyMatchId === pairing.matchId && opponentEntrant.readyOpponent === caller;
  return json({ ok: true, opponentReady, tournament: tournamentView(t, entrants, waitlist) }, 200, cors);
}

async function handleReady(body: any, caller: Caller, env: TournamentEnv, cors: Cors): Promise<Response> {
  const loaded = await loadTournament(env, String(body?.id ?? body?.tournamentId));
  if (!loaded) {
    return json({ error: "tournament not found" }, 404, cors);
  }
  const t = await refreshTournament(env, loaded, Date.now());
  const allEntrants = await loadAllEntrants(env, t.id);
  const ownEntrant = allEntrants.find(e => e.participant === caller.u && !e.waitlisted);
  if (!ownEntrant) {
    return json({ error: "not an active entrant" }, 422, cors);
  }

  const matchId = String(body?.matchId ?? "");
  if (body?.ready !== true) {
    await env.DB.prepare(
      "UPDATE tournament_entrants SET ready_match_id=NULL, ready_opponent=NULL, ready_at=NULL WHERE tournament_id=?1 AND participant=?2",
    )
      .bind(t.id, caller.u)
      .run();
    return readyResponse(t, caller.u, matchId, env, cors);
  }

  const pairing = activePairing(t, caller.u, matchId);
  if (pairing === null) {
    return json({ error: "that pairing is no longer active" }, 409, cors);
  }
  const now = Date.now();
  await env.DB.prepare(
    "UPDATE tournament_entrants SET ready_match_id=?3, ready_opponent=?4, ready_at=?5, last_seen=?5 WHERE tournament_id=?1 AND participant=?2",
  )
    .bind(t.id, caller.u, pairing.matchId, pairing.opponent, now)
    .run();
  return readyResponse(t, caller.u, pairing.matchId, env, cors);
}

async function handleList(env: TournamentEnv, cors: Cors): Promise<Response> {
  await ensureTournamentTables(env);
  const res = await env.DB.prepare(
    "SELECT * FROM tournaments WHERE state IN ('registration','in_progress','complete') ORDER BY created_at DESC LIMIT 50",
  ).all<TournamentRow>();
  const rows = res.results ?? [];
  const now = Date.now();
  const list: Record<string, unknown>[] = [];
  for (const row of rows) {
    // P3 scheduled close + P2 deadline auto-resolution, enforced lazily on the list read (no cron).
    const t = await refreshTournament(env, rowToRecord(row), now);
    const entrants = await loadEntrants(env, t.id);
    const waitlist = await loadWaitlist(env, t.id);
    // list view is light: no full bracket
    const { bracket: _bracket, ...light } = tournamentView(t, entrants, waitlist);
    list.push(light);
  }
  return json({ ok: true, tournaments: list }, 200, cors);
}

async function handleBracket(url: URL, env: TournamentEnv, cors: Cors): Promise<Response> {
  const id = url.searchParams.get("id") ?? "";
  const loaded = await loadTournament(env, id);
  if (!loaded) {
    return json({ error: "tournament not found" }, 404, cors);
  }
  const t = await refreshTournament(env, loaded, Date.now());
  const entrants = await loadEntrants(env, t.id);
  const waitlist = await loadWaitlist(env, t.id);
  return json({ ok: true, tournament: tournamentView(t, entrants, waitlist) }, 200, cors);
}

async function handleResult(body: any, caller: Caller, env: TournamentEnv, cors: Cors): Promise<Response> {
  const t = await loadTournament(env, String(body?.tournamentId ?? body?.id));
  if (!t || t.bracket === null) {
    return json({ error: "tournament not found or not started" }, 404, cors);
  }
  const matchId = String(body?.matchId ?? "");
  const winner = String(body?.winner ?? "");
  const match = findMatch(t.bracket, matchId);
  if (!match) {
    return json({ error: "match not found" }, 404, cors);
  }
  // ATTESTATION: the reporter is the authenticated account, and must be one of the two paired
  // players of this match (both engines enforce winner ∈ {a,b} too). SERIES (bo3/bo5): each game
  // is dual-attested at GAME granularity via `gameIndex`; the match only settles once a player
  // clinches the series (winsNeededForSeries). A single-game tournament keeps the original path.
  const winsToClinch = winsNeededForSeries(t.seriesFormat);
  const now = Date.now();
  const res =
    winsToClinch <= 1
      ? applyResultReport(t.bracket, matchId, caller.u, winner, now)
      : applySeriesGameReport(
          t.bracket,
          matchId,
          caller.u,
          winner,
          coerceGameIndex(body?.gameIndex),
          winsToClinch,
          now,
        );
  const synced = syncCompletion({ ...t, bracket: res.bracket });
  await updateTournament(env, synced);
  // P2: champion completion -> auto-grant rewards (no admin click), idempotent + retryable.
  await maybeAutoGrantRewards(env, synced);
  const settledMatch = findMatch(synced.bracket as Bracket, matchId);
  return json(
    {
      ok: true,
      resolution: res.resolution,
      match: settledMatch,
      // The board's live series score after this report (0-0 for a single game). The client uses it
      // to render "1-0" and to gate the series intermission vs the return to title.
      seriesScore: settledMatch ? seriesScore(settledMatch) : { a: 0, b: 0 },
    },
    200,
    cors,
  );
}

/** Clamp an untrusted gameIndex to a non-negative integer (defaults to game 0). */
function coerceGameIndex(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

async function handleResolve(body: any, caller: Caller, env: TournamentEnv, cors: Cors): Promise<Response> {
  const t = await loadTournament(env, String(body?.tournamentId ?? body?.id));
  if (!t || t.bracket === null) {
    return json({ error: "tournament not found or not started" }, 404, cors);
  }
  // Organizer-only: the creating admin, or any allowlisted admin.
  if (!isAdmin(env, caller) && caller.u !== t.organizer) {
    return json({ error: "not authorized to resolve matches" }, 403, cors);
  }
  const res = manualResolve(t.bracket, String(body?.matchId ?? ""), String(body?.winner ?? ""));
  const synced = syncCompletion({ ...t, bracket: res.bracket });
  await updateTournament(env, synced);
  // P2: a manual resolve that decides the final also auto-grants rewards.
  await maybeAutoGrantRewards(env, synced);
  return json(
    { ok: true, resolution: res.resolution, match: findMatch(synced.bracket as Bracket, res.matchId) },
    200,
    cors,
  );
}

// #endregion
// #region P3 admin routes (kick / edit / reseed / delete / grant-rewards)

/** Admin gate shared by the P3 mutation routes: allowlisted admin OR the creating organizer. */
async function requireAdminOrOrganizer(
  body: any,
  caller: Caller,
  env: TournamentEnv,
  cors: Cors,
): Promise<{ t: TournamentRecord } | Response> {
  const t = await loadTournament(env, String(body?.id ?? body?.tournamentId));
  if (!t) {
    return json({ error: "tournament not found" }, 404, cors);
  }
  if (!isAdmin(env, caller) && caller.u !== t.organizer) {
    return json({ error: "not authorized" }, 403, cors);
  }
  return { t };
}

/**
 * P3 KICK (scenarios 2, 3, 8). In registration: remove the entrant, promote the first waitlisted
 * member into the freed slot (and re-auto-close if the field refills to cap). Auto-closed-but-not-
 * played: REOPEN registration (drop the bracket) + promote. Mid-tournament: WALKOVER (opponent
 * advances; the kicked player's row is kept, flagged on the bracket).
 */
async function handleKick(body: any, caller: Caller, env: TournamentEnv, cors: Cors): Promise<Response> {
  const gate = await requireAdminOrOrganizer(body, caller, env, cors);
  if (gate instanceof Response) {
    return gate;
  }
  return removeEntrant(gate.t, String(body?.participant ?? ""), env, cors);
}

/** Shared persistence for an admin kick and an entrant's own explicit dropout. */
async function removeEntrant(t: TournamentRecord, target: string, env: TournamentEnv, cors: Cors): Promise<Response> {
  const entrants = await loadEntrants(env, t.id);
  const waitlist = await loadWaitlist(env, t.id);
  const now = Date.now();
  const res = kickEntrant(t, entrants, waitlist, target, now);
  if (!res.ok) {
    return json({ error: res.error }, 422, cors);
  }

  if (res.kind === "walkover") {
    // Keep the kicked entrant row; persist the advanced bracket + any completion.
    await updateTournament(env, res.tournament);
    // P2: a walkover that decides the final auto-grants rewards.
    await maybeAutoGrantRewards(env, res.tournament);
  } else {
    // registration / reopen: remove the kicked field row, promote the first waitlisted member.
    await env.DB.prepare("DELETE FROM tournament_entrants WHERE tournament_id=?1 AND participant=?2")
      .bind(t.id, res.removed)
      .run();
    if (res.kind === "reopen") {
      // Undo the generation: revert to registration + clear every seed.
      await updateTournament(env, res.tournament);
      await env.DB.prepare("UPDATE tournament_entrants SET seed=NULL WHERE tournament_id=?1").bind(t.id).run();
    }
    if (res.promoted) {
      await env.DB.prepare("UPDATE tournament_entrants SET waitlisted=0 WHERE tournament_id=?1 AND participant=?2")
        .bind(t.id, res.promoted)
        .run();
    }
    // If the promotion refilled the field to cap while in registration, auto-close again.
    const activeNow = await loadEntrants(env, res.tournament.id);
    if (res.tournament.state === "registration" && activeNow.length >= res.tournament.maxEntrants) {
      const closed = closeRegistration(res.tournament, activeNow, () => null, now);
      if (closed.ok) {
        await updateTournament(env, closed.tournament);
        await persistSeeds(env, res.tournament.id, closed.seeded);
      }
    }
  }

  const finalT = (await loadTournament(env, t.id)) ?? res.tournament;
  const finalEntrants = await loadEntrants(env, t.id);
  const finalWaitlist = await loadWaitlist(env, t.id);
  return json(
    {
      ok: true,
      kind: res.kind,
      promoted: res.promoted,
      tournament: tournamentView(finalT, finalEntrants, finalWaitlist),
    },
    200,
    cors,
  );
}

/**
 * Entrant-controlled dropout. This intentionally uses the same domain operation as an admin kick:
 * registration removes the row, a pre-play auto-close reopens/reseeds, and a live bracket advances
 * the opponent by walkover instead of leaving an impossible pairing behind.
 */
async function handleDropOut(body: any, caller: Caller, env: TournamentEnv, cors: Cors): Promise<Response> {
  const t = await loadTournament(env, String(body?.id ?? body?.tournamentId));
  if (!t) {
    return json({ error: "tournament not found" }, 404, cors);
  }
  return removeEntrant(t, caller.u, env, cors);
}

/** P3 EDIT (scenario 5): rewards / cap / window / close-time / name / (still-unlocked) format while in registration. */
async function handleEdit(body: any, caller: Caller, env: TournamentEnv, cors: Cors): Promise<Response> {
  const gate = await requireAdminOrOrganizer(body, caller, env, cors);
  if (gate instanceof Response) {
    return gate;
  }
  const t = gate.t;
  const entrants = await loadEntrants(env, t.id);
  const res = editTournament(
    t,
    {
      name: body?.name,
      roundWindowMs: body?.roundWindowMs,
      maxEntrants: body?.maxEntrants,
      closeAt: body?.closeAt,
      rewardPool: body?.rewardPool,
      battleFormat: body?.battleFormat,
      seriesFormat: body?.seriesFormat,
    },
    entrants.length,
  );
  if (!res.ok) {
    return json({ error: res.error }, 422, cors);
  }
  await updateTournament(env, res.tournament);
  const waitlist = await loadWaitlist(env, t.id);
  return json({ ok: true, tournament: tournamentView(res.tournament, entrants, waitlist) }, 200, cors);
}

/** P3 RE-SEED (scenario 7): regenerate the bracket while no match has been played. */
async function handleReseed(body: any, caller: Caller, env: TournamentEnv, cors: Cors): Promise<Response> {
  const gate = await requireAdminOrOrganizer(body, caller, env, cors);
  if (gate instanceof Response) {
    return gate;
  }
  const t = gate.t;
  const entrants = await loadEntrants(env, t.id);
  const res = reseedTournament(t, entrants, () => null, Date.now());
  if (!res.ok) {
    return json({ error: res.error }, 422, cors);
  }
  await updateTournament(env, res.tournament);
  await persistSeeds(env, t.id, res.seeded);
  const waitlist = await loadWaitlist(env, t.id);
  const updated = await loadEntrants(env, t.id);
  return json({ ok: true, tournament: tournamentView(res.tournament, updated, waitlist) }, 200, cors);
}

/** P3 DELETE (scenario 4): hard-remove a tournament (and its entrants) in ANY state. */
async function handleDelete(body: any, caller: Caller, env: TournamentEnv, cors: Cors): Promise<Response> {
  const gate = await requireAdminOrOrganizer(body, caller, env, cors);
  if (gate instanceof Response) {
    return gate;
  }
  const t = gate.t;
  await env.DB.prepare("DELETE FROM tournament_entrants WHERE tournament_id=?1").bind(t.id).run();
  await env.DB.prepare("DELETE FROM tournaments WHERE id=?1").bind(t.id).run();
  return json({ ok: true, deleted: true }, 200, cors);
}

/**
 * Default reward delivery sink: push the per-winner settlement mutations into er-save-api's
 * pending-settlement store (server-to-server) so each champion/runner-up/semifinalist receives them
 * on their next login sweep, exactly like a staked payout. Idempotent on the er-save-api side (keyed
 * by the synthetic match id `tour:<id>`). Auth via the shared SHOWDOWN_GRANT_SECRET (X-Grant-Auth).
 */
async function defaultGrantSink(
  env: TournamentEnv,
  tournamentId: string,
  settlements: TournamentGrantSettlement[],
): Promise<GrantDeliveryResult> {
  const base = env.SAVE_API_URL;
  const secret = env.SHOWDOWN_GRANT_SECRET;
  if (!base || !secret) {
    return {
      ok: false,
      delivered: 0,
      error: "reward delivery is not configured (SAVE_API_URL / SHOWDOWN_GRANT_SECRET)",
    };
  }
  if (settlements.length === 0) {
    return { ok: true, delivered: 0 };
  }
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/showdown/tournament-grant`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Grant-Auth": secret },
      body: JSON.stringify({ tournamentId, grants: settlements }),
    });
    if (!res.ok) {
      return { ok: false, delivered: 0, error: `save-api returned ${res.status}` };
    }
    const data = (await res.json().catch(() => ({}))) as { delivered?: number };
    return { ok: true, delivered: typeof data.delivered === "number" ? data.delivered : settlements.length };
  } catch (err) {
    return { ok: false, delivered: 0, error: `delivery failed: ${String(err)}` };
  }
}

/**
 * P3 GRANT REWARDS (scenario 10). Computes per-account grants from the reward pool + final
 * placements, translates them to settlement mutations, and DELIVERS them through the existing
 * settlement pipeline (er-save-api's pending-settlement store — the same trusted client-apply as
 * stakes) so winners receive them on their next login sweep. Delivery runs BEFORE the rewardsGranted
 * flag is set, and is idempotent server-side, so a retry after a partial failure never double-grants.
 */
async function handleGrantRewards(body: any, caller: Caller, env: TournamentEnv, cors: Cors): Promise<Response> {
  const gate = await requireAdminOrOrganizer(body, caller, env, cors);
  if (gate instanceof Response) {
    return gate;
  }
  const t = gate.t;
  if (t.state !== "complete") {
    return json({ error: "tournament is not complete" }, 422, cors);
  }
  if (t.rewardsGranted) {
    return json({ error: "rewards already granted" }, 422, cors);
  }
  const grants = computeRewardGrants(t);
  const settlements = tournamentGrantSettlements(t);
  // Deliver FIRST (idempotent on the save-api side), then mark granted — so a delivery failure leaves
  // rewardsGranted false (retryable) and a re-run can't double-insert the settlement rows.
  const delivery = await deliverRewards(env, t);
  if (!delivery.ok) {
    return json({ error: `reward delivery failed: ${delivery.error ?? "unknown"}` }, 502, cors);
  }
  await updateTournament(env, { ...t, rewardsGranted: true });
  return json(
    {
      ok: true,
      granted: grants,
      delivered: delivery.delivered,
      settlements,
      note: `granted + delivered ${delivery.delivered} settlement mutation(s) to the pending-settlement store; winners receive them on next login sweep`,
    },
    200,
    cors,
  );
}

// #endregion

/**
 * Dispatch a /tournament/* route. Returns a Response, or null if `url` is not a
 * tournament route (so index.ts can fall through to its own routes / 404).
 * `caller` is null for an unauthenticated request; every route here requires auth.
 */
export async function handleTournamentRoute(
  url: URL,
  request: Request,
  caller: Caller | null,
  env: TournamentEnv,
  cors: Cors,
): Promise<Response | null> {
  if (!url.pathname.startsWith("/tournament/")) {
    return null;
  }
  // The shared editor password (X-Editor-Auth) is an ALTERNATIVE admin credential to the personal
  // session token: a valid one grants admin whether or not a token is present. When only the editor
  // password is presented (no token) we act as a synthetic "editor" admin identity.
  const editorAdmin = await editorAuthValid(request, env);
  if (caller !== null) {
    caller = { ...caller, editorAdmin };
  } else if (editorAdmin) {
    caller = EDITOR_ADMIN_CALLER;
  }
  if (caller === null) {
    return json({ error: "unauthorized" }, 401, cors);
  }

  // Ensure the schema (incl. the additive P1.5 ghost_json / last_seen columns) exists
  // BEFORE any handler reads it — every route, GET included, since handleBracket/handleResult
  // SELECT the new columns and the LIVE table was created before they existed. Idempotent.
  await ensureTournamentTables(env);

  // GET routes
  if (request.method === "GET") {
    if (url.pathname === "/tournament/list") {
      return handleList(env, cors);
    }
    if (url.pathname === "/tournament/bracket") {
      return handleBracket(url, env, cors);
    }
    return json({ error: "not found" }, 404, cors);
  }

  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405, cors);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400, cors);
  }

  switch (url.pathname) {
    case "/tournament/create":
      return handleCreate(body, caller, env, cors);
    case "/tournament/community-create":
      return handleCommunityCreate(body, caller, env, cors);
    case "/tournament/close-registration":
      return handleCloseRegistration(body, caller, env, cors);
    case "/tournament/cancel":
      return handleCancel(body, caller, env, cors);
    case "/tournament/register":
      return handleRegister(body, caller, env, cors);
    case "/tournament/withdraw":
      return handleWithdraw(body, caller, env, cors);
    case "/tournament/ping":
      return handlePing(body, caller, env, cors);
    case "/tournament/ready":
      return handleReady(body, caller, env, cors);
    case "/tournament/drop-out":
      return handleDropOut(body, caller, env, cors);
    case "/tournament/result":
      return handleResult(body, caller, env, cors);
    case "/tournament/resolve":
      return handleResolve(body, caller, env, cors);
    case "/tournament/kick":
      return handleKick(body, caller, env, cors);
    case "/tournament/edit":
      return handleEdit(body, caller, env, cors);
    case "/tournament/reseed":
      return handleReseed(body, caller, env, cors);
    case "/tournament/delete":
      return handleDelete(body, caller, env, cors);
    case "/tournament/grant-rewards":
      return handleGrantRewards(body, caller, env, cors);
    default:
      return json({ error: "not found" }, 404, cors);
  }
}
