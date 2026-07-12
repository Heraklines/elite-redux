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
// THE FIX IS SCHEDULING ONLY (no assertion is weakened). Engine-heavy files run sequentially in independent
// Vitest processes. This preserves deterministic order and one-process-at-a-time resource use while also
// reclaiming Phaser/module heaps and cancelling leaked timers between files. Engine-free Lane A remains one
// sequential process because its stub-scene tests intentionally share a scene chain. The dir is split into
// calibrated lanes:
//   - Lane A (engine-free / light): the coop repros that do NOT boot a real engine (no ER_SCENARIO gate) -
//     stub-scene handler/relay unit tests. Fast; sequential keeps their globalScene citizenship intact.
//   - Lane B (heavy duo / engine): every ER_SCENARIO-gated two-engine + engine coop test EXCEPT the soaks -
//     each boots a real BattleScene (or two). The bulk of the runtime; sequential single-fork = no contention.
//   - Lane C (soak-style): the coop-soak* driver runs - the heaviest per file (a full randomized run) - kept
//     in their own sequential lane so a slow soak never shares a worker with anything else. These run in the
//     driver's DEFAULT "harness" fidelity (the driver heals the guest through convenient seams to stay green).
//   - Lane P (PRODUCTION-FIDELITY soak, #897): a SINGLE bounded soak run (coop-soak-fidelity-gate.test.ts)
//     with SOAK_FIDELITY=production - NO harness heals, guest commands sourced from the guest's OWN scene - so
//     it catches the "guest replay drifted" divergence class lane C structurally cannot. It is GATING: the
//     gate test does NOT swallow a hard LOCKSTEP/NO-PARK/TEARDOWN breach (unlike the non-gating evidence test
//     coop-soak-fidelity.test.ts), so any hard-invariant failure = nonzero exit = GATE RED. Bounded to
//     PROD_FIDELITY_GATE_WAVES waves so the gate stays wall-clock-bounded (the long god soak stays nightly).
//
// USAGE:
//   node scripts/run-coop-gate.mjs                 # run all lanes, aggregate (exit 0 = all green)
//   node scripts/run-coop-gate.mjs --lane A        # run one lane (A|B|C|P)
//   node scripts/run-coop-gate.mjs --lane B --shard 1/8  # one deterministic external-compute shard
//   node scripts/run-coop-gate.mjs --list          # print the calibrated lane composition + counts, run nothing
//   pnpm coop:gate                                 # the package.json alias
//
// EXIT: 0 iff EVERY gating lane (A,B,C,P) passed. Per-lane summaries (file count / pass-fail / duration) print at the end.
// =============================================================================

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const COOP_DIR = join(REPO_ROOT, "test", "tests", "elite-redux", "coop");
const COOP_DIR_REL = "test/tests/elite-redux/coop";

/**
 * LANE P (#897): the GATING production-fidelity soak. The nightly soak (lane C) heals the guest through
 * harness-only seams a live client never takes, so it CANNOT catch the "guest replay drifted" class the
 * prod path still hits; and the standing prod-fidelity *evidence* test (coop-soak-fidelity.test.ts) is
 * DELIBERATELY non-gating - it swallows a hard LOCKSTEP/NO-PARK/TEARDOWN breach into a green pass as long as
 * wave 1 ran (the reviewer's finding: "a hard invariant failure after wave 1 still passes"). LANE P closes
 * that hole: it runs a SEPARATE, BOUNDED prod-fidelity test (coop-soak-fidelity-gate.test.ts) that does NOT
 * catch SoakInvariantError, so any hard-invariant breach = a failed test = nonzero exit = GATE RED. It runs
 * only the ONE gate file (routed here, NOT into lane C) with SOAK_FIDELITY=production + a bounded wave count
 * so the gate stays wall-clock-bounded (the long nightly god soak stays in the evidence test / nightly job).
 */
