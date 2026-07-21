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
  createTournament,
  type EntrantRecord,
  editTournament,
  type GhostIconSummary,
  kickEntrant,
  makeEntrant,
  type RewardPool,
  reseedTournament,
  type SeriesFormat,
  sanitizeGhostIcon,
  sanitizeRewardPool,
  syncCompletion,
  type TournamentRecord,
  withdrawEntrant,
} from "./tournament";
import { applyResultReport, type Bracket, findMatch, manualResolve } from "./tournament-bracket";

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
}

/** The authenticated caller (mirrors index.ts TokenPayload). */
export interface Caller {
  uid: number;
  u: string;
}

type Cors = Record<string, string>;
function json(body: unknown, status: number, cors: Cors): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
}

function isAdmin(env: TournamentEnv, uid: number): boolean {
  const raw = env.TOURNAMENT_ADMIN_UIDS ?? "";
  return raw
    .split(",")
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .some(s => Number(s) === uid);
}

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
       seed INTEGER, registered_at INTEGER NOT NULL, ghost_json TEXT, last_seen INTEGER, waitlisted INTEGER,
       PRIMARY KEY (tournament_id, participant) )`,
  ).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_entrant_tour ON tournament_entrants (tournament_id)").run();
  // Additive online migration for tables created BEFORE these columns existed (the LIVE sample-cup
  // rows): SQLite has no "ADD COLUMN IF NOT EXISTS", so attempt each ALTER and swallow the
  // "duplicate column name" error once the column is already present.
  await addColumnIfMissing(env, "tournament_entrants", "ghost_json", "TEXT");
  await addColumnIfMissing(env, "tournament_entrants", "last_seen", "INTEGER");
  await addColumnIfMissing(env, "tournament_entrants", "waitlisted", "INTEGER");
  await addColumnIfMissing(env, "tournaments", "battle_format", "TEXT");
  await addColumnIfMissing(env, "tournaments", "series_format", "TEXT");
  await addColumnIfMissing(env, "tournaments", "reward_pool_json", "TEXT");
  await addColumnIfMissing(env, "tournaments", "close_at", "INTEGER");
  await addColumnIfMissing(env, "tournaments", "rewards_granted", "INTEGER");
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
    "SELECT participant, name, preset_name, seed, registered_at, ghost_json, last_seen, waitlisted FROM tournament_entrants WHERE tournament_id = ? ORDER BY registered_at",
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
    `INSERT INTO tournaments (id, name, organizer, state, round_window_ms, max_entrants, created_at, started_at, champion, bracket_json, battle_format, series_format, reward_pool_json, close_at, rewards_granted)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)`,
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
    entrantCount: entrants.length,
    entrants: entrants.map(e => ({
      participant: e.participant,
      name: e.name,
      seed: e.seed,
      ghost: e.ghost ?? null,
      lastSeen: e.lastSeen ?? null,
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
  if (!isAdmin(env, caller.uid)) {
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

async function handleCloseRegistration(body: any, caller: Caller, env: TournamentEnv, cors: Cors): Promise<Response> {
  if (!isAdmin(env, caller.uid)) {
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
  if (!isAdmin(env, caller.uid)) {
    return json({ error: "not authorized" }, 403, cors);
  }
  const t = await loadTournament(env, String(body?.id));
  if (!t) {
    return json({ error: "tournament not found" }, 404, cors);
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
  await env.DB.prepare("UPDATE tournament_entrants SET last_seen=?3 WHERE tournament_id=?1 AND participant=?2")
    .bind(t.id, caller.u, Date.now())
    .run();
  return json({ ok: true }, 200, cors);
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
    // P3: enforce any elapsed scheduled close lazily on the list read (no cron).
    const t = await enforceScheduledClose(env, rowToRecord(row), now);
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
  const t = await enforceScheduledClose(env, loaded, Date.now());
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
  // ATTESTATION: the reporter is the authenticated account, and must be one of the
  // two paired players of this match (applyResultReport enforces winner ∈ {a,b} too).
  const res = applyResultReport(t.bracket, matchId, caller.u, winner, Date.now());
  const synced = syncCompletion({ ...t, bracket: res.bracket });
  await updateTournament(env, synced);
  return json(
    { ok: true, resolution: res.resolution, match: findMatch(synced.bracket as Bracket, matchId) },
    200,
    cors,
  );
}

async function handleResolve(body: any, caller: Caller, env: TournamentEnv, cors: Cors): Promise<Response> {
  const t = await loadTournament(env, String(body?.tournamentId ?? body?.id));
  if (!t || t.bracket === null) {
    return json({ error: "tournament not found or not started" }, 404, cors);
  }
  // Organizer-only: the creating admin, or any allowlisted admin.
  if (!isAdmin(env, caller.uid) && caller.u !== t.organizer) {
    return json({ error: "not authorized to resolve matches" }, 403, cors);
  }
  const res = manualResolve(t.bracket, String(body?.matchId ?? ""), String(body?.winner ?? ""));
  const synced = syncCompletion({ ...t, bracket: res.bracket });
  await updateTournament(env, synced);
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
  if (!isAdmin(env, caller.uid) && caller.u !== t.organizer) {
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
  const t = gate.t;
  const target = String(body?.participant ?? "");
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
  } else {
    // registration / reopen: remove the kicked field row, promote the first waitlisted member.
    if (!res.keepEntrantRow) {
      await env.DB.prepare("DELETE FROM tournament_entrants WHERE tournament_id=?1 AND participant=?2")
        .bind(t.id, res.removed)
        .run();
    }
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
 * P3 GRANT REWARDS (scenario 10) — STUB. Computes the per-account grants from the reward pool +
 * final placements (fully implemented + tested in computeRewardGrants) and marks the tournament
 * granted so it can't double-grant. The ACTUAL application of the mutations runs through the
 * existing settlement pipeline (the same trusted client-apply as stakes) — that cross-worker grant
 * path (pushing mutations into er-save-api's showdown_settlements for each winner to apply) is a
 * FOLLOW-UP; this route returns the computed grants and records intent. TODO(P3-followup): push the
 * grants into the settlement queue so the champion/runner-up/semifinalists receive them on next sync.
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
  await updateTournament(env, { ...t, rewardsGranted: true });
  return json(
    {
      ok: true,
      granted: grants,
      // Honest status: definitions stored + placements resolved; settlement-pipeline delivery is a follow-up.
      note: "grants computed + tournament marked granted; settlement-pipeline delivery is a follow-up (stub)",
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
