#!/usr/bin/env node
/*
 * Headless scenario runner CLI wrapper.
 *
 * Plays a dev ScenarioSpec through the REAL game logic headlessly (no browser),
 * printing a per-turn state transcript + the game's own console output. This is
 * the fast way to reproduce a bug from a scenario / `ERS1.` share code without
 * touching a browser. It just sets env + spawns the vitest harness
 * (test/tools/run-scenario.test.ts).
 *
 * Usage:
 *   node scripts/run-scenario.mjs <ERS1-code | @path/to/spec.json | demo> [--turns N] [--move MOVE] [--no-miss] [--no-crit]
 *
 * Examples:
 *   node scripts/run-scenario.mjs demo                       # built-in Anger Point repro
 *   node scripts/run-scenario.mjs 'ERS1.eyJ2IjoxLC...'        # a share code from a bug report
 *   node scripts/run-scenario.mjs @my-scenario.json --turns 8
 *   node scripts/run-scenario.mjs demo --move TACKLE          # force a player move each turn
 *
 * MOVE may be a numeric MoveId or an enum name (e.g. TACKLE). Omitted = the
 * active mon's first usable move.
 */
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
  console.log(
    "Usage: node scripts/run-scenario.mjs <ERS1-code | @file.json | demo> [--turns N] [--move MOVE] [--no-miss] [--no-crit]",
  );
  process.exit(argv.length === 0 ? 1 : 0);
}

const scenario = argv[0];
let turns;
let move;
let noMiss = false;
let noCrit = false;
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === "--turns") {
    turns = argv[++i];
  } else if (argv[i] === "--move") {
    move = argv[++i];
  } else if (argv[i] === "--no-miss") {
    noMiss = true;
  } else if (argv[i] === "--no-crit") {
    noCrit = true;
  } else {
    console.error(`unknown arg: ${argv[i]}`);
    process.exit(1);
  }
}

const env = {
  ...process.env,
  ER_SCENARIO: "1", // wire ER abilities/species/difficulty in the headless game
  ER_RUN_SCENARIO: scenario,
};
if (turns) {
  env.ER_RUN_TURNS = turns;
}
if (move) {
  env.ER_RUN_MOVE = move;
}
if (noMiss) {
  env.ER_RUN_NO_MISS = "1";
}
if (noCrit) {
  env.ER_RUN_NO_CRIT = "1";
}

// `--silent=false` so the game's console.log transcript reaches the terminal.
const res = spawnSync("npx", ["vitest", "run", "test/tools/run-scenario.test.ts", "--silent=false", "--no-color"], {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});
process.exit(res.status ?? 1);
