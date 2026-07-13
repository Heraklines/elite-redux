/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Protocol-33 mutation-assurance runner.
 *
 * A mutation is successful only when:
 *   1. its behavioral victim is green against the unmodified checkout;
 *   2. one exact production protection is changed in the isolated checkout;
 *   3. the same victim becomes red; and
 *   4. Vitest reports the mutation-specific assertion marker (not a compiler/setup failure).
 *
 * The runner always restores changed source in a finally block. CI nevertheless runs each shard in its
 * own disposable checkout, so sibling mutations and ordinary gate shards never share mutable source.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const VICTIM_FILE = "test/tests/elite-redux/coop/coop-p33-mutation-victims.test.ts";
const DEFAULT_SHARDS = 4;
const DEFAULT_OUTPUT_DIR = ".coop-mutation-evidence";

const MUTATIONS = Object.freeze([
  {
    id: "p33-full-address-wave",
    protection: "full-authority-address",
    source: "src/data/elite-redux/coop/coop-battle-stream.ts",
    before: "return `${address.epoch}:${address.wave}:${address.turn}:${address.revision}`;",
    after: "return `${address.epoch}:${address.turn}:${address.revision}`;",
    expectedReplacements: 1,
    victimTitle: "[P33-MUTATION full-address] isolates equal revisions across the wave component",
    expectedReason: "P33_MUTATION_CAUGHT[full-address]: epoch/wave/turn/revision must identify independent authority",
    weight: 2,
  },
  {
    id: "p33-retain-until-continuation",
    protection: "retained-until-continuationReady",
    source: "src/data/elite-redux/coop/coop-battle-stream.ts",
    before: 'if (stage !== "continuationReady") {',
    after: 'if (stage !== "materialApplied") {',
    expectedReplacements: 2,
    victimTitle: "[P33-MUTATION retained-continuation] retains replacement authority after material ACK",
    expectedReason: "P33_MUTATION_CAUGHT[retained-continuation]: material ACK must not release retained authority",
    weight: 2,
  },
  {
    id: "p33-staged-ack-order",
    protection: "staged-ack-order",
    source: "src/data/elite-redux/coop/coop-battle-stream.ts",
    before: 'return stage === "materialApplied" ? "advance" : "invalid";',
    after: 'return "advance";',
    expectedReplacements: 1,
    victimTitle: "[P33-MUTATION staged-ack-order] rejects continuationReady as the first ACK stage",
    expectedReason: "P33_MUTATION_CAUGHT[staged-ack-order]: continuationReady cannot skip material and presentation",
    weight: 2,
  },
  {
    id: "p33-atomic-control-rollback",
    protection: "atomic-rollback",
    source: "src/data/elite-redux/coop/coop-durability.ts",
    before: "this.ledger.restoreExactForTransaction(marks);",
    after: "void marks;",
    expectedReplacements: 1,
    victimTitle: "[P33-MUTATION atomic-rollback] restores the exact pre-transaction control ledger",
    expectedReason: "P33_MUTATION_CAUGHT[atomic-rollback]: failed control commit must restore the exact prior ledger",
    weight: 1,
  },
  {
    id: "p33-ui-registry-authority",
    protection: "ui-registry-wiring",
    source: "src/data/elite-redux/coop/coop-ui-registry.ts",
    before: '[UiMode.MODIFIER_SELECT]: "mirrored",',
    after: '[UiMode.MODIFIER_SELECT]: "local-only",',
    expectedReplacements: 1,
    victimTitle: "[P33-MUTATION ui-registry] keeps authoritative reward UI registered as mirrored",
    expectedReason: "P33_MUTATION_CAUGHT[ui-registry]: authoritative reward UI must remain mirrored",
    weight: 1,
  },
  {
    id: "p33-renderer-seat-postcondition",
    protection: "renderer-postcondition",
    source: "src/data/elite-redux/coop/coop-presentation.ts",
    before: "if (seats == null) {\n    return false;\n  }",
    after: "if (seats == null) {\n    return true;\n  }",
    expectedReplacements: 1,
    victimTitle: "[P33-MUTATION renderer-postcondition] refuses authority whose required seat cannot be rendered",
    expectedReason:
      "P33_MUTATION_CAUGHT[renderer-postcondition]: a missing required seat cannot become presentation-ready",
    weight: 1,
  },
]);

