#!/usr/bin/env node
import { spawnSync } from "node:child_process";
/*
 * Single-player REPLAY runner CLI wrapper (#record-replay).
 *
 * Re-drives a captured single-player `ReplayTrace` through the REAL game logic headlessly (no browser):
 * it rebuilds the run from the trace header (seed + roster) and replays the ordered command + interaction
 * events, printing per-event progress and a final "REPLAYED 1:1" (a clean reproduction) or a DIVERGENCE
 * REPORT (what drifted, by index + expected-vs-actual). This is the fast way to reproduce a live player's
 * bug report from the trace it ships with.
 *
 * The <input> can be:
 *   - a raw ReplayTrace JSON file,
 *   - a bug-report JSON (the downloaded er-bug-report-*.json, which has a `replayTrace` field), or
 *   - a dev-logs `.log` capture (header + DESCRIPTION + CONSOLE + the fenced REPLAY TRACE section);
 * the harness EXTRACTS the trace from whichever it is.
 *
 * Usage:
 *   node scripts/replay-run.mjs <trace.json | bug-report.log> [--turns-limit N] [--json-out f] [--quiet]
 *
 * Examples:
 *   node scripts/replay-run.mjs dev-logs/remote/2026-07-02/xxxx__bug-report__player.log
 *   node scripts/replay-run.mjs er-bug-report-1730000000000.json --json-out result.json
 *   node scripts/replay-run.mjs trace.json --turns-limit 6 --quiet
 *
 * It sets ER_SCENARIO=1 for you and shells into test/tools/replay-single.test.ts via vitest (mirroring
 * scripts/run-scenario.mjs). Exit code is nonzero on a hard fault / phase stall (a hang surfaces); a
 * DIVERGENCE is reported (not a hard failure) since a divergence can BE the reproduction of the bug.
 */
import { existsSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
  console.log(
    "Usage: node scripts/replay-run.mjs <trace.json | bug-report.log> [--turns-limit N] [--json-out f] [--quiet]",
  );
  process.exit(argv.length === 0 ? 1 : 0);
}

const input = argv[0];
let turnsLimit;
let jsonOut;
let quiet = false;
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === "--turns-limit") {
    turnsLimit = argv[++i];
  } else if (argv[i] === "--json-out") {
    jsonOut = argv[++i];
  } else if (argv[i] === "--quiet") {
    quiet = true;
  } else {
    console.error(`unknown arg: ${argv[i]}`);
    process.exit(1);
  }
}

if (!existsSync(input)) {
  console.error(`input file not found: ${input}`);
  process.exit(1);
}

const env = {
  ...process.env,
  ER_SCENARIO: "1", // wire ER abilities/species/difficulty in the headless game
  ER_REPLAY_TRACE: path.resolve(input),
};
if (turnsLimit) {
  env.ER_REPLAY_TURNS_LIMIT = turnsLimit;
}
if (jsonOut) {
  env.ER_REPLAY_JSON_OUT = path.resolve(jsonOut);
}
if (quiet) {
  env.ER_REPLAY_QUIET = "1";
}

// `--silent=false` so the game's console transcript + the replay progress reach the terminal.
const res = spawnSync("npx", ["vitest", "run", "test/tools/replay-single.test.ts", "--silent=false", "--no-color"], {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});
process.exit(res.status ?? 1);
