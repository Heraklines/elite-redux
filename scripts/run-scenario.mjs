#!/usr/bin/env node
import { spawnSync } from "node:child_process";
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
 *   node scripts/run-scenario.mjs <ERS1-code | @path/to/spec.json | demo> [flags]
 *
 * Flags:
 *   --turns N        max player turns per battle (default 5)
 *   --move MOVE      force a player move each turn (MoveId number or enum name)
 *   --waves N        play N consecutive waves (drive the reward shop between)
 *   --to-end         play the ENTIRE run until victory / game-over (wave 200 boss)
 *   --quiet          suppress the per-turn STATE spam (keeps per-wave summaries)
 *   --auto-first     press through any UNKNOWN interactive menu (option 0 / cancel),
 *                    logging `[auto-first] <mode>` so new content never hard-hangs a run
 *   --policy FILE    merge a JSON policy blob over the spec (@file or inline JSON):
 *                    rewards / biomePicks / biomeShops / meOptions / eggs / onCatchFull /
 *                    crossroads / forceMysteryEncounters / betweenWaves (+ run.* sub-keys)
 *   --json-out FILE  write a machine-readable run result to FILE
 *   --no-miss        force every move to hit
 *   --no-crit        force no crits (deterministic stat stages)
 *   --real-rng       restore the real seeded randBattleSeedInt (probabilistic procs)
 *
 * Examples:
 *   node scripts/run-scenario.mjs demo
 *   node scripts/run-scenario.mjs 'ERS1.eyJ2IjoxLC...'
 *   node scripts/run-scenario.mjs @my-scenario.json --waves 3
 *   node scripts/run-scenario.mjs demo --to-end --quiet --json-out dev-logs/fullrun.json
 *   node scripts/run-scenario.mjs @run.json --policy @policy.json --waves 60 --quiet
 */
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
  console.log(
    "Usage: node scripts/run-scenario.mjs <ERS1-code | @file.json | demo> "
      + "[--turns N] [--move MOVE] [--waves N] [--to-end] [--quiet] [--auto-first] "
      + "[--policy @file.json] [--json-out FILE] [--no-miss] [--no-crit] [--real-rng]",
  );
  process.exit(argv.length === 0 ? 1 : 0);
}

const scenario = argv[0];
let turns;
let move;
let waves;
let toEnd = false;
let quiet = false;
let autoFirst = false;
let policyArg;
let jsonOut;
let noMiss = false;
let noCrit = false;
let realRng = false;
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === "--turns") {
    turns = argv[++i];
  } else if (argv[i] === "--move") {
    move = argv[++i];
  } else if (argv[i] === "--waves") {
    waves = argv[++i];
  } else if (argv[i] === "--to-end") {
    toEnd = true;
  } else if (argv[i] === "--quiet") {
    quiet = true;
  } else if (argv[i] === "--auto-first") {
    autoFirst = true;
  } else if (argv[i] === "--policy") {
    policyArg = argv[++i];
  } else if (argv[i] === "--json-out") {
    jsonOut = argv[++i];
  } else if (argv[i] === "--no-miss") {
    noMiss = true;
  } else if (argv[i] === "--no-crit") {
    noCrit = true;
  } else if (argv[i] === "--real-rng") {
    realRng = true;
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
if (waves) {
  env.ER_RUN_WAVES = waves;
}
if (toEnd) {
  env.ER_RUN_TO_END = "1";
}
if (quiet) {
  env.ER_RUN_QUIET = "1";
}
if (autoFirst) {
  env.ER_RUN_AUTO_FIRST = "1";
}
if (jsonOut) {
  env.ER_RUN_JSON_OUT = jsonOut;
}
if (policyArg) {
  // A `@file.json` reads the file; otherwise the arg IS the inline JSON blob.
  const raw = policyArg.startsWith("@") ? readFileSync(policyArg.slice(1), "utf8") : policyArg;
  // Validate it parses so a typo fails here, not deep in the harness.
  JSON.parse(raw);
  env.ER_RUN_POLICY = raw;
}
if (noMiss) {
  env.ER_RUN_NO_MISS = "1";
}
if (noCrit) {
  env.ER_RUN_NO_CRIT = "1";
}
if (realRng) {
  env.ER_RUN_REAL_RNG = "1";
}

// `--silent=false` so the game's console.log transcript reaches the terminal.
const res = spawnSync("npx", ["vitest", "run", "test/tools/run-scenario.test.ts", "--silent=false", "--no-color"], {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});
process.exit(res.status ?? 1);