const REQUIRED_PROTECTIONS = Object.freeze([
  "full-authority-address",
  "retained-until-continuationReady",
  "staged-ack-order",
  "atomic-rollback",
  "ui-registry-wiring",
  "renderer-postcondition",
]);

function parseArgs(argv) {
  const options = {
    check: false,
    json: false,
    list: false,
    mutation: null,
    outputDir: DEFAULT_OUTPUT_DIR,
    shard: null,
  };
  const args = [...argv];
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--check") {
      options.check = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--list") {
      options.list = true;
    } else if (arg === "--mutation") {
      options.mutation = args.shift() ?? null;
    } else if (arg === "--output-dir") {
      options.outputDir = args.shift() ?? "";
    } else if (arg === "--shard") {
      options.shard = args.shift() ?? null;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (options.mutation != null && options.shard != null) {
    throw new Error("--mutation and --shard are mutually exclusive");
  }
  if (!options.outputDir) {
    throw new Error("--output-dir requires a non-empty path");
  }
  return options;
}

function countOccurrences(haystack, needle) {
  if (needle.length === 0) {
    throw new Error("mutation anchor cannot be empty");
  }
  let count = 0;
  let offset = 0;
  while ((offset = haystack.indexOf(needle, offset)) !== -1) {
    count++;
    offset += needle.length;
  }
  return count;
}

function sourceAnchor(source, anchor) {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  return anchor.replaceAll("\n", eol);
}

function mutationAssignments(total) {
  if (!Number.isSafeInteger(total) || total < 1 || total > MUTATIONS.length) {
    throw new Error(`shard total must be 1..${MUTATIONS.length}; got ${total}`);
  }
  const bins = Array.from({ length: total }, (_, index) => ({ index, load: 0, mutations: [] }));
  const sorted = [...MUTATIONS].sort((left, right) => right.weight - left.weight || left.id.localeCompare(right.id));
  for (const mutation of sorted) {
    bins.sort((left, right) => left.load - right.load || left.index - right.index);
    bins[0].mutations.push(mutation);
    bins[0].load += mutation.weight;
  }
  bins.sort((left, right) => left.index - right.index);
  for (const bin of bins) {
    bin.mutations.sort((left, right) => left.id.localeCompare(right.id));
  }
  const flattened = bins.flatMap(bin => bin.mutations.map(mutation => mutation.id));
  if (flattened.length !== MUTATIONS.length || new Set(flattened).size !== MUTATIONS.length) {
    throw new Error("mutation shard assignment is not exactly-once");
  }
  for (const mutation of MUTATIONS) {
    if (!flattened.includes(mutation.id)) {
      throw new Error(`mutation missing from assignment: ${mutation.id}`);
    }
  }
  return bins;
}

function parseShard(spec) {
  const match = /^(\d+)\/(\d+)$/.exec(spec ?? "");
  if (match == null) {
    throw new Error(`--shard must use index/total; got ${spec ?? "missing"}`);
  }
  const index = Number(match[1]);
  const total = Number(match[2]);
  const assignments = mutationAssignments(total);
  if (!Number.isSafeInteger(index) || index < 1 || index > total) {
    throw new Error(`shard index must be 1..${total}; got ${index}`);
  }
  return { index, total, mutations: assignments[index - 1].mutations };
}

