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
// Editable files are an explicit WHITELIST (EDITABLE_FILES) — the Worker never
// writes any other repo path. Every save is a DELTA the Worker merges into the
// live file (concurrent editors don't clobber each other's untouched keys).
//
// Endpoints:
//   GET  /health        — liveness
//   POST /save          — { password, file, delta, author?, deploy? }
//                          `file` is a whitelist key (egg-moves, species-tuning,
//                          item-tuning, trainer-tuning); `delta` is deep-merged
//                          into the live JSON (null deletes a key; arrays
//                          replace wholesale), then committed. If deploy, also
//                          triggers the staging rebuild+deploy workflow.
//   POST /egg-moves     — back-compat alias: { password, eggMoves, author?,
//                          deploy? } → same as /save with file=egg-moves.
//   POST /deploy        — { password } → triggers the staging deploy workflow
//                          only (redeploy current branch without an edit).
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

const DEFAULT_WORKFLOW_FILE = "deploy-staging.yml";

type ValidationResult = { ok: true } | { ok: false; error: string };

interface EditableFile {
  /** Repo path the delta is merged into (the ONLY paths this Worker writes). */
  path: string;
  /** Human label for commit messages. */
  label: string;
  /** Validates a posted delta BEFORE it is merged. */
  validate: (delta: unknown) => ValidationResult;
}

