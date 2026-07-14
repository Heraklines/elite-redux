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
  cancelTournament,
  closeRegistration,
  createTournament,
  type EntrantRecord,
  registerEntrant,
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
       started_at INTEGER, champion TEXT, bracket_json TEXT )`,
  ).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_tour_state ON tournaments (state, created_at)").run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS tournament_entrants (
       tournament_id TEXT NOT NULL, participant TEXT NOT NULL, name TEXT NOT NULL, preset_name TEXT NOT NULL,
       seed INTEGER, registered_at INTEGER NOT NULL, PRIMARY KEY (tournament_id, participant) )`,
  ).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_entrant_tour ON tournament_entrants (tournament_id)").run();
  tablesReady = true;
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
  };
}

async function loadTournament(env: TournamentEnv, id: string): Promise<TournamentRecord | null> {
  const row = await env.DB.prepare("SELECT * FROM tournaments WHERE id = ?").bind(id).first<TournamentRow>();
  return row ? rowToRecord(row) : null;
}

async function loadEntrants(env: TournamentEnv, id: string): Promise<EntrantRecord[]> {
  const res = await env.DB.prepare(
    "SELECT participant, name, preset_name, seed, registered_at FROM tournament_entrants WHERE tournament_id = ? ORDER BY registered_at",
  )
    .bind(id)
    .all<{ participant: string; name: string; preset_name: string; seed: number | null; registered_at: number }>();
  return (res.results ?? []).map(r => ({
    tournamentId: id,
    participant: r.participant,
    name: r.name,
    presetName: r.preset_name,
    seed: r.seed,
    registeredAt: r.registered_at,
  }));
}

async function insertTournament(env: TournamentEnv, t: TournamentRecord): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO tournaments (id, name, organizer, state, round_window_ms, max_entrants, created_at, started_at, champion, bracket_json)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`,
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
    )
    .run();
}

async function updateTournament(env: TournamentEnv, t: TournamentRecord): Promise<void> {
  await env.DB.prepare("UPDATE tournaments SET state=?2, started_at=?3, champion=?4, bracket_json=?5 WHERE id=?1")
    .bind(t.id, t.state, t.startedAt, t.champion, t.bracket ? JSON.stringify(t.bracket) : null)
    .run();
}

// #endregion
// #region serialization for the client

/** The public view of a tournament (list/bracket response). */
function tournamentView(t: TournamentRecord, entrants: EntrantRecord[]) {
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
    entrantCount: entrants.length,
    entrants: entrants.map(e => ({ participant: e.participant, name: e.name, seed: e.seed })),
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
    { name: body?.name, roundWindowMs: body?.roundWindowMs, maxEntrants: body?.maxEntrants },
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
  // Persist the assigned seeds back onto the entrant rows.
  for (const s of res.seeded) {
    await env.DB.prepare("UPDATE tournament_entrants SET seed=?3 WHERE tournament_id=?1 AND participant=?2")
      .bind(t.id, s.participant, s.seed)
      .run();
  }
  const updated = await loadEntrants(env, t.id);
  return json({ ok: true, tournament: tournamentView(res.tournament, updated) }, 200, cors);
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
  const t = await loadTournament(env, String(body?.id));
  if (!t) {
    return json({ error: "tournament not found" }, 404, cors);
  }
  const entrants = await loadEntrants(env, t.id);
  const res = registerEntrant(t, entrants, caller.u, String(body?.presetName ?? ""), Date.now());
  if (!res.ok) {
    return json({ error: res.error }, 422, cors);
  }
  await env.DB.prepare(
    "INSERT INTO tournament_entrants (tournament_id, participant, name, preset_name, seed, registered_at) VALUES (?1,?2,?3,?4,?5,?6)",
  )
    .bind(t.id, res.entrant.participant, res.entrant.name, res.entrant.presetName, null, res.entrant.registeredAt)
    .run();
  return json({ ok: true }, 200, cors);
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

async function handleList(env: TournamentEnv, cors: Cors): Promise<Response> {
  await ensureTournamentTables(env);
  const res = await env.DB.prepare(
    "SELECT * FROM tournaments WHERE state IN ('registration','in_progress','complete') ORDER BY created_at DESC LIMIT 50",
  ).all<TournamentRow>();
  const rows = res.results ?? [];
  const list: Record<string, unknown>[] = [];
  for (const row of rows) {
    const t = rowToRecord(row);
    const entrants = await loadEntrants(env, t.id);
    // list view is light: no full bracket
    const { bracket: _bracket, ...light } = tournamentView(t, entrants);
    list.push(light);
  }
  return json({ ok: true, tournaments: list }, 200, cors);
}

async function handleBracket(url: URL, env: TournamentEnv, cors: Cors): Promise<Response> {
  const id = url.searchParams.get("id") ?? "";
  const t = await loadTournament(env, id);
  if (!t) {
    return json({ error: "tournament not found" }, 404, cors);
  }
  const entrants = await loadEntrants(env, t.id);
  return json({ ok: true, tournament: tournamentView(t, entrants) }, 200, cors);
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

  await ensureTournamentTables(env);
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
    case "/tournament/result":
      return handleResult(body, caller, env, cors);
    case "/tournament/resolve":
      return handleResolve(body, caller, env, cors);
    default:
      return json({ error: "not found" }, 404, cors);
  }
}