const PROD_FIDELITY_GATE_FILE = "coop-soak-fidelity-gate.test.ts";
const PROD_FIDELITY_GATE_WAVES = 12;

/**
 * QUARANTINE (#879): files that fail PRE-EXISTINGLY - they exit non-zero even run SOLO on a clean parent
 * HEAD, so their failure is NOT the multi-fork scheduling nondeterminism this gate exists to fix and NO
 * scheduling change can make them green. They are run in a SEPARATE, LOUDLY-REPORTED, NON-GATING pass so the
 * gate's exit code reflects the SHIPPABLE surface, and are listed here with the reason + the verify command
 * so the pre-existing defect is fixed SEPARATELY (never silently). This is NOT weakening an assertion - the
 * quarantined file still runs with every assertion intact; it is simply not allowed to mask the scheduling
 * fix behind a defect that predates it. Keep this list EMPTY-by-default discipline: only a file proven to
 * fail solo belongs here, each with its reason.
 */
const QUARANTINE = new Map();

/** Read a test file and report whether it gates on ER_SCENARIO (i.e. it boots the real engine). */
function isEngineGated(absPath) {
  const src = readFileSync(absPath, "utf8");
  return /process\.env\.ER_SCENARIO/.test(src);
}

/**
 * The set of git-TRACKED coop test files (basenames). A ship gate must run only COMMITTED code - an
 * untracked WIP test another worktree/agent dropped into the dir (this is a shared repo) is not part of the
 * shippable surface and must not red the gate. Falls back to "everything" if git is unavailable.
 */