function verifyInventory() {
  const ids = MUTATIONS.map(mutation => mutation.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("mutation IDs are not unique");
  }
  const protections = MUTATIONS.map(mutation => mutation.protection).sort();
  const expectedProtections = [...REQUIRED_PROTECTIONS].sort();
  if (JSON.stringify(protections) !== JSON.stringify(expectedProtections)) {
    throw new Error(
      `mutation protections are incomplete: got=${protections.join(",")} expected=${expectedProtections.join(",")}`,
    );
  }
  const victimSource = readFileSync(resolve(REPO_ROOT, VICTIM_FILE), "utf8");
  for (const mutation of MUTATIONS) {
    const sourcePath = resolve(REPO_ROOT, mutation.source);
    const source = readFileSync(sourcePath, "utf8");
    const before = sourceAnchor(source, mutation.before);
    const after = sourceAnchor(source, mutation.after);
    const actual = countOccurrences(source, before);
    if (actual !== mutation.expectedReplacements) {
      throw new Error(
        `${mutation.id} expected ${mutation.expectedReplacements} exact source anchor(s) in ${mutation.source}; got ${actual}`,
      );
    }
    if (countOccurrences(source, after) !== 0) {
      throw new Error(`${mutation.id} mutant is already present in ${mutation.source}`);
    }
    if (!victimSource.includes(mutation.victimTitle) || !victimSource.includes(mutation.expectedReason)) {
      throw new Error(`${mutation.id} victim title/reason is missing from ${VICTIM_FILE}`);
    }
  }
  mutationAssignments(DEFAULT_SHARDS);
}

