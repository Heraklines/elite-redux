import { readFileSync, writeFileSync } from "node:fs";
import { buildLeaderboardPayload } from "./leaderboard-core.mjs";

const ROOT = new URL("../", import.meta.url);
const DATA = new URL("./data/", import.meta.url);
const PAGE_SIZE = 1000;
const runLimit = Math.max(0, Number.parseInt(process.env.LEADERBOARD_RUN_LIMIT || "0", 10));
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const saveBoardFields = new Map([
  ["achievements", "achievementCount"],
  ["achievement-points", "achievementPoints"],
  ["ribbons", "ribbons"],
  ["victories", "sessionsWon"],
  ["black-shiny-species", "blackShinySpecies"],
  ["shiny-lab-effects", "shinyLabEffects"],
  ["unique-relics", "uniqueRelics"],
  ["eggs-pulled", "eggsPulled"],
  ["highest-damage", "highestDamage"],
  ["highest-healing", "highestHeal"],
  ["black-market-runs", "blackMarketRuns"],
]);

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
    const detail =
      body?.errors
        ?.map(error => error.message)
        .filter(Boolean)
        .join("; ") || response.statusText;
    throw new Error(`Cloudflare D1 query failed (${response.status}): ${detail}`);
  }
  const result = Array.isArray(body.result) ? body.result[0] : body.result;
  return Array.isArray(result?.results) ? result.results : [];
}

async function pagedQuery(database, selectSql) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await query(database, `${selectSql} LIMIT ?1 OFFSET ?2`, [PAGE_SIZE, offset]);
    rows.push(...page);
    if (page.length < PAGE_SIZE) {
      return rows;
    }
  }
}

function bootstrapRows(payload) {
  const rows = new Map();
  for (const board of payload.boards ?? []) {
    const field = saveBoardFields.get(board.id);
    if (!field) {
      continue;
    }
    for (const entry of board.entries ?? []) {
      const player = String(entry.player ?? "");
      const value = Number(entry.value);
      if (!player || !Number.isFinite(value) || value < 0) {
        continue;
      }
      const key = player.toLocaleLowerCase("en-US");
      rows.set(key, { ...(rows.get(key) ?? {}), player, [field]: value });
    }
  }
  return rows;
}

function currentRows(rows) {
  const parsed = [];
  for (const row of rows) {
    try {
      const stats = JSON.parse(String(row.stats ?? ""));
      if (stats.version !== 1) {
        continue;
      }
      const player = String(row.player ?? "");
      const values = { player };
      for (const field of saveBoardFields.values()) {
        const value = Number(stats[field]);
        if (!Number.isSafeInteger(value) || value < 0) {
          throw new Error(`Invalid ${field}`);
        }
        values[field] = value;
      }
      if (player) {
        parsed.push(values);
      }
    } catch {}
  }
  return parsed;
}

const bootstrap = JSON.parse(readFileSync(new URL("leaderboards-bootstrap.json", DATA), "utf8"));
const savesDb = databaseId("workers/er-save-api/wrangler.toml", "er-saves");
const columns = await query(savesDb, "PRAGMA table_info(system_saves)");
if (!columns.some(column => column.name === "leaderboard_stats")) {
  await query(savesDb, "ALTER TABLE system_saves ADD COLUMN leaderboard_stats TEXT");
}
const summaryRows = currentRows(
  await pagedQuery(
    savesDb,
    `SELECT u.username AS player, s.leaderboard_stats AS stats
       FROM system_saves AS s
       JOIN users AS u ON u.id = s.user_id
      WHERE s.leaderboard_stats IS NOT NULL
      ORDER BY u.username_lower ASC`,
  ),
);
const mergedSaveRows = bootstrapRows(bootstrap);
for (const row of summaryRows) {
  mergedSaveRows.set(row.player.toLocaleLowerCase("en-US"), row);
}
const counts = (
  await query(
    savesDb,
    "SELECT COUNT(*) AS totalSaveCount, COUNT(leaderboard_stats) AS currentSummaryCount FROM system_saves",
  )
)[0] ?? { totalSaveCount: 0, currentSummaryCount: 0 };
const runSelectSql = `SELECT r.user_id, u.username AS player, r.outcome, r.difficulty, r.wave,
            r.starters, r.challenges, r.created_at
       FROM runs AS r
       JOIN users AS u ON u.id = r.user_id
      ORDER BY r.created_at ASC, r.id ASC`;
const runRows =
  runLimit > 0 ? await query(savesDb, `${runSelectSql} LIMIT ?1`, [runLimit]) : await pagedQuery(savesDb, runSelectSql);
const generatedAt = new Date().toISOString();
const eligibleSaveCount = Math.max(
  Number(bootstrap.eligibility?.eligibleSaveCount ?? 0),
  Number(counts.currentSummaryCount ?? 0),
);
const payload = buildLeaderboardPayload({
  saveRows: [...mergedSaveRows.values()],
  runRows,
  generatedAt,
  eligibleSaveCount,
  totalSaveCount: counts.totalSaveCount,
  currentSummaryCount: counts.currentSummaryCount,
});
writeFileSync(new URL("leaderboards.json", DATA), `${JSON.stringify(payload)}\n`, "utf8");
console.log(
  `Generated ${payload.boards.length} top-${payload.topLimit} leaderboards from ${eligibleSaveCount} indexed saves (${summaryRows.length} current) and ${runRows.length} recorded runs`,
);
