/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — team data editor backend (Cloudflare Worker).
//
// The static editor SPA reads game data straight from the public GitHub raw
// URLs; only WRITES go through this Worker, which holds a single GitHub token
// (secret) and commits the edited JSON to the configured branch via the GitHub
// Contents API. Access is gated by a shared editor password.
//
// Endpoints:
//   GET  /health        — liveness
//   POST /egg-moves     — { password, eggMoves: {SPECIES_X: string[]}, author?, deploy? }
//                          → merges + commits er-egg-moves.json; if deploy, also
//                            triggers the staging rebuild+deploy workflow.
//   POST /deploy        — { password } → triggers the staging deploy workflow only
//                            (redeploy current branch without an edit).
//
// Secrets/vars (wrangler):
//   GITHUB_TOKEN (secret) — fine-grained PAT with Contents:read+write AND
//                           Actions:read+write (workflow dispatch) on the repo
//   GITHUB_REPO           — "Heraklines/elite-redux"
//   GITHUB_BRANCH         — e.g. "feat/elite-redux-port"
//   GITHUB_WORKFLOW_FILE  — deploy workflow filename (default "deploy-staging.yml")
//   EDITOR_PASSWORD (secret) — shared team password
//   ALLOWED_ORIGIN        — the editor's origin (or "*")
// =============================================================================

interface Env {
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  GITHUB_WORKFLOW_FILE?: string;
  EDITOR_PASSWORD: string;
  ALLOWED_ORIGIN: string;
}

const EGG_MOVES_PATH = "src/data/elite-redux/er-egg-moves.json";
const DEFAULT_WORKFLOW_FILE = "deploy-staging.yml";

/** Fire the staging rebuild+deploy GitHub Action (workflow_dispatch on the branch). */
async function triggerDeploy(env: Env): Promise<{ ok: true } | { ok: false; error: string }> {
  const workflow = env.GITHUB_WORKFLOW_FILE || DEFAULT_WORKFLOW_FILE;
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${workflow}/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...ghHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: env.GITHUB_BRANCH }),
  });
  // workflow_dispatch returns 204 No Content on success.
  if (res.status === 204) {
    return { ok: true };
  }
  return { ok: false, error: `deploy dispatch failed: ${res.status} ${await res.text()}` };
}

function corsHeaders(env: Env): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(body: unknown, status: number, env: Env): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) },
  });
}

function ghHeaders(env: Env): Record<string, string> {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "er-editor-api",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/** UTF-8 safe base64 (GitHub Contents API wants base64-encoded file content). */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

/** Decode the base64 content GitHub returns for a file (may contain newlines). */
function fromBase64(b64: string): string {
  const binary = atob(b64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Validate the posted egg-move map: speciesConst → 1..4 move-name strings. */
function validateEggMoves(value: unknown): { ok: true; data: Record<string, string[]> } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "eggMoves must be an object" };
  }
  const out: Record<string, string[]> = {};
  for (const [key, moves] of Object.entries(value as Record<string, unknown>)) {
    if (!/^SPECIES_[A-Z0-9_]+$/.test(key)) {
      return { ok: false, error: `bad species key: ${key}` };
    }
    if (!Array.isArray(moves) || moves.length === 0 || moves.length > 4) {
      return { ok: false, error: `${key}: must have 1-4 moves` };
    }
    for (const mv of moves) {
      if (typeof mv !== "string" || !/^[A-Z0-9_]+$/.test(mv)) {
        return { ok: false, error: `${key}: bad move name "${String(mv)}"` };
      }
    }
    out[key] = moves as string[];
  }
  return { ok: true, data: out };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }
    if (url.pathname === "/health") {
      return json({ ok: true }, 200, env);
    }

    if (url.pathname === "/deploy" && request.method === "POST") {
      let body: { password?: string };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ ok: false, error: "invalid JSON body" }, 400, env);
      }
      if (!env.EDITOR_PASSWORD || body.password !== env.EDITOR_PASSWORD) {
        return json({ ok: false, error: "unauthorized" }, 401, env);
      }
      const dep = await triggerDeploy(env);
      if (!dep.ok) {
        return json({ ok: false, error: dep.error }, 502, env);
      }
      return json({ ok: true, deployed: true }, 200, env);
    }

    if (url.pathname === "/egg-moves" && request.method === "POST") {
      let body: { password?: string; eggMoves?: unknown; author?: string; deploy?: boolean };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ ok: false, error: "invalid JSON body" }, 400, env);
      }
      if (!env.EDITOR_PASSWORD || body.password !== env.EDITOR_PASSWORD) {
        return json({ ok: false, error: "unauthorized" }, 401, env);
      }
      const validated = validateEggMoves(body.eggMoves);
      if (!validated.ok) {
        return json({ ok: false, error: validated.error }, 400, env);
      }

      // Read the current file so we MERGE the posted delta into it (the editor
      // only sends changed species — untouched species must be preserved, and
      // concurrent editors must not clobber each other).
      const base = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${EGG_MOVES_PATH}`;
      const getRes = await fetch(`${base}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`, { headers: ghHeaders(env) });
      let sha: string | undefined;
      let existing: Record<string, string[]> = {};
      if (getRes.ok) {
        const meta = (await getRes.json()) as { sha?: string; content?: string };
        sha = meta.sha;
        if (meta.content) {
          try {
            existing = JSON.parse(fromBase64(meta.content)) as Record<string, string[]>;
          } catch {
            return json({ ok: false, error: "current egg-moves file is not valid JSON" }, 502, env);
          }
        }
      } else if (getRes.status !== 404) {
        return json({ ok: false, error: `github read failed: ${getRes.status}` }, 502, env);
      }

      // Overlay the delta, then re-sort for a clean, stable diff.
      const merged = { ...existing, ...validated.data };
      const sorted = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
      const content = `${JSON.stringify(sorted, null, 2)}\n`;

      const author = typeof body.author === "string" ? body.author.slice(0, 40).replace(/[^\w .-]/g, "") : "";
      const putRes = await fetch(base, {
        method: "PUT",
        headers: { ...ghHeaders(env), "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `editor: update egg moves${author ? ` (by ${author})` : ""}`,
          content: toBase64(content),
          branch: env.GITHUB_BRANCH,
          ...(sha ? { sha } : {}),
        }),
      });
      if (!putRes.ok) {
        return json({ ok: false, error: `github commit failed: ${putRes.status} ${await putRes.text()}` }, 502, env);
      }
      const committed = (await putRes.json()) as { commit?: { sha?: string; html_url?: string } };

      // Optionally kick off the rebuild+deploy so the edit goes live.
      let deployed = false;
      let deployError: string | undefined;
      if (body.deploy) {
        const dep = await triggerDeploy(env);
        deployed = dep.ok;
        if (!dep.ok) {
          deployError = dep.error;
        }
      }
      return json(
        { ok: true, commit: committed.commit?.sha, url: committed.commit?.html_url, deployed, deployError },
        200,
        env,
      );
    }

    return json({ ok: false, error: "not found" }, 404, env);
  },
};