function trackedTestBasenames() {
  const res = spawnSync(process.platform === "win32" ? "git.exe" : "git", ["ls-files", `${COOP_DIR_REL}/*.test.ts`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (res.status !== 0 || typeof res.stdout !== "string") {
    return null;
  }
  return new Set(
    res.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map(p => p.slice(p.lastIndexOf("/") + 1)),
  );
}

/**
 * Categorize every TRACKED coop test file into lane A (engine-free), B (heavy engine), C (soak),
 * P (gating production-fidelity soak, #897), or Q (quarantine).
 */
function categorize() {
  const tracked = trackedTestBasenames();
  const files = readdirSync(COOP_DIR)
    .filter(f => f.endsWith(".test.ts"))
    .filter(f => tracked == null || tracked.has(f))
    .sort();
  const lanes = { A: [], B: [], C: [], P: [], Q: [] };
  for (const f of files) {
    const rel = `${COOP_DIR_REL}/${f}`;
    if (QUARANTINE.has(f)) {
      // Pre-existing solo failure - run non-gating (see QUARANTINE).
      lanes.Q.push(rel);
    } else if (f === PROD_FIDELITY_GATE_FILE) {
      // #897: the GATING prod-fidelity soak - its OWN lane with SOAK_FIDELITY=production (see PROD_FIDELITY_GATE_FILE).
      // Routed here BEFORE the /soak/ match so it never lands in lane C (which runs harness-fidelity, no env).
      lanes.P.push(rel);
    } else if (/(^|[-_])soak/.test(f)) {
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
 * Per-lane vitest MODULE isolation. Heavy lanes also get PROCESS isolation in {@linkcode runLane}; `--isolate`
 * alone resets module contexts but Vitest still reuses the worker process, so Phaser heaps and asynchronous
 * scene work can survive between files. Lane A (engine-free stub repros) is deliberately `--no-isolate`:
 * those files intentionally CHAIN a real `globalScene` across the dir (capture prevGlobalScene -> restore),
 * so isolating them would strand a stub with no real scene to chain; Lane A is already reliably green as-is.
 */
const LANE_ISOLATE = { A: false, B: true, C: true, P: true, Q: false };

/** Lanes whose files each run in a fresh, sequential Vitest process (heap + timer isolation). */
const LANE_PROCESS_ISOLATE = { A: false, B: true, C: true, P: true, Q: false };

/**
 * Per-lane EXTRA env (merged over ER_SCENARIO=1). Only LANE P (#897) needs any: it forces the soak driver
 * into production-fidelity mode (no harness heals) and bounds the wave count so the gate stays wall-clock
 * -bounded. Every other lane runs with the plain ER_SCENARIO=1 env (empty here).
 */
const LANE_ENV = {
  A: {},
  B: {},
  C: {},
  P: { SOAK_FIDELITY: "production", SOAK_WAVES: String(PROD_FIDELITY_GATE_WAVES) },
  Q: {},
};

/**
 * Run one lane sequentially. Heavy lanes execute one file per Vitest child process; this is still one worker
 * at a time on the runner, but releases the entire heap and kills leaked async scene work between files.
 * Lane A keeps one grouped process for its intentional shared-scene chain. Every file runs even after a red
 * so one checkpoint returns the complete failure batch.
 */
function runLane(name, files) {
  if (files.length === 0) {
    const ok = name === "Q";
    return {
      name,
      files: 0,
      ok,
      ms: 0,
      summary: ok ? "(no quarantined files)" : "FAIL (required lane discovered zero files)",
    };
  }
  const isolate = LANE_ISOLATE[name] ? "--isolate" : "--no-isolate";
  const extraEnv = Object.entries(LANE_ENV[name] ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  // eslint-disable-next-line no-console
  console.log(
    `\n=== LANE ${name}: ${files.length} files (sequential, ${LANE_PROCESS_ISOLATE[name] ? "fresh process/file" : "single process"}, ${isolate}${extraEnv ? `, ${extraEnv}` : ""}) ===`,
  );
  const started = Date.now();
  const groups = LANE_PROCESS_ISOLATE[name] ? files.map(file => [file]) : [files];
  let failures = 0;
  for (const [index, group] of groups.entries()) {
    if (groups.length > 1) {
      console.log(`\n--- LANE ${name} FILE ${index + 1}/${groups.length}: ${group[0]} ---`);
    }
    // shell:true + a single command string lets Windows resolve npx.cmd through PATHEXT. Paths are repo-relative
    // and contain no spaces. Only one child exists at a time, so external sharding supplies all concurrency.
    const cmd = `npx vitest run ${group.join(" ")} --no-file-parallelism ${isolate}`;
    const res = spawnSync(cmd, {
      cwd: REPO_ROOT,
      env: { ...process.env, ER_SCENARIO: "1", ...(LANE_ENV[name] ?? {}) },
      stdio: ["ignore", "inherit", "inherit"],
      encoding: "utf8",
      shell: true,
    });
    if (res.status !== 0) {
      failures++;
    }
  }
  const ms = Date.now() - started;
  const ok = failures === 0;
  return { name, files: files.length, ok, ms, summary: ok ? "PASS" : `FAIL (${failures} file process(es))` };
}

function fmtMs(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** The `--list` header suffix for a lane (marks the two non-standard lanes). */
function laneListSuffix(name) {
  if (name === "Q") {
    return " (quarantine, NON-GATING)";
  }
  if (name === "P") {
    return " (production-fidelity, GATING)";
  }
  return "";
}

/** Parse a Vitest-style one-based shard token (`i/n`). */
function parseShard(args) {
  const idx = args.indexOf("--shard");
  if (idx < 0) {
    return null;
  }
  const raw = args[idx + 1] ?? "";
  const match = /^(\d+)\/(\d+)$/.exec(raw);
  if (match == null) {
    throw new Error(`invalid --shard "${raw}" (expected one-based i/n, e.g. 1/8)`);
  }
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(total) || total < 1 || index < 1 || index > total) {
    throw new Error(`invalid --shard "${raw}" (require 1 <= i <= n)`);
  }
  return { index, total, label: `${index}/${total}` };
}

/** Deterministic round-robin file partition. Every file appears in exactly one shard. */
function selectShard(files, shard) {
  if (shard == null) {
    return files;
  }
  return files.filter((_file, index) => index % shard.total === shard.index - 1);
}

function main() {
  const args = process.argv.slice(2);
  const lanes = categorize();
  const laneArgIdx = args.indexOf("--lane");
  const only = laneArgIdx >= 0 ? args[laneArgIdx + 1]?.toUpperCase() : undefined;
  if (only != null && !lanes[only]) {
    // eslint-disable-next-line no-console
    console.error(`unknown lane "${only}" (expected A, B, C, P, or Q)`);
    process.exit(2);
  }
  let shard;
  try {
    shard = parseShard(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }

  if (args.includes("--list")) {
    const listedLanes = only == null ? Object.entries(lanes) : [[only, lanes[only]]];
    let listedTotal = 0;
    for (const [name, allFiles] of listedLanes) {
      const files = selectShard(allFiles, shard);
      listedTotal += files.length;
      // eslint-disable-next-line no-console
      console.log(
        `\n=== LANE ${name}${laneListSuffix(name)}${shard ? ` SHARD ${shard.label}` : ""} (${files.length} files) ===`,
      );
      for (const f of files) {
        // eslint-disable-next-line no-console
        console.log(`  ${f}`);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`\nTOTAL${shard ? ` SHARD ${shard.label}` : ""}: ${listedTotal} files`);
    return;
  }

  // Gating lanes = A, B, C, P (#897). Q (quarantine) is run non-gating (its result never changes the exit code).
  const gatingOrder = only ? [only] : ["A", "B", "C", "P"];
  const runQuarantine = !only || only === "Q";

  const results = [];
  for (const name of gatingOrder) {
    const files = selectShard(lanes[name], shard);
    if (shard != null) {
      console.log(`lane ${name} external-compute shard ${shard.label}: ${files.length}/${lanes[name].length} files`);
    }
    results.push(runLane(name, files));
  }

  // NON-GATING quarantine pass (pre-existing solo failures - see QUARANTINE). Reported LOUDLY but never
  // affects the gate exit code, so the gate reflects the SHIPPABLE surface, not a defect that predates it.
  let quarantine;
  if (runQuarantine && lanes.Q.length > 0 && only !== "A" && only !== "B" && only !== "C" && only !== "P") {
    // eslint-disable-next-line no-console
    console.log(`\n=== QUARANTINE (${lanes.Q.length} files, NON-GATING - pre-existing solo failures) ===`);
    for (const [name, reason] of QUARANTINE) {
      // eslint-disable-next-line no-console
      console.log(`  ! ${name}\n      ${reason}`);
    }
    quarantine = runLane("Q", lanes.Q);
  }

  // eslint-disable-next-line no-console
  console.log("\n=========================== CO-OP GATE SUMMARY ===========================");
  let allOk = true;
  for (const r of results) {
    allOk = allOk && r.ok;
    // eslint-disable-next-line no-console
    console.log(`  LANE ${r.name}: ${r.summary.padEnd(16)} ${String(r.files).padStart(3)} files  ${fmtMs(r.ms)}`);
  }
  if (quarantine != null) {
    // eslint-disable-next-line no-console
    console.log(
      `  QUARANTINE: ${`${quarantine.summary} [non-gating]`.padEnd(16)} ${String(quarantine.files).padStart(3)} files  ${fmtMs(quarantine.ms)}`,
    );
  }
  const total = results.reduce((n, r) => n + r.ms, 0) + (quarantine?.ms ?? 0);
  // eslint-disable-next-line no-console
  console.log("  ------------------------------------------------------------------------");
  // eslint-disable-next-line no-console
  console.log(`  ${allOk ? "ALL GATING LANES GREEN" : "GATE RED"}  total ${fmtMs(total)}`);
  process.exit(allOk ? 0 : 1);
}

main();
