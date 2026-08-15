import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { pathToFileURL } from "node:url";

const outputPath = new URL("./data/leaderboards.json", import.meta.url);

test("nightly generator merges current summaries and qualifies fifty-run records", () => {
  const original = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : null;
  const directory = mkdtempSync(join(tmpdir(), "er-stats-generator-"));
  const preload = join(directory, "mock-fetch.mjs");
  const stats = {
    version: 1,
    achievementCount: 999,
    achievementPoints: 99999,
    ribbons: 99,
    sessionsWon: 88,
    shinySpecies: 77,
    blackShinySpecies: 66,
    shinyCaught: 55,
    shinyHatched: 44,
    shinyLabEffects: 33,
    uniqueRelics: 22,
    eggsPulled: 111,
    highestDamage: 123456,
    highestHeal: 654321,
    blackMarketRuns: 11,
  };
  const runs = Array.from({ length: 50 }, (_, index) => ({
    user_id: 9001,
    player: "FixtureRunner",
    outcome: "victory",
    difficulty: "ace",
    wave: 200,
    starters: JSON.stringify([index + 1]),
    challenges: JSON.stringify([[1, 1]]),
    created_at: Date.now() - index * 1000,
  }));
  writeFileSync(
    preload,
    `globalThis.fetch = async (_url, init) => {
      const { sql } = JSON.parse(init.body);
      let results = [];
      if (sql.startsWith("PRAGMA table_info")) results = [{ name: "leaderboard_stats" }];
      else if (sql.includes("s.leaderboard_stats AS stats")) results = [{ player: "FixturePlayer", stats: ${JSON.stringify(JSON.stringify(stats))} }];
      else if (sql.includes("COUNT(leaderboard_stats)")) results = [{ totalSaveCount: 1777, currentSummaryCount: 1 }];
      else if (sql.includes("FROM runs AS r")) results = ${JSON.stringify(runs)};
      return new Response(JSON.stringify({ success: true, result: [{ results }] }), { headers: { "Content-Type": "application/json" } });
    };\n`,
    "utf8",
  );
  try {
    const result = spawnSync(
      process.execPath,
      ["--import", pathToFileURL(preload).href, "stats/gen-leaderboards.mjs"],
      {
        cwd: new URL("../", import.meta.url),
        encoding: "utf8",
        env: {
          ...process.env,
          CLOUDFLARE_ACCOUNT_ID: "fixture-account",
          CLOUDFLARE_API_TOKEN: "fixture-token",
        },
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.equal(payload.boards.find(board => board.id === "achievements").entries[0].player, "FixturePlayer");
    assert.deepEqual(payload.boards.find(board => board.id === "ace-win-rate").entries[0], {
      rank: 1,
      player: "FixtureRunner",
      value: 100,
      detail: "50 wins / 50 runs",
      sample: 50,
      wins: 50,
    });
    assert.equal(payload.boards.find(board => board.id === "monotype-clears").entries[0].value, 50);
  } finally {
    if (original === null) {
      rmSync(outputPath, { force: true });
    } else {
      writeFileSync(outputPath, original, "utf8");
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
