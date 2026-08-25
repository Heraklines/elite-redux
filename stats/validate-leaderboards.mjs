import { existsSync, readFileSync, readdirSync } from "node:fs";
import { WIN_RATE_MIN_RUNS } from "./leaderboard-core.mjs";

const DATA = new URL("./data/", import.meta.url);
const payload = JSON.parse(readFileSync(new URL("leaderboards.json", DATA), "utf8"));
const maxAgeHours = Number(process.env.STATS_MAX_AGE_HOURS || 12);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const ageHours = value => (Date.now() - Date.parse(value)) / 3_600_000;
const expectedBoards = new Set([
  "achievements",
  "achievement-points",
  "ribbons",
  "victories",
  "black-shiny-species",
  "shiny-lab-effects",
  "unique-relics",
  "eggs-pulled",
  "highest-damage",
  "highest-healing",
  "black-market-runs",
  "ace-win-rate",
  "elite-win-rate",
  "hell-win-rate",
  "average-wave",
  "median-wave",
  "unique-winning-starters",
  "challenge-combinations",
  "monotype-clears",
  "hell-monotype-clears",
  "no-repeat-streak",
  "form-30-days",
  "form-90-days",
]);

assert(Number.isFinite(Date.parse(payload.generatedAt)), "generatedAt is invalid");
assert(ageHours(payload.generatedAt) >= -1 && ageHours(payload.generatedAt) <= maxAgeHours, "leaderboards are stale");
assert(payload.topLimit === 100, "topLimit must be 100");
assert(payload.eligibility?.winRateMinimumRuns === WIN_RATE_MIN_RUNS, "win-rate minimum is incorrect");
assert(payload.eligibility?.eligibleSaveCount >= 100, "too few readable player saves");
assert(
  Array.isArray(payload.boards) && payload.boards.length === expectedBoards.size,
  "leaderboard catalog is incomplete",
);

const forbiddenKeys = new Set([
  "email",
  "password",
  "password_hash",
  "secretId",
  "secret_id",
  "trainerId",
  "trainer_id",
  "userId",
  "user_id",
  "data",
  "player_team",
  "opponent_team",
  "starters",
  "challenges",
]);
const walk = value => {
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    assert(!forbiddenKeys.has(key), `public leaderboard contains forbidden field: ${key}`);
    walk(child);
  }
};
walk(payload);

for (const board of payload.boards) {
  assert(expectedBoards.delete(board.id), `unexpected or duplicate board: ${board.id}`);
  assert(typeof board.label === "string" && board.label.length > 0, `${board.id} has no label`);
  assert(Array.isArray(board.entries) && board.entries.length <= 100, `${board.id} exceeds top 100`);
  const players = new Set();
  let previousValue = Number.POSITIVE_INFINITY;
  for (const entry of board.entries) {
    assert(
      typeof entry.player === "string" && entry.player.length > 0 && entry.player.length <= 30,
      `${board.id} has an invalid player name`,
    );
    assert(!players.has(entry.player.toLowerCase()), `${board.id} contains a duplicate player`);
    assert(Number.isInteger(entry.rank) && entry.rank >= 1 && entry.rank <= 100, `${board.id} has an invalid rank`);
    assert(Number.isFinite(entry.value) && entry.value > 0, `${board.id} has an invalid value`);
    assert(entry.value <= previousValue, `${board.id} is not sorted descending`);
    if (board.format === "percent") {
      assert(entry.value <= 100, `${board.id} has an invalid percentage`);
      assert(entry.sample >= WIN_RATE_MIN_RUNS, `${board.id} includes an unqualified win rate`);
    }
    players.add(entry.player.toLowerCase());
    previousValue = entry.value;
  }
}
assert(expectedBoards.size === 0, `missing boards: ${[...expectedBoards].join(", ")}`);

const deployArg = process.argv.find(argument => argument.startsWith("--deploy="));
if (deployArg) {
  const deployPath = deployArg.slice("--deploy=".length);
  const deployUrl = new URL(
    `${deployPath.replace(/\\/g, "/").replace(/\/$/, "")}/`,
    `file:///${process.cwd().replace(/\\/g, "/")}/`,
  );
  for (const file of [
    "index.html",
    "app.js",
    "styles.css",
    "leaderboards.html",
    "leaderboards.js",
    "leaderboards.css",
    "_headers",
    "data/dex.json",
    "data/species-stats.json",
    "data/dex-detail.json",
    "data/species-extra.json",
    "data/leaderboards.json",
    "data/balance-observations.json",
    "data/_decisions.json",
    "data/_runs.json",
    "data/_showdown.json",
  ]) {
    assert(existsSync(new URL(file, deployUrl)), `deploy file is missing: ${file}`);
  }
  const publicDataFiles = readdirSync(new URL("data/", deployUrl)).sort();
  const expectedDataFiles = [
    "_decisions.json",
    "_runs.json",
    "_showdown.json",
    "balance-observations.json",
    "dex-detail.json",
    "dex.json",
    "leaderboards.json",
    "species-extra.json",
    "species-stats.json",
  ].sort();
  assert(
    publicDataFiles.length === expectedDataFiles.length &&
      publicDataFiles.every((file, index) => file === expectedDataFiles[index]),
    "deploy data contains unexpected files",
  );
}

console.log(
  `Validated ${payload.boards.length} leaderboards for ${payload.eligibility.eligibleSaveCount} readable saves (top ${payload.topLimit})`,
);
