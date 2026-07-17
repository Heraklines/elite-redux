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
//   - Lane P (PRODUCTION-FIDELITY, #897/T2): the bounded soak plus every tracked dedicated public-UI
//     transition journey present at this SHA (the pre-integration branch contains one; P33 contains two),
//     with SOAK_FIDELITY=production - NO harness heals, guest commands sourced from the guest's OWN scene - so
//     it catches the "guest replay drifted" divergence class lane C structurally cannot. It is GATING: the
//     gate test does NOT swallow a hard LOCKSTEP/NO-PARK/TEARDOWN breach (unlike the non-gating evidence test
//     coop-soak-fidelity.test.ts), so any hard-invariant failure = nonzero exit = GATE RED. Bounded to
//     PROD_FIDELITY_GATE_WAVES waves so the gate stays wall-clock-bounded (the long god soak stays nightly).
//   - Lane S (Showdown): every tracked Showdown test. Versus rides the same authority transport and cannot
//     remain outside the deploy gate merely because its files live beside, rather than under, coop/.
//   - Lane T (topology/triples): the format model plus every tracked ER triple/probe/repro test, including
//     the 3v2 faint/switch regressions and the six-battler presentation offsets.
//
// USAGE:
//   node scripts/run-coop-gate.mjs                 # run all lanes, aggregate (exit 0 = all green)
//   node scripts/run-coop-gate.mjs --lane A        # run one lane (A|B|C|P|S|T)
//   node scripts/run-coop-gate.mjs --lane B --shard 1/8  # one deterministic external-compute shard
//   node scripts/run-coop-gate.mjs --list          # print the calibrated lane composition + counts, run nothing
//   pnpm coop:gate                                 # the package.json alias
//
// EXIT: 0 iff EVERY gating lane (A,B,C,P,S,T) passed. Per-lane summaries (file count / pass-fail / duration) print at the end.
// =============================================================================

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const COOP_DIR = join(REPO_ROOT, "test", "tests", "elite-redux", "coop");
const COOP_DIR_REL = "test/tests/elite-redux/coop";

/**
 * LANE P (#897/T2): GATING production-fidelity journeys. The nightly soak (lane C) heals the guest through
 * harness-only seams a live client never takes, so it CANNOT catch the "guest replay drifted" class the
 * prod path still hits; and the standing prod-fidelity *evidence* test (coop-soak-fidelity.test.ts) is
 * DELIBERATELY non-gating - it swallows a hard LOCKSTEP/NO-PARK/TEARDOWN breach into a green pass as long as
 * wave 1 ran (the reviewer's finding: "a hard invariant failure after wave 1 still passes"). LANE P closes
 * that hole: it runs a SEPARATE, BOUNDED prod-fidelity test (coop-soak-fidelity-gate.test.ts) that does NOT
 * catch SoakInvariantError, so any hard-invariant breach = a failed test = nonzero exit = GATE RED. It runs
 * every tracked file in the explicit set below (routed here, NOT into lane C) with
 * SOAK_FIDELITY=production + a bounded wave count. Matrix generation caps P to discovered inventory.
 */
const PROD_FIDELITY_GATE_FILES = new Set([
  "coop-soak-fidelity-gate.test.ts",
  // Dedicated P33 transition journeys. The standing P2 runner allocation is capped to discovered
  // inventory and deterministically balances these files without a workflow edit.
  "coop-transition-t2-biome.test.ts",
  "coop-transition-t2-mystery.test.ts",
]);
const PROD_FIDELITY_GATE_WAVES = 12;

/** Everyday external-runner target. Counts are capped to discovered inventory, so no shard is vacuous. */
export const COOP_CI_TARGET_SHARDS = Object.freeze({ A: 1, B: 13, C: 5, P: 2, S: 8, T: 4 });
const HEAVY_LANES = new Set(["B", "C", "P", "S", "T"]);
const TIMING_MANIFEST_PATH = resolve(__dirname, "coop-gate-timings.json");
const TIMING_MANIFEST = JSON.parse(readFileSync(TIMING_MANIFEST_PATH, "utf8"));

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