const SPECIES_CONST_RE = /^SPECIES_[A-Z0-9_]+$/;
const ITEM_KEY_RE = /^[A-Z][A-Z0-9_]*$/;
const TIER_NAMES = new Set(["COMMON", "GREAT", "ULTRA", "ROGUE", "MASTER"]);
const DIFFICULTIES = new Set(["youngster", "ace", "elite", "hell"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** speciesConst → 1..4 move-name strings (the original egg-move semantics). */
function validateEggMovesDelta(delta: unknown): ValidationResult {
  if (!isPlainObject(delta)) {
    return { ok: false, error: "delta must be an object" };
  }
  for (const [key, moves] of Object.entries(delta)) {
    if (!SPECIES_CONST_RE.test(key)) {
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
  }
  return { ok: true };
}

/** speciesConst → { eggTier?: 0..3, cost?: 1..50 } (null deletes). */
function validateSpeciesTuningDelta(delta: unknown): ValidationResult {
  if (!isPlainObject(delta)) {
    return { ok: false, error: "delta must be an object" };
  }
  for (const [key, entry] of Object.entries(delta)) {
    if (!SPECIES_CONST_RE.test(key)) {
      return { ok: false, error: `bad species key: ${key}` };
    }
    if (entry === null) {
      continue; // delete the whole override
    }
    if (!isPlainObject(entry)) {
      return { ok: false, error: `${key}: must be an object or null` };
    }
    for (const [field, value] of Object.entries(entry)) {
      if (field === "eggTier") {
        if (value !== null && !(Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 3)) {
          return { ok: false, error: `${key}.eggTier: must be 0-3 or null` };
        }
      } else if (field === "cost") {
        if (value !== null && !(isFiniteNumber(value) && value >= 1 && value <= 50)) {
          return { ok: false, error: `${key}.cost: must be 1-50 or null` };
        }
      } else {
        return { ok: false, error: `${key}: unknown field "${field}"` };
      }
    }
  }
  return { ok: true };
}

/** itemKey → { tier?, weight?, maxWeight?, maxStack? } (null deletes). */
function validateItemTuningDelta(delta: unknown): ValidationResult {
  if (!isPlainObject(delta)) {
    return { ok: false, error: "delta must be an object" };
  }
  for (const [key, entry] of Object.entries(delta)) {
    if (!ITEM_KEY_RE.test(key)) {
      return { ok: false, error: `bad item key: ${key}` };
    }
    if (entry === null) {
      continue;
    }
    if (!isPlainObject(entry)) {
      return { ok: false, error: `${key}: must be an object or null` };
    }
    for (const [field, value] of Object.entries(entry)) {
      if (field === "tier") {
        if (value !== null && !(typeof value === "string" && TIER_NAMES.has(value))) {
          return { ok: false, error: `${key}.tier: must be one of ${[...TIER_NAMES].join("/")} or null` };
        }
      } else if (field === "weight" || field === "maxWeight") {
        if (value !== null && !(isFiniteNumber(value) && value >= 0 && value <= 1000)) {
          return { ok: false, error: `${key}.${field}: must be 0-1000 or null` };
        }
      } else if (field === "maxStack") {
        if (value !== null && !(Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 99)) {
          return { ok: false, error: `${key}.maxStack: must be 1-99 or null` };
        }
      } else {
        return { ok: false, error: `${key}: unknown field "${field}"` };
      }
    }
  }
  return { ok: true };
}

/** { frequency?: { <difficulty>: { trainerCadence?, factoryTeamPct? } }, sets?: { factoryExcludeSpecies?: [] } } */
function validateTrainerTuningDelta(delta: unknown): ValidationResult {
  if (!isPlainObject(delta)) {
    return { ok: false, error: "delta must be an object" };
  }
  for (const [section, value] of Object.entries(delta)) {
    if (section === "frequency") {
      if (value === null) {
        continue;
      }
      if (!isPlainObject(value)) {
        return { ok: false, error: "frequency: must be an object or null" };
      }
      for (const [difficulty, knobs] of Object.entries(value)) {
        if (!DIFFICULTIES.has(difficulty)) {
          return { ok: false, error: `frequency: unknown difficulty "${difficulty}"` };
        }
        if (knobs === null) {
          continue;
        }
        if (!isPlainObject(knobs)) {
          return { ok: false, error: `frequency.${difficulty}: must be an object or null` };
        }
        for (const [field, knobValue] of Object.entries(knobs)) {
          if (field === "trainerCadence") {
            if (
              knobValue !== null
              && !(Number.isInteger(knobValue) && (knobValue as number) >= 1 && (knobValue as number) <= 50)
            ) {
              return { ok: false, error: `frequency.${difficulty}.trainerCadence: must be 1-50 or null` };
            }
          } else if (field === "factoryTeamPct") {
            if (knobValue !== null && !(isFiniteNumber(knobValue) && knobValue >= 0 && knobValue <= 100)) {
              return { ok: false, error: `frequency.${difficulty}.factoryTeamPct: must be 0-100 or null` };
            }
          } else {
            return { ok: false, error: `frequency.${difficulty}: unknown field "${field}"` };
          }
        }
      }
    } else if (section === "sets") {
      if (value === null) {
        continue;
      }
      if (!isPlainObject(value)) {
        return { ok: false, error: "sets: must be an object or null" };
      }
      for (const [field, listValue] of Object.entries(value)) {
        if (field !== "factoryExcludeSpecies") {
          return { ok: false, error: `sets: unknown field "${field}"` };
        }
        if (listValue === null) {
          continue;
        }
        if (!Array.isArray(listValue) || listValue.some(s => typeof s !== "string" || !SPECIES_CONST_RE.test(s))) {
          return { ok: false, error: "sets.factoryExcludeSpecies: must be a list of SPECIES_* consts or null" };
        }
      }
    } else {
      return { ok: false, error: `unknown section "${section}"` };
    }
  }
  return { ok: true };
}

/** The ONLY repo paths this Worker will ever write. */
const EDITABLE_FILES: Record<string, EditableFile> = {
  "egg-moves": {
    path: "src/data/elite-redux/er-egg-moves.json",
    label: "egg moves",
    validate: validateEggMovesDelta,
  },
  "species-tuning": {
    path: "src/data/elite-redux/er-species-tuning.json",
    label: "species tuning",
    validate: validateSpeciesTuningDelta,
  },
  "item-tuning": {
    path: "src/data/elite-redux/er-item-tuning.json",
    label: "item tuning",
    validate: validateItemTuningDelta,
  },
  "trainer-tuning": {
    path: "src/data/elite-redux/er-trainer-tuning.json",
    label: "trainer tuning",
    validate: validateTrainerTuningDelta,
  },
};

/**
 * Deep-merge `delta` into `base` (both plain objects):
 *   - plain objects merge recursively,
 *   - `null` DELETES the key (how the editor clears an override),
 *   - arrays and scalars replace wholesale.
 */
function deepMerge(base: Record<string, unknown>, delta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(delta)) {
    if (value === null) {
      delete out[key];
    } else if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key] as Record<string, unknown>, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Sort object keys recursively for a clean, stable diff. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeysDeep(v)]),
    );
  }
  return value;
}

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

