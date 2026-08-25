import { readFileSync, writeFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const DATA = new URL("./data/", import.meta.url);
const WINDOW_DAYS = Math.max(1, Number.parseInt(process.env.STATS_WINDOW_DAYS || "30", 10));
const PAGE_SIZE = 1000;

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
if (!accountId || !apiToken) {
  throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required");
}

function databaseId(relativeConfig, databaseName) {
  const source = readFileSync(new URL(relativeConfig, ROOT), "utf8");
  const blocks = source.split("[[d1_databases]]").slice(1);
  for (const block of blocks) {
    const name = block.match(/^\s*database_name\s*=\s*"([^"]+)"/m)?.[1];
    const id = block.match(/^\s*database_id\s*=\s*"([^"]+)"/m)?.[1];
    if (name === databaseName && id) {
      return id;
    }
  }
  throw new Error(`Could not find ${databaseName} in ${relativeConfig}`);
}

async function query(database, sql, params = []) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${database}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    },
  );
  const body = await response.json();
  if (!response.ok || body?.success !== true) {
    const detail = body?.errors?.map(error => error.message).filter(Boolean).join("; ") || response.statusText;
    throw new Error(`Cloudflare D1 query failed (${response.status}): ${detail}`);
  }
  const result = Array.isArray(body.result) ? body.result[0] : body.result;
  return Array.isArray(result?.results) ? result.results : [];
}

async function pagedQuery(database, selectSql, params) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await query(database, `${selectSql} LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`, [
      ...params,
      PAGE_SIZE,
      offset,
    ]);
    rows.push(...page);
    if (page.length < PAGE_SIZE) {
      return rows;
    }
  }
}

const now = Date.now();
const since = now - WINDOW_DAYS * 24 * 60 * 60 * 1000;
const savesDb = databaseId("workers/er-save-api/wrangler.toml", "er-saves");
const telemetryDb = databaseId("workers/er-telemetry/wrangler.toml", "er-telemetry");
const runColumns = new Set((await query(savesDb, "PRAGMA table_info(runs)")).map(row => String(row.name)));
const runColumn = name => (runColumns.has(name) ? name : `NULL AS ${name}`);

const runRows = await pagedQuery(
  savesDb,
  `SELECT user_id, starters, challenges, difficulty, mode, pacing, wave, progression_wave, outcome,
          ${runColumn("build_sha")}, ${runColumn("game_version")}, ${runColumn("er_version")},
          player_team, opponent_team, killed_by_ghost, relics, created_at
     FROM runs
    WHERE created_at >= ?1 AND starters IS NOT NULL
    ORDER BY created_at ASC`,
  [since],
);

const anonymousPlayers = new Map();
const anonymizedRuns = runRows.map(row => {
  const rawId = String(row.user_id);
  if (!anonymousPlayers.has(rawId)) {
    anonymousPlayers.set(rawId, `p${anonymousPlayers.size + 1}`);
  }
  const { user_id: _discarded, ...safe } = row;
  return { ...safe, playerKey: anonymousPlayers.get(rawId) };
});

const showdownRows = await pagedQuery(
  telemetryDb,
  `SELECT winner, reason, turns, duration_ms, created_at, summary_json
     FROM showdown_battles
    WHERE created_at >= ?1
    ORDER BY created_at ASC`,
  [since],
);

const envelope = source => ({
  source,
  generatedAt: new Date(now).toISOString(),
  windowDays: WINDOW_DAYS,
  since,
  until: now,
});

writeFileSync(
  new URL("_runs.json", DATA),
  `${JSON.stringify({ ...envelope("er-saves.runs"), rows: anonymizedRuns })}\n`,
  "utf8",
);
writeFileSync(
  new URL("_showdown.json", DATA),
  `${JSON.stringify({ ...envelope("er-telemetry.showdown_battles"), rows: showdownRows })}\n`,
  "utf8",
);

console.log(
  `Exported ${anonymizedRuns.length} anonymized runs from ${anonymousPlayers.size} distinct players and ${showdownRows.length} Showdown matches`,
);
