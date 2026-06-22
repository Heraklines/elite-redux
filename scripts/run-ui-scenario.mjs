#!/usr/bin/env node
/*
 * Headless UI-surface runner CLI wrapper.
 *
 * Drives a non-combat UI surface (currently starter-select) through the REAL game
 * headlessly (no browser), printing what each screen WOULD render: resolved sprite
 * keys, computed ability/passive/name text, and whether the handler threw. This is
 * the fast way to catch the "visual" bug classes that are really data bugs —
 * crash-to-black, wrong/missing sprite, blank field — without pixels. It just sets
 * env + spawns the vitest harness (test/tools/run-ui-scenario.test.ts).
 *
 * Usage:
 *   node scripts/run-ui-scenario.mjs [species,species,...] [--strict]
 *
 * Examples:
 *   node scripts/run-ui-scenario.mjs                                  # built-in demo set
 *   node scripts/run-ui-scenario.mjs RATTATA_REDUX,MINCCINO_REDUX     # the wrong-sprite repros
 *   node scripts/run-ui-scenario.mjs CHARIZARD --strict               # fail on a sprite mismatch
 *
 * A species is a SpeciesId name, an ErSpeciesId name (e.g. RATTATA_REDUX), or a
 * numeric id. Omitted = a built-in demo (vanilla baseline + the live repro species).
 */
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
if (argv[0] === "--help" || argv[0] === "-h") {
  console.log("Usage: node scripts/run-ui-scenario.mjs [species,species,...] [--strict]");
  process.exit(0);
}

let species;
let strict = false;
for (const arg of argv) {
  if (arg === "--strict") {
    strict = true;
  } else if (arg.startsWith("--")) {
    console.error(`unknown arg: ${arg}`);
    process.exit(1);
  } else {
    species = arg;
  }
}

const env = {
  ...process.env,
  ER_SCENARIO: "1", // wire ER species/sprite-redirect in the headless game
};
if (species) {
  env.ER_UI_SPECIES = species;
}
if (strict) {
  env.ER_UI_STRICT = "1";
}

// `--silent=false` so the per-species STATE transcript reaches the terminal.
const res = spawnSync("npx", ["vitest", "run", "test/tools/run-ui-scenario.test.ts", "--silent=false", "--no-color"], {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});
process.exit(res.status ?? 1);