/** Deterministically list tracked tests for additional co-op-owned formats/surfaces. */
function trackedTests(...pathspecs) {
  const res = spawnSync(process.platform === "win32" ? "git.exe" : "git", ["ls-files", ...pathspecs], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (res.status !== 0 || typeof res.stdout !== "string") {
    throw new Error(`git ls-files failed for ${pathspecs.join(", ")}`);
  }
  return [...new Set(res.stdout.split(/\r?\n/).filter(Boolean))].sort();
}

/**
 * Categorize every TRACKED coop test file into lane A (engine-free), B (heavy engine), C (soak),
 * P (gating production-fidelity soak, #897), S (Showdown authoritative mode),
 * T (triple/topology), or Q (quarantine).
 */
export function categorize() {
  const tracked = trackedTestBasenames();
  const nestedCoop = trackedTests("test/tests/elite-redux/coop/**/*.test.ts");
  if (nestedCoop.length > 0) {
    throw new Error(
      `nested co-op tests require an explicit lane classification before they can ship:\n${nestedCoop.join("\n")}`,
    );
  }
  const files = readdirSync(COOP_DIR)
    .filter(f => f.endsWith(".test.ts"))
    .filter(f => tracked == null || tracked.has(f))
    .sort();
  const lanes = { A: [], B: [], C: [], P: [], S: [], T: [], Q: [] };
  for (const f of files) {
    const rel = `${COOP_DIR_REL}/${f}`;
    if (QUARANTINE.has(f)) {
      // Pre-existing solo failure - run non-gating (see QUARANTINE).
      lanes.Q.push(rel);
    } else if (PROD_FIDELITY_GATE_FILES.has(f)) {
      // #897/T2: GATING production-fidelity journeys - their OWN lane with SOAK_FIDELITY=production.
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
  lanes.S.push(...trackedTests("test/tests/elite-redux/showdown/*.test.ts"));
  lanes.T.push(
    ...trackedTests(
      "test/data/battle-format.test.ts",
      "test/tests/elite-redux/*triple*.test.ts",
      "test/tests/elite-redux/**/*triple*.test.ts",
      "test/tools/*triple*.test.ts",
    ),
  );
  return lanes;
}

/**
 * Per-lane Vitest module isolation. Heavy lanes use isolated fork workers under one Vitest controller so
 * files stay isolated while Vite transformation/setup is cached once per shard. Lane A is deliberately `--no-isolate`:
 * those files intentionally CHAIN a real `globalScene` across the dir (capture prevGlobalScene -> restore),
 * so isolating them would strand a stub with no real scene to chain; Lane A is already reliably green as-is.
 */
const LANE_ISOLATE = { A: false, B: true, C: true, P: true, S: true, T: true, Q: false };

/**
 * Files proven by aggregate canary to retain process-global Phaser state despite Vitest module isolation.
 * Keep only measured exceptions here: the shard still uses one fast controller for every compatible file.
 */
const FRESH_PROCESS_FILES = new Set([
  `${COOP_DIR_REL}/coop-duo-multiwave.test.ts`,
  `${COOP_DIR_REL}/coop-duo-reward-subpickers.test.ts`,
]);

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
  S: {},
  T: {},
  Q: {},
};

/**
 * Run one shard through one Vitest controller. `--pool=forks --no-file-parallelism --isolate` gives heavy
 * files isolated sequential workers while retaining the controller's transformation cache. This avoids the
 * measured ~20-25s repeated startup per file and keeps a complete multi-file blob report.
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
  const groupedFiles = files.filter(file => !FRESH_PROCESS_FILES.has(file));
  const freshFiles = files.filter(file => FRESH_PROCESS_FILES.has(file));
  const extraEnv = Object.entries(LANE_ENV[name] ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  // eslint-disable-next-line no-console
  console.log(
    `\n=== LANE ${name}: ${files.length} files (one controller, sequential fork pool, ${isolate}${extraEnv ? `, ${extraEnv}` : ""}) ===`,
  );
  const started = Date.now();
  let invocation = 0;
  const runFiles = selected => {
    if (selected.length === 0) {
      return true;
    }
    invocation++;
    const reportArg = process.env.GITHUB_ACTIONS ? ` --outputFile=.vitest-reports/blob-${name}-${invocation}.json` : "";
    const cmd = `npx vitest run ${selected.join(" ")} --pool=forks --no-file-parallelism ${isolate}${reportArg}`;
    return (
      spawnSync(cmd, {
        cwd: REPO_ROOT,
        env: { ...process.env, ER_SCENARIO: "1", ...(LANE_ENV[name] ?? {}) },
        stdio: ["ignore", "inherit", "inherit"],
        encoding: "utf8",
        shell: true,
      }).status === 0
    );
  };
  let ok = runFiles(groupedFiles);
  for (const file of freshFiles) {
    // eslint-disable-next-line no-console
    console.log(`\n--- fresh-process exception: ${file} ---`);
    ok = runFiles([file]) && ok;
  }
  const ms = Date.now() - started;
  return { name, files: files.length, ok, ms, summary: ok ? "PASS" : "FAIL" };
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

function timingWeight(lane, file) {
  const configured = TIMING_MANIFEST.lanes?.[lane]?.files?.[file];
  const p90 = configured?.p90Seconds;
  const historical = configured?.historicalSeconds;
  if (Number.isFinite(p90) && p90 > 0) {
    return { seconds: p90, source: "p90" };
  }
  if (Number.isFinite(historical) && historical > 0) {
    return { seconds: historical, source: "historical" };
  }
  // Equal fallback weights are intentionally not fabricated timing data. LPT then distributes by file count
  // with a lexical tie-break, producing a stable assignment until real observations are committed.
  return { seconds: TIMING_MANIFEST.fallbackWeight ?? 1, source: "fallback" };
}

/** Deterministic LPT assignment for every heavyweight lane, using p90 -> historical -> equal fallback. */
export function weightedShardBins(files, total, lane) {
  if (!Number.isSafeInteger(total) || total < 1 || total > Math.max(1, files.length)) {
    throw new Error(`invalid ${lane} shard total ${total} for ${files.length} files`);
  }
  const bins = Array.from({ length: total }, (_, index) => ({ index: index + 1, seconds: 0, files: [] }));
  const weighted = files
    .map(file => ({ file, ...timingWeight(lane, file) }))
    .sort((a, b) => b.seconds - a.seconds || a.file.localeCompare(b.file));
  for (const item of weighted) {
    const target = bins.reduce(lightestBin);
    target.files.push(item.file);
    target.seconds += item.seconds;
  }
  for (const bin of bins) {
    bin.files.sort();
  }
  return bins;
}

function lightestBin(best, candidate) {
  if (candidate.seconds !== best.seconds) {
    return candidate.seconds < best.seconds ? candidate : best;
  }
  if (candidate.files.length !== best.files.length) {
    return candidate.files.length < best.files.length ? candidate : best;
  }
  return candidate.index < best.index ? candidate : best;
}

/** Deterministic partition. Every file appears in exactly one shard. */
export function selectShard(files, shard, lane) {
  if (shard == null) {
    return files;
  }
  if (HEAVY_LANES.has(lane)) {
    return weightedShardBins(files, shard.total, lane)[shard.index - 1].files;
  }
  return files.filter((_file, index) => index % shard.total === shard.index - 1);
}

function actualShardTotal(lane, files) {
  const target = COOP_CI_TARGET_SHARDS[lane] ?? 1;
  // A required empty lane still gets one runner, whose existing fail-closed empty-lane check turns it red.
  return files.length === 0 ? 1 : Math.min(target, files.length);
}

export function createCiMatrix(lanes = categorize()) {
  const include = [];
  for (const lane of Object.keys(COOP_CI_TARGET_SHARDS)) {
    const total = actualShardTotal(lane, lanes[lane]);
    for (let shard = 1; shard <= total; shard++) {
      include.push({ lane, shard, total });
    }
  }
  verifyMatrixCoverage(lanes, include);
  return { include };
}

export function verifyMatrixCoverage(lanes, include) {
  for (const lane of Object.keys(COOP_CI_TARGET_SHARDS)) {
    const expected = [...lanes[lane]].sort();
    const seen = include
      .filter(entry => entry.lane === lane)
      .flatMap(entry => selectShard(lanes[lane], { index: entry.shard, total: entry.total }, lane))
      .sort();
    if (expected.length !== seen.length || expected.some((file, index) => file !== seen[index])) {
      throw new Error(`CI matrix does not assign every Lane ${lane} file exactly once`);
    }
    if (new Set(seen).size !== seen.length) {
      throw new Error(`CI matrix duplicates at least one Lane ${lane} file`);
    }
  }
}

function stableRank(seed, value) {
  return createHash("sha256").update(`${seed}\0${value}`).digest("hex");
}

function gitLines(args) {
  const result = spawnSync(process.platform === "win32" ? "git.exe" : "git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr ?? "unknown error"}`);
  }
  return result.stdout
    .split(/\r?\n/)
    .map(value => value.trim().replaceAll("\\", "/"))
    .filter(Boolean);
}

const FOCUSED_IMPACT_RULES = [
  { matches: file => file.includes("/showdown/") || file.includes("showdown-"), lanes: ["S"] },
  { matches: file => /triple|battle-format/.test(file), lanes: ["T"] },
  { matches: file => /(?:^|[-_/])soak/.test(file), lanes: ["C"] },
  { matches: file => /production-fidelity|fidelity-gate|transition-t2/.test(file), lanes: ["P"] },
  {
    // These modules are shared by co-op, Showdown, long campaigns, and multi-seat presentation. A narrow
    // A/B-only mapping would miss exactly the cross-surface regressions the expanded full gate added S/T for.
    matches: file =>
      /^src\/data\/elite-redux\/coop\/coop-(?:authoritative|battle-engine|battle-stream|field|presentation|runtime|session-controller|transport|webrtc)/.test(
        file,
      ),
    lanes: ["C", "S", "T"],
  },
  {
    matches: file =>
      file.startsWith("src/field/")
      || file === "src/data/battle-format.ts"
      || /^src\/phases\/(?:battle|command|encounter|summon|switch|turn)/.test(file),
    lanes: ["B", "T"],
  },
  {
    matches: file => /(?:mystery|(?:^|[-_/])me[-_/]|biome|crossroads|colosseum)/i.test(file),
    lanes: ["C", "P"],
  },
  {
    matches: file =>
      file.startsWith("src/") || file.startsWith("test/tests/elite-redux/coop/") || file.startsWith("test/tools/coop-"),
    lanes: ["A", "B", "P"],
  },
  {
    matches: file => /^(?:\.github|scripts|package\.json|pnpm-lock\.yaml|vite|vitest|tsconfig)/.test(file),
    lanes: Object.keys(COOP_CI_TARGET_SHARDS),
  },
];
const FOCUSED_LANE_PRIORITY = Object.freeze({ A: 0, B: 1, C: 2, S: 3, T: 4, P: 5 });

function impactLanes(changedFiles) {
  const lanes = new Set();
  for (const file of changedFiles) {
    for (const rule of FOCUSED_IMPACT_RULES) {
      if (rule.matches(file)) {
        for (const lane of rule.lanes) {
          lanes.add(lane);
        }
      }
    }
  }
  if (lanes.size === 0) {
    lanes.add("B");
  }
  return lanes;
}

/** Select 1-5 directly affected or deterministic representative shards against an explicit integration base. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: bounded planner keeps selection/proof in one auditable function.
export function createFocusedMatrix(base, maxShards = 5, lanes = categorize(), priorityBase = null) {
  if (!Number.isSafeInteger(maxShards) || maxShards < 1 || maxShards > 5) {
    throw new Error("focused max-shards must be between 1 and 5");
  }
  // The workflow intentionally uses shallow checkouts. Comparing the two explicit endpoints does not require
  // their merge base to be present locally, unlike three-dot diff, and still answers "what differs from the
  // exact integration SHA fetched above?".
  const changedFiles = gitLines(["diff", "--name-only", "--diff-filter=ACMR", base, "HEAD"]);
  if (changedFiles.length === 0) {
    throw new Error(`focused planner resolved zero changed files for ${base}..HEAD`);
  }
  const priorityChangedFiles =
    priorityBase == null ? [] : gitLines(["diff", "--name-only", "--diff-filter=ACMR", priorityBase, "HEAD"]);
  const full = createCiMatrix(lanes).include;
  const assignment = new Map();
  for (const entry of full) {
    for (const file of selectShard(lanes[entry.lane], { index: entry.shard, total: entry.total }, entry.lane)) {
      assignment.set(file, entry);
    }
  }
  const direct = new Map();
  for (const file of changedFiles) {
    const entry = assignment.get(file);
    if (entry != null) {
      direct.set(`${entry.lane}:${entry.shard}/${entry.total}`, entry);
    }
  }
  const priorityDirectKeys = new Set();
  for (const file of priorityChangedFiles) {
    const entry = assignment.get(file);
    if (entry != null) {
      priorityDirectKeys.add(`${entry.lane}:${entry.shard}/${entry.total}`);
    }
  }
  const impacted = impactLanes(changedFiles);
  const seed = `${base}\0${changedFiles.join("\0")}`;
  const directLanes = new Set([...direct.values()].map(entry => entry.lane));
  const representatives = [];
  for (const lane of [...impacted].sort()) {
    if (directLanes.has(lane)) {
      continue;
    }
    const candidates = full.filter(entry => entry.lane === lane);
    if (candidates.length === 0) {
      continue;
    }
    representatives.push(
      [...candidates].sort((left, right) =>
        stableRank(seed, `${left.lane}:${left.shard}/${left.total}`).localeCompare(
          stableRank(seed, `${right.lane}:${right.shard}/${right.total}`),
        ),
      )[0],
    );
  }
  const chosen = new Map(direct);
  for (const entry of representatives) {
    chosen.set(`${entry.lane}:${entry.shard}/${entry.total}`, entry);
  }
  if (chosen.size === 0) {
    const fallback = [...full].sort((left, right) =>
      stableRank(seed, JSON.stringify(left)).localeCompare(stableRank(seed, JSON.stringify(right))),
    )[0];
    chosen.set(`${fallback.lane}:${fallback.shard}/${fallback.total}`, fallback);
  }
  const directKeys = new Set(direct.keys());
  const include = [...chosen.entries()]
    .sort(([leftKey], [rightKey]) => {
      const priorityDelta = Number(priorityDirectKeys.has(rightKey)) - Number(priorityDirectKeys.has(leftKey));
      const directDelta = Number(directKeys.has(rightKey)) - Number(directKeys.has(leftKey));
      const leftLane = chosen.get(leftKey).lane;
      const rightLane = chosen.get(rightKey).lane;
      const laneDelta = FOCUSED_LANE_PRIORITY[leftLane] - FOCUSED_LANE_PRIORITY[rightLane];
      return (
        priorityDelta || directDelta || laneDelta || stableRank(seed, leftKey).localeCompare(stableRank(seed, rightKey))
      );
    })
    .slice(0, maxShards)
    .map(([, entry]) => entry);
  return {
    include,
    base,
    priorityBase,
    changedFiles,
    priorityChangedFiles,
    impactedLanes: [...impacted].sort(),
    candidateCount: chosen.size,
  };
}

function argValue(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function emitPlannerResult(matrix, detail) {
  const matrixJson = JSON.stringify({ include: matrix.include });
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    writeFileSync(outputPath, `matrix=${matrixJson}\n`, { flag: "a" });
  } else {
    process.stdout.write(`${matrixJson}\n`);
  }
  const planPath = process.env.COOP_CI_PLAN_MANIFEST;
  if (planPath) {
    writeFileSync(
      resolve(REPO_ROOT, planPath),
      `${JSON.stringify(
        {
          version: 1,
          sha: process.env.GITHUB_SHA ?? gitLines(["rev-parse", "HEAD"])[0],
          timingManifestSha256: createHash("sha256").update(readFileSync(TIMING_MANIFEST_PATH)).digest("hex"),
          ...detail,
          matrix: { include: matrix.include },
        },
        null,
        2,
      )}\n`,
    );
  }
}

function writeGateManifest(path, data) {
  if (!path) {
    return;
  }
  writeFileSync(resolve(REPO_ROOT, path), `${JSON.stringify(data, null, 2)}\n`);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: top-level CLI dispatch and summary orchestration.
function main() {
  const args = process.argv.slice(2);
  const lanes = categorize();
  if (args.includes("--ci-matrix")) {
    const matrix = createCiMatrix(lanes);
    emitPlannerResult(matrix, {
      kind: "full",
      targetShards: COOP_CI_TARGET_SHARDS,
      inventory: Object.fromEntries(Object.entries(lanes).map(([lane, files]) => [lane, files.length])),
    });
    return;
  }
  if (args.includes("--focused-matrix")) {
    const base = argValue(args, "--base");
    if (!base) {
      throw new Error("--focused-matrix requires --base <integration-sha>");
    }
    const maxShards = Number(argValue(args, "--max-shards") ?? 5);
    const priorityBase = argValue(args, "--priority-base");
    const focused = createFocusedMatrix(base, maxShards, lanes, priorityBase);
    emitPlannerResult(focused, { kind: "focused", ...focused });
    return;
  }
  const laneArgIdx = args.indexOf("--lane");
  const only = laneArgIdx >= 0 ? args[laneArgIdx + 1]?.toUpperCase() : undefined;
  if (only != null && !lanes[only]) {
    // eslint-disable-next-line no-console
    console.error(`unknown lane "${only}" (expected A, B, C, P, S, T, or Q)`);
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
      const files = selectShard(allFiles, shard, name);
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

  // All classified product surfaces gate. Q (quarantine) is run non-gating and never changes the exit code.
  const gatingOrder = only === "Q" ? [] : only ? [only] : ["A", "B", "C", "P", "S", "T"];
  const runQuarantine = !only || only === "Q";

  const results = [];
  const manifestPath = process.env.COOP_GATE_MANIFEST;
  const manifest = {
    version: 1,
    sha: process.env.GITHUB_SHA ?? gitLines(["rev-parse", "HEAD"])[0],
    startedAt: new Date().toISOString(),
    state: "started",
    timingManifestSha256: createHash("sha256").update(readFileSync(TIMING_MANIFEST_PATH)).digest("hex"),
    assignments: [],
  };
  for (const name of gatingOrder) {
    const files = selectShard(lanes[name], shard, name);
    manifest.assignments.push({
      lane: name,
      shard: shard?.index ?? 1,
      total: shard?.total ?? 1,
      files: files.map(file => ({ file, ...timingWeight(name, file) })),
    });
  }
  writeGateManifest(manifestPath, manifest);
  for (const name of gatingOrder) {
    const files = selectShard(lanes[name], shard, name);
    if (shard != null) {
      console.log(`lane ${name} external-compute shard ${shard.label}: ${files.length}/${lanes[name].length} files`);
    }
    results.push(runLane(name, files));
  }

  // NON-GATING quarantine pass (pre-existing solo failures - see QUARANTINE). Reported LOUDLY but never
  // affects the gate exit code, so the gate reflects the SHIPPABLE surface, not a defect that predates it.
  let quarantine;
  if (runQuarantine && lanes.Q.length > 0) {
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
  manifest.state = allOk ? "passed" : "failed";
  manifest.completedAt = new Date().toISOString();
  manifest.durationMs = total;
  manifest.results = results.map(result => ({
    lane: result.name,
    files: result.files,
    status: result.ok ? "passed" : "failed",
    durationMs: result.ms,
  }));
  writeGateManifest(manifestPath, manifest);
  process.exit(allOk ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