interface SaveBody {
  password?: string;
  file?: string;
  delta?: unknown;
  author?: string;
  deploy?: boolean;
}

/** Merge-commit a validated delta into a whitelisted file, optionally deploy. */
async function handleSave(body: SaveBody, env: Env): Promise<Response> {
  // Open mode: if no EDITOR_PASSWORD secret is configured, skip the gate.
  if (env.EDITOR_PASSWORD && body.password !== env.EDITOR_PASSWORD) {
    return json({ ok: false, error: "unauthorized" }, 401, env);
  }
  const target = body.file === undefined ? undefined : EDITABLE_FILES[body.file];
  if (target === undefined) {
    return json({ ok: false, error: `unknown file (allowed: ${Object.keys(EDITABLE_FILES).join(", ")})` }, 400, env);
  }
  if (!isPlainObject(body.delta) || Object.keys(body.delta).length === 0) {
    return json({ ok: false, error: "delta must be a non-empty object" }, 400, env);
  }
  const validated = target.validate(body.delta);
  if (!validated.ok) {
    return json({ ok: false, error: validated.error }, 400, env);
  }

  // Read the current file so we MERGE the posted delta into it (the editor
  // only sends changed keys — untouched keys must be preserved, and
  // concurrent editors must not clobber each other).
  const base = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${target.path}`;
  const getRes = await fetch(`${base}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`, { headers: ghHeaders(env) });
  let sha: string | undefined;
  let existing: Record<string, unknown> = {};
  if (getRes.ok) {
    const meta = (await getRes.json()) as { sha?: string; content?: string };
    sha = meta.sha;
    if (meta.content) {
      try {
        const parsed = JSON.parse(fromBase64(meta.content)) as unknown;
        if (isPlainObject(parsed)) {
          existing = parsed;
        }
      } catch {
        return json({ ok: false, error: `current ${target.label} file is not valid JSON` }, 502, env);
      }
    }
  } else if (getRes.status !== 404) {
    return json({ ok: false, error: `github read failed: ${getRes.status}` }, 502, env);
  }

  const merged = sortKeysDeep(deepMerge(existing, body.delta)) as Record<string, unknown>;
  const content = `${JSON.stringify(merged, null, 2)}\n`;

  const author = typeof body.author === "string" ? body.author.slice(0, 40).replace(/[^\w .-]/g, "") : "";
  const putRes = await fetch(base, {
    method: "PUT",
    headers: { ...ghHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `editor: update ${target.label}${author ? ` (by ${author})` : ""}`,
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
      // Open mode: if no EDITOR_PASSWORD secret is configured, skip the gate.
      if (env.EDITOR_PASSWORD && body.password !== env.EDITOR_PASSWORD) {
        return json({ ok: false, error: "unauthorized" }, 401, env);
      }
      const dep = await triggerDeploy(env);
      if (!dep.ok) {
        return json({ ok: false, error: dep.error }, 502, env);
      }
      return json({ ok: true, deployed: true }, 200, env);
    }

    if (url.pathname === "/save" && request.method === "POST") {
      let body: SaveBody;
      try {
        body = (await request.json()) as SaveBody;
      } catch {
        return json({ ok: false, error: "invalid JSON body" }, 400, env);
      }
      return handleSave(body, env);
    }

    // Back-compat: the original egg-move route ({ eggMoves } instead of
    // { file, delta }). Kept so an older cached SPA keeps working.
    if (url.pathname === "/egg-moves" && request.method === "POST") {
      let body: { password?: string; eggMoves?: unknown; author?: string; deploy?: boolean };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ ok: false, error: "invalid JSON body" }, 400, env);
      }
      return handleSave(
        { password: body.password, file: "egg-moves", delta: body.eggMoves, author: body.author, deploy: body.deploy },
        env,
      );
    }

    return json({ ok: false, error: "not found" }, 404, env);
  },
};
