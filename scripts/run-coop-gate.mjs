/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP TEST GATE (#879). ONE green command = the co-op directory is shippable.
//
// WHY THIS EXISTS. The 136-file test/tests/elite-redux/coop/ dir runs under vitest `isolate: false`
// (module state - incl. `globalScene` - is SHARED across files in run order). Vitest's DEFAULT pool spreads
// those files across ~one-fork-per-core WORKERS, and each fork process starts with a FRESH module registry
// (its own `globalScene`). So the deterministic sequencer order that keeps the shared-scene chain intact
// (a real BattleScene boots first, later stub-scene files capture + restore it) is FRAGMENTED: a fork that
// happens to receive a stub-scene file first has no real scene to chain, and an engine file that lands after
// it crashes (`globalScene.updateMoneyText is not a function` / `pokemon.setMove is not a function`) or a
// heavy duo file times out under the CPU contention of ~11 forks. Which files land in which fork - and in
// what order - varies run to run, so 2-17 files fail NONDETERMINISTICALLY, every one passing solo (#879).
//
// THE FIX IS SCHEDULING ONLY (no assertion is weakened). Each LANE runs its files in a SINGLE worker with
// `--no-file-parallelism`, so the files execute sequentially in the sequencer's deterministic order and the
// shared-scene chain is never fragmented; and the lanes run one-at-a-time, so the box is never under the
// ~11-fork load that caused the hook/waitUntil timeouts. The dir is split into three lanes calibrated on this
// box so each is individually reliable:
//   - Lane A (engine-free / light): the coop repros that do NOT boot a real engine (no ER_SCENARIO gate) -
//     stub-scene handler/relay unit tests. Fast; sequential keeps their globalScene citizenship intact.
//   - Lane B (heavy duo / engine): every ER_SCENARIO-gated two-engine + engine coop test EXCEPT the soaks -
//     each boots a real BattleScene (or two). The bulk of the runtime; sequential single-fork = no contention.
//   - Lane C (soak-style): the coop-soak* driver runs - the heaviest per file (a full randomized run) - kept
//     in their own sequential lane so a slow soak never shares a worker with anything else.
//
// USAGE:
//   node scripts/run-coop-gate.mjs                 # run all lanes, aggregate (exit 0 = all green)
//   node scripts/run-coop-gate.mjs --lane A        # run one lane (A|B|C)
//   node scripts/run-coop-gate.mjs --list          # print the calibrated lane composition + counts, run nothing
//   pnpm coop:gate                                 # the package.json alias
//
// EXIT: 0 iff EVERY lane passed. Per-lane summaries (file count / pass-fail / duration) print at the end.
// =============================================================================

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const COOP_DIR = join(REPO_ROOT, "test", "tests", "elite-redux", "coop");
const COOP_DIR_REL = "test/tests/elite-redux/coop";

/** Read a test file and report whether it gates on ER_SCENARIO (i.e. it boots the real engine). */
function isEngineGated(absPath) {
  const src = readFileSync(absPath, "utf8");
  return /process\.env\.ER_SCENARIO/.test(src);
}

/** Categorize every coop test file into lane A (engine-free), B (heavy engine), or C (soak). */
function categorize() {
  const files = readdirSync(COOP_DIR)
    .filter(f => f.endsWith(".test.ts"))
    .sort();
  const lanes = { A: [], B: [], C: [] };
  for (const f of files) {
    const rel = `${COOP_DIR_REL}/${f}`;
    if (/(^|[-_])soak/.test(f)) {
      // coop-soak.test.ts + coop-soak-*.test.ts - the heaviest per-file runs.
      lanes.C.push(rel);
    } else if (isEngineGated(join(COOP_DIR, f))) {
      // Any ER_SCENARIO-gated non-soak test (the two-engine duo files + the other real-engine coop tests).
      lanes.B.push(rel);
    } else {
      // Engine-free stub-scene repros (no ER_SCENARIO gate).
      lanes.A.push(rel);
    }
  }
  return lanes;
}

/**
 * Run one lane: a single `vitest run` over the lane's file list with `--no-file-parallelism` (one worker,
 * sequential, deterministic order) and ER_SCENARIO=1 (so the engine-gated files actually run). Returns the
 * lane result (pass/fail + duration + the parsed summary line).
 */
function runLane(name, files) {
  if (files.length === 0) {
    return { name, files: 0, ok: true, ms: 0, summary: "(no files)" };
  }
  // eslint-disable-next-line no-console
  console.log(`\n=== LANE ${name}: ${files.length} files (sequential, single worker) ===`);
  const started = Date.now();
  const res = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["vitest", "run", ...files, "--no-file-parallelism"],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, ER_SCENARIO: "1" },
      stdio: ["ignore", "inherit", "inherit"],
      encoding: "utf8",
    },
  );
  const ms = Date.now() - started;
  const ok = res.status === 0;
  return { name, files: files.length, ok, ms, summary: ok ? "PASS" : `FAIL (exit ${res.status})` };
}

function fmtMs(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function main() {
  const args = process.argv.slice(2);
  const lanes = categorize();

  if (args.includes("--list")) {
    for (const [name, files] of Object.entries(lanes)) {
      // eslint-disable-next-line no-console
      console.log(`\n=== LANE ${name} (${files.length} files) ===`);
      for (const f of files) {
        // eslint-disable-next-line no-console
        console.log(`  ${f}`);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`\nTOTAL: ${Object.values(lanes).reduce((n, l) => n + l.length, 0)} files`);
    return;
  }

  const laneArgIdx = args.indexOf("--lane");
  const only = laneArgIdx >= 0 ? args[laneArgIdx + 1]?.toUpperCase() : undefined;
  const order = only ? [only] : ["A", "B", "C"];

  const results = [];
  for (const name of order) {
    if (!lanes[name]) {
      // eslint-disable-next-line no-console
      console.error(`unknown lane "${name}" (expected A, B, or C)`);
      process.exit(2);
    }
    results.push(runLane(name, lanes[name]));
  }

  // eslint-disable-next-line no-console
  console.log("\n=========================== CO-OP GATE SUMMARY ===========================");
  let allOk = true;
  for (const r of results) {
    allOk = allOk && r.ok;
    // eslint-disable-next-line no-console
    console.log(`  LANE ${r.name}: ${r.summary.padEnd(16)} ${String(r.files).padStart(3)} files  ${fmtMs(r.ms)}`);
  }
  const total = results.reduce((n, r) => n + r.ms, 0);
  // eslint-disable-next-line no-console
  console.log("  ------------------------------------------------------------------------");
  // eslint-disable-next-line no-console
  console.log(`  ${allOk ? "ALL LANES GREEN" : "GATE RED"}  total ${fmtMs(total)}`);
  process.exit(allOk ? 0 : 1);
}

main();