function listInventory(json) {
  verifyInventory();
  const assignments = mutationAssignments(DEFAULT_SHARDS);
  if (json) {
    process.stdout.write(
      `${JSON.stringify({
        include: assignments.map(bin => ({
          shard: bin.index + 1,
          total: DEFAULT_SHARDS,
          mutations: bin.mutations.map(mutation => mutation.id).join(","),
          weight: bin.load,
        })),
      })}\n`,
    );
    return;
  }
  console.log(`P33 mutation inventory: ${MUTATIONS.length} protections, ${DEFAULT_SHARDS} external shards`);
  for (const bin of assignments) {
    console.log(
      `shard ${bin.index + 1}/${DEFAULT_SHARDS} weight=${bin.load}: ${bin.mutations.map(m => m.id).join(", ")}`,
    );
  }
  for (const mutation of MUTATIONS) {
    console.log(`${mutation.id}\t${mutation.protection}\t${mutation.source}\t${mutation.victimTitle}`);
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function runVictims(mutations, logPath) {
  const pattern = mutations.map(mutation => escapeRegex(mutation.victimTitle)).join("|");
  const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const args = [
    "exec",
    "vitest",
    "run",
    VICTIM_FILE,
    "--pool=forks",
    "--isolate",
    "--no-file-parallelism",
    "--reporter=verbose",
    "--testNamePattern",
    pattern,
  ];
  const startedAt = Date.now();
  const result = spawnSync(executable, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NODE_OPTIONS: process.env.NODE_OPTIONS || "--max-old-space-size=4096",
      NO_COLOR: "1",
    },
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  writeFileSync(logPath, output);
  return {
    command: [executable, ...args],
    durationMs: Date.now() - startedAt,
    output,
    outputSha256: sha256(output),
    signal: result.signal ?? null,
    status: result.status,
  };
}

function gitDiff(source) {
  const result = spawnSync(process.platform === "win32" ? "git.exe" : "git", ["diff", "--no-ext-diff", "--", source], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git diff failed for ${source}: ${result.stderr ?? ""}`);
  }
  return result.stdout ?? "";
}

function patchContainsMutation(patch, replacement) {
  return replacement
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .every(line => patch.includes(line));
}

function applyMutation(mutation) {
  const sourcePath = resolve(REPO_ROOT, mutation.source);
  const original = readFileSync(sourcePath, "utf8");
  const before = sourceAnchor(original, mutation.before);
  const after = sourceAnchor(original, mutation.after);
  const actual = countOccurrences(original, before);
  if (actual !== mutation.expectedReplacements) {
    throw new Error(`${mutation.id} expected ${mutation.expectedReplacements} source replacement(s), found ${actual}`);
  }
  const mutated = original.replaceAll(before, after);
  writeFileSync(sourcePath, mutated);
  return { original, sourcePath, beforeSha256: sha256(original), afterSha256: sha256(mutated) };
}

function writeSummary(outputDir, summary) {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
}

function executeShard(selected, outputDir, shardLabel) {
  verifyInventory();
  mkdirSync(outputDir, { recursive: true });
  const summary = {
    version: 1,
    sha: process.env.GITHUB_SHA ?? null,
    shard: shardLabel,
    victimFile: VICTIM_FILE,
    selected: selected.map(mutation => mutation.id),
    baseline: null,
    mutations: [],
    success: false,
  };
  const baselinePath = resolve(outputDir, "baseline.log");
  const baseline = runVictims(selected, baselinePath);
  const baselineOutput = baseline.output;
  summary.baseline = {
    command: baseline.command,
    durationMs: baseline.durationMs,
    outputSha256: baseline.outputSha256,
    signal: baseline.signal,
    status: baseline.status,
  };
  const missingBaselineVictims = selected
    .filter(mutation => !baselineOutput.includes(mutation.victimTitle))
    .map(mutation => mutation.id);
  if (baseline.status !== 0 || baseline.signal != null || missingBaselineVictims.length > 0) {
    summary.failure =
      `unmodified victim baseline was not green/selected (status=${String(baseline.status)} `
      + `signal=${String(baseline.signal)} missing=${missingBaselineVictims.join(",") || "none"})`;
    writeSummary(outputDir, summary);
    console.error(summary.failure);
    return false;
  }

  let success = true;
  for (const mutation of selected) {
    const logPath = resolve(outputDir, `${mutation.id}.log`);
    const patchPath = resolve(outputDir, `${mutation.id}.patch`);
    let applied = null;
    try {
      applied = applyMutation(mutation);
      const patch = gitDiff(mutation.source);
      writeFileSync(patchPath, patch);
      if (!patchContainsMutation(patch, mutation.after)) {
        throw new Error(`${mutation.id} patch does not contain its mutant replacement`);
      }
      const result = runVictims([mutation], logPath);
      const output = result.output;
      const expectedTestFailure = /Tests\s+1 failed/.test(output);
      const caught =
        result.status != null
        && result.status !== 0
        && result.signal == null
        && output.includes(mutation.victimTitle)
        && output.includes(mutation.expectedReason)
        && expectedTestFailure;
      summary.mutations.push({
        id: mutation.id,
        protection: mutation.protection,
        source: mutation.source,
        sourceBeforeSha256: applied.beforeSha256,
        sourceAfterSha256: applied.afterSha256,
        victimTitle: mutation.victimTitle,
        expectedReason: mutation.expectedReason,
        command: result.command,
        durationMs: result.durationMs,
        outputSha256: result.outputSha256,
        status: result.status,
        signal: result.signal,
        expectedReasonObserved: output.includes(mutation.expectedReason),
        targetedTestFailed: expectedTestFailure,
        caught,
      });
      if (caught) {
        console.log(`${mutation.id}: caught by ${mutation.victimTitle} in ${result.durationMs}ms`);
      } else {
        success = false;
        console.error(
          `${mutation.id}: mutation was not caught for the expected reason `
            + `(status=${String(result.status)} signal=${String(result.signal)} marker=${output.includes(mutation.expectedReason)} `
            + `targetedFailure=${expectedTestFailure})`,
        );
      }
    } catch (error) {
      success = false;
      summary.mutations.push({
        id: mutation.id,
        protection: mutation.protection,
        source: mutation.source,
        caught: false,
        runnerError: error instanceof Error ? (error.stack ?? error.message) : String(error),
      });
      console.error(`${mutation.id}: runner error`, error);
    } finally {
      if (applied != null) {
        writeFileSync(applied.sourcePath, applied.original);
      }
    }
  }
  summary.success = success;
  writeSummary(outputDir, summary);
  return success;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.list) {
    listInventory(options.json);
    return;
  }
  if (options.check) {
    verifyInventory();
    console.log(`P33 mutation inventory is exact: ${MUTATIONS.length} protections assigned once`);
    return;
  }
  let selected;
  let shardLabel;
  if (options.mutation == null) {
    const shard = parseShard(options.shard ?? `1/${DEFAULT_SHARDS}`);
    selected = shard.mutations;
    shardLabel = `${shard.index}/${shard.total}`;
  } else {
    const mutation = MUTATIONS.find(candidate => candidate.id === options.mutation);
    if (mutation == null) {
      throw new Error(`unknown mutation ID: ${options.mutation}`);
    }
    selected = [mutation];
    shardLabel = `mutation:${mutation.id}`;
  }
  const outputDir = resolve(REPO_ROOT, options.outputDir);
  if (!executeShard(selected, outputDir, shardLabel)) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
}
