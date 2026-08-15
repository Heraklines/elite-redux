import assert from "node:assert/strict";
import test from "node:test";
import { aggregateRuns, buildLeaderboardPayload, WIN_RATE_MIN_RUNS } from "./leaderboard-core.mjs";

const NOW = Date.parse("2026-08-15T12:00:00.000Z");
const run = (player, index, overrides = {}) => ({
  user_id: player,
  player,
  outcome: "victory",
  difficulty: "ace",
  wave: 100,
  starters: JSON.stringify([index + 1]),
  challenges: "[]",
  created_at: NOW - (100 - index) * 1000,
  ...overrides,
});

test("win-rate boards require fifty completed runs", () => {
  const rows = [
    ...Array.from({ length: WIN_RATE_MIN_RUNS - 1 }, (_, index) => run("Short", index)),
    ...Array.from({ length: WIN_RATE_MIN_RUNS }, (_, index) =>
      run("Qualified", index, { outcome: index < 30 ? "victory" : "defeat" }),
    ),
  ];
  const payload = buildLeaderboardPayload({ saveRows: [], runRows: rows, generatedAt: new Date(NOW).toISOString() });
  const board = payload.boards.find(candidate => candidate.id === "ace-win-rate");
  assert.deepEqual(
    board.entries.map(entry => entry.player),
    ["Qualified"],
  );
  assert.equal(board.entries[0].value, 60);
});

test("run aggregation derives monotype clears, starter diversity, and no-repeat streaks", () => {
  const rows = [
    run("Player", 0, { starters: "[1,2]", challenges: "[[1,4]]", difficulty: "hell" }),
    run("Player", 1, { starters: "[3]", challenges: "[[1,7]]", difficulty: "elite" }),
    run("Player", 2, { starters: "[2]" }),
    run("Player", 3, { outcome: "defeat", starters: "[4]" }),
    run("Player", 4, { starters: "[5]" }),
    run("Player", 5, { starters: "[6]" }),
  ];
  const [line] = aggregateRuns(rows, NOW);
  assert.equal(line.monotypeClears, 2);
  assert.equal(line.hellMonotypeClears, 1);
  assert.equal(line.winningStarterCount, 5);
  assert.equal(line.challengeCombinationCount, 2);
  assert.equal(line.noRepeatBest, 2);
});

test("average and median wave use completed classic-range runs", () => {
  const rows = [20, 40, 200, 400].map((wave, index) => run("Player", index, { wave }));
  const [line] = aggregateRuns(rows, NOW);
  assert.equal(line.averageWave, 86.7);
  assert.equal(line.medianWave, 40);
});

test("save-backed boards rank values and preserve ties", () => {
  const saveRows = [
    { player: "Alpha", achievementCount: 10 },
    { player: "Beta", achievementCount: 10 },
    { player: "Gamma", achievementCount: 8 },
  ];
  const payload = buildLeaderboardPayload({ saveRows, runRows: [], generatedAt: new Date(NOW).toISOString() });
  const board = payload.boards.find(candidate => candidate.id === "achievements");
  assert.deepEqual(
    board.entries.map(entry => [entry.player, entry.rank]),
    [
      ["Alpha", 1],
      ["Beta", 1],
      ["Gamma", 3],
    ],
  );
});
