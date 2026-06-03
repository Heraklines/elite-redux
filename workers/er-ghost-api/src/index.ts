/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — ghost-team API (Cloudflare Worker, free tier).
//
// A tiny shared store so every player's finished teams can be fought as "ghost"
// trainers in other players' endgame runs (#217). Two routes:
//
//   POST /ghost            body = GhostTeamSnapshot JSON   → stores it
//   GET  /ghost?difficulty=hell&count=8                    → random sample
//
// Backed by a single Workers KV namespace (binding `GHOSTS`). Per-difficulty
// rolling cap keeps storage within the free tier. CORS is open so the static
// game (hosted anywhere) can call it. Set the game's VITE_GHOST_ENDPOINT to this
// Worker's `/ghost` URL.
//
// Deploy: see workers/er-ghost-api/README.md.
// =============================================================================

interface Env {
  GHOSTS: KVNamespace;
  /** Optional comma-separated allowlist of origins; "*" / unset = allow all. */
  ALLOWED_ORIGIN?: string;
}

/** Max stored ghosts per difficulty (oldest pruned past this). */
const CAP_PER_DIFFICULTY = 500;
/** Hard ceiling on a single GET sample. */
const MAX_COUNT = 12;
const DIFFICULTIES = ["ace", "elite", "hell"] as const;
type Difficulty = (typeof DIFFICULTIES)[number];

function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  const allow = env.ALLOWED_ORIGIN;
  const value = !allow || allow === "*" ? "*" : allow.split(",").includes(origin ?? "") ? (origin ?? "*") : "null";
  return {
    "Access-Control-Allow-Origin": value,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === "string" && (DIFFICULTIES as readonly string[]).includes(value);
}

/** Validate the minimum shape of an incoming snapshot. */
function isValidSnapshot(s: any): boolean {
  return (
    s
    && typeof s === "object"
    && isDifficulty(s.difficulty)
    && Array.isArray(s.party)
    && s.party.length > 0
    && s.party.length <= 6
  );
}

async function handlePost(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  let snapshot: any;
  try {
    snapshot = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400, cors);
  }
  if (!isValidSnapshot(snapshot)) {
    return json({ error: "invalid snapshot" }, 422, cors);
  }
  const difficulty = snapshot.difficulty as Difficulty;
  // Key encodes difficulty + a sortable timestamp so list() is roughly oldest→newest.
  const ts = typeof snapshot.timestamp === "number" ? snapshot.timestamp : Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const key = `ghost:${difficulty}:${ts.toString().padStart(16, "0")}:${rand}`;
  // Trim oversized payloads defensively (KV value limit is 25 MB; teams are tiny).
  const value = JSON.stringify(snapshot).slice(0, 200_000);
  await env.GHOSTS.put(key, value);

  // Rolling cap: prune the oldest beyond CAP_PER_DIFFICULTY for this difficulty.
  const listed = await env.GHOSTS.list({ prefix: `ghost:${difficulty}:` });
  if (listed.keys.length > CAP_PER_DIFFICULTY) {
    const excess = listed.keys.slice(0, listed.keys.length - CAP_PER_DIFFICULTY);
    await Promise.all(excess.map(k => env.GHOSTS.delete(k.name)));
  }
  return json({ ok: true }, 200, cors);
}

async function handleGet(url: URL, env: Env, cors: Record<string, string>): Promise<Response> {
  const difficultyParam = url.searchParams.get("difficulty");
  const difficulty: Difficulty = isDifficulty(difficultyParam) ? difficultyParam : "hell";
  const count = Math.min(Math.max(Number.parseInt(url.searchParams.get("count") ?? "3", 10) || 3, 1), MAX_COUNT);

  const listed = await env.GHOSTS.list({ prefix: `ghost:${difficulty}:` });
  let keys = listed.keys.map(k => k.name);
  // Fall back to any difficulty if this one is empty.
  if (keys.length === 0) {
    const all = await env.GHOSTS.list({ prefix: "ghost:" });
    keys = all.keys.map(k => k.name);
  }
  // Shuffle (Fisher–Yates) and take `count`.
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  const chosen = keys.slice(0, count);
  const teams = (
    await Promise.all(
      chosen.map(async name => {
        const raw = await env.GHOSTS.get(name);
        try {
          return raw ? JSON.parse(raw) : null;
        } catch {
          return null;
        }
      }),
    )
  ).filter(Boolean);
  return json({ teams }, 200, cors);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(env, request.headers.get("Origin"));

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (!url.pathname.endsWith("/ghost")) {
      return json({ error: "not found" }, 404, cors);
    }
    if (request.method === "POST") {
      return handlePost(request, env, cors);
    }
    if (request.method === "GET") {
      return handleGet(url, env, cors);
    }
    return json({ error: "method not allowed" }, 405, cors);
  },
};
