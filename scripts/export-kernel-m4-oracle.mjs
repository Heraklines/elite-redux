#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TEST_PATH = "test/kernel-fixtures/m4/export-run-oracle.test.ts";
const HELPER_TEST_PATH = "test/kernel-fixtures/m4/export-helper-runner.test.ts";
const HELPER_OUTPUT_FILES = {
  content: "content.json",
  "reward-market": "reward-market.json",
  progression: "progression.json",
  biome: "biome.json",
  encounter: "encounter.json",
  migration: "migration.json",
  composed: "composed.json",
};
const HELPER_KINDS = Object.keys(HELPER_OUTPUT_FILES);
const MANIFEST_PATH = "rust/fixtures/m4/m4-oracle-manifest.json";
const LEGACY_M4_ORACLE_SHA = "45c89493e7edec9c4da247a98cd7858b1f015c09";
const LEGACY_M3_PARITY_ORACLE_SHA = "3b534099919efae827019d4a3f3c4ab0ecd6d67b";
const ORACLE_SHA = process.env.M5_ORACLE_REFRESH_SHA ?? LEGACY_M4_ORACLE_SHA;

function fail(message) {
  console.error(`M4A oracle exporter: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function git(...args) {
  const result = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    fail(`git ${args.join(" ")} failed: ${result.error?.message ?? result.stderr ?? result.status}`);
  }
  return result.stdout.trim();
}

function gitStatus() {
  const result = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    fail(`git status failed: ${result.error?.message ?? result.stderr ?? result.status}`);
  }
  return result.stdout;
}

function realPathForContainment(path) {
  const suffix = [];
  let existing = path;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) {
      fail(`cannot resolve output-root parent ${path}`);
    }
    suffix.unshift(basename(existing));
    existing = parent;
  }
  return resolve(realpathSync(existing), ...suffix);
}

function parseOutputRoot(argv) {
  if (argv.length !== 2 || argv[0] !== "--output-root" || typeof argv[1] !== "string") {
    fail("usage: node scripts/export-kernel-m4-oracle.mjs --output-root <absolute-directory>");
  }
  if (!isAbsolute(argv[1])) {
    fail("--output-root must be absolute");
  }

  const outputRoot = resolve(argv[1]);
  const realRepoRoot = realpathSync(REPO_ROOT);
  const realOutputRoot = realPathForContainment(outputRoot);
  const repoRelative = relative(realRepoRoot, realOutputRoot);
  const insideCheckout = repoRelative === "" || (!isAbsolute(repoRelative) && !repoRelative.startsWith(".."));
  if (insideCheckout) {
    fail("--output-root must be outside the checkout so generated evidence cannot dirty the source tree");
  }
  if (existsSync(outputRoot)) {
    if (!statSync(outputRoot).isDirectory()) {
      fail("--output-root must name a directory");
    }
    if (readdirSync(outputRoot).length !== 0) {
      fail("--output-root must not contain any entries");
    }
  } else {
    mkdirSync(outputRoot, { recursive: true });
  }
  return outputRoot;
}

function assertOracleSource() {
  if (process.platform !== "linux" || process.arch !== "x64") {
    fail(`oracle publication requires hosted linux/x64, got ${process.platform}/${process.arch}`);
  }
  if (process.env.LC_ALL !== "C" || process.env.LANG !== "C" || process.env.TZ !== "UTC") {
    fail("oracle publication requires LC_ALL=C, LANG=C, and TZ=UTC");
  }
  git("cat-file", "-e", `${ORACLE_SHA}^{commit}`);
  const sourceDiff = spawnSync("git", ["diff", "--exit-code", ORACLE_SHA, "--", "src", "rust/source-lock.toml"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (sourceDiff.error || sourceDiff.status !== 0) {
    fail(`production TypeScript/source-lock differs from pinned oracle ${ORACLE_SHA}`);
  }
}

function exporterSha() {
  const sha = git("log", "-1", "--format=%H", "--", "scripts/export-kernel-m4-oracle.mjs", TEST_PATH);
  return /^[0-9a-f]{40}$/u.test(sha) ? sha : git("rev-parse", "HEAD");
}

function expectedInventory() {
  const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, MANIFEST_PATH), "utf8"));
  if (manifest.m4_oracle_sha !== LEGACY_M4_ORACLE_SHA) {
    fail(`M4 selection manifest m4_oracle_sha is not ${LEGACY_M4_ORACLE_SHA}`);
  }
  if (manifest.m3_parity_oracle_sha !== LEGACY_M3_PARITY_ORACLE_SHA) {
    fail("M4 selection manifest m3_parity_oracle_sha is not the frozen M3 parity oracle");
  }
  if (!Array.isArray(manifest.required_outputs) || manifest.required_outputs.length === 0) {
    fail("M4 manifest has no required_outputs");
  }
  const prefix = "rust/fixtures/m4/oracle/";
  return manifest.required_outputs
    .filter(path => path.startsWith(prefix))
    .map(path => path.slice(prefix.length))
    .sort();
}

function inventory(root) {
  const files = [];
  const visit = (directory, prefix = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path, name);
      } else if (entry.isFile()) {
        files.push(name.replaceAll("\\", "/"));
      } else {
        fail(`output root contains unsupported entry ${name}`);
      }
    }
  };
  visit(root);
  return files.sort();
}

function canonicalJson(value, path = "$") {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail(`non-finite JSON number at ${path}`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((child, index) => {
      if (child === undefined) {
        fail(`undefined JSON array member at ${path}[${index}]`);
      }
      return canonicalJson(child, `${path}[${index}]`);
    });
  }
  if (typeof value === "object") {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) {
        fail(`undefined JSON property at ${path}.${key}`);
      }
      output[key] = canonicalJson(value[key], `${path}.${key}`);
    }
    return output;
  }
  fail(`unsupported JSON value at ${path}`);
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(canonicalJson(value))}\n`, "utf8");
}

function verifyCanonicalFiles(root, expected) {
  const actual = inventory(root);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`output inventory mismatch; expected ${JSON.stringify(expected)} and found ${JSON.stringify(actual)}`);
  }
  for (const relativePath of actual) {
    const filePath = resolve(root, relativePath);
    const bytes = readFileSync(filePath);
    const parsed = JSON.parse(bytes.toString("utf8"));
    if (!bytes.equals(canonicalBytes(parsed))) {
      fail(`non-canonical JSON output ${relativePath}`);
    }
    createHash("sha256").update(bytes).digest("hex");
  }
  return actual;
}

function childDiagnostic(result) {
  if (result.error) {
    return result.error.message;
  }
  const diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.split(/\r?\n/u).slice(-300).join("\n").trim();
  if (result.signal) {
    return `${diagnostic}\nterminated by ${result.signal}`.trim();
  }
  return diagnostic.length > 0 ? diagnostic : `exited with status ${result.status}`;
}

function runVitest(testPath, environment) {
  const vitestEntry = resolve(REPO_ROOT, "node_modules/vitest/vitest.mjs");
  if (!existsSync(vitestEntry)) {
    fail("node_modules/vitest/vitest.mjs is missing; install the pinned dependencies before exporting");
  }
  const env = {
    ...process.env,
    LC_ALL: "C",
    LC_CTYPE: "C",
    LANG: "C",
    LANGUAGE: "C",
    LC_NUMERIC: "C",
    TZ: "UTC",
    M4_ORACLE_SHA: ORACLE_SHA,
    ...environment,
  };
  const result = spawnSync(
    process.execPath,
    [vitestEntry, "run", testPath, "--reporter=default", "--pool=forks", "--maxWorkers=1", "--no-file-parallelism"],
    {
      cwd: REPO_ROOT,
      env,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return {
    ok: result.error == null && result.status === 0 && result.signal == null,
    status: result.status,
    signal: result.signal,
    diagnostic: childDiagnostic(result),
  };
}

function writeCanonicalFile(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, canonicalBytes(value));
}

function writeProcessGap(outputPath, kind, detail) {
  writeCanonicalFile(outputPath, {
    m4_capture_gap: {
      code: "CAPTURE_PROCESS_FAILED",
      source_seam: `scripts/export-kernel-m4-oracle.mjs:${kind}`,
      message: detail,
    },
  });
}

function contentHashes(rawRoot) {
  const path = resolve(rawRoot, HELPER_OUTPUT_FILES.content);
  if (!existsSync(path)) {
    return { error: "content helper output is missing" };
  }
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    const battle = value?.battle_content_pack?.hash;
    const run = value?.run_content_pack?.run_content_hash;
    if (
      typeof battle !== "string" || !/^blake3-v1:[0-9a-f]{64}$/u.test(battle)
      || typeof run !== "string" || !/^blake3-v1:[0-9a-f]{64}$/u.test(run)
    ) {
      return { error: "content helper did not expose exact battle/run content hashes" };
    }
    return { battle, run };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function helperEnvironment(kind, rawRoot, failures) {
  if (kind === "content") {
    return {};
  }
  const hashes = contentHashes(rawRoot);
  if (hashes.error) {
    failures.push(`helper ${kind}: ${hashes.error}`);
    return {
      M4_ORACLE_BATTLE_CONTENT_HASH: "",
      M4_ORACLE_RUN_CONTENT_HASH: "",
      ...(kind === "composed" ? { M4_ORACLE_COMPOSED_FIXTURE_ID: "run-segments/classic-composed-wave-9-through-11-v1" } : {}),
    };
  }
  return {
    M4_ORACLE_BATTLE_CONTENT_HASH: hashes.battle,
    M4_ORACLE_RUN_CONTENT_HASH: hashes.run,
    ...(kind === "composed" ? { M4_ORACLE_COMPOSED_FIXTURE_ID: "run-segments/classic-composed-wave-9-through-11-v1" } : {}),
  };
}

function runPass(outputRoot, rawRoot, run, exporterCommitSha) {
  mkdirSync(outputRoot, { recursive: true });
  mkdirSync(rawRoot, { recursive: true });
  const failures = [];
  for (const kind of HELPER_KINDS) {
    const outputPath = resolve(rawRoot, HELPER_OUTPUT_FILES[kind]);
    const result = runVitest(HELPER_TEST_PATH, {
      M4_CAPTURE_KIND: kind,
      M4_CAPTURE_OUTPUT: outputPath,
      M4_ORACLE_EXPORTER_SHA: exporterCommitSha,
      M4_ORACLE_PROCESS: String(run),
      ...helperEnvironment(kind, rawRoot, failures),
    });
    if (!existsSync(outputPath)) {
      writeProcessGap(outputPath, kind, result.diagnostic);
    }
    if (!result.ok) {
      failures.push(`helper ${kind}: ${result.diagnostic}`);
    }
  }
  const composition = runVitest(TEST_PATH, {
    M4_ORACLE_OUTPUT_ROOT: outputRoot,
    M4_ORACLE_RAW_ROOT: rawRoot,
    M4_ORACLE_GAP_REPORT: process.env.M4_ORACLE_GAP_REPORT || resolve(rawRoot, "gap-report.json"),
    M4_ORACLE_EXPORTER_SHA: exporterCommitSha,
    M4_ORACLE_PROCESS: String(run),
  });
  if (!composition.ok) {
    failures.push(`composition pass ${run}: ${composition.diagnostic}`);
  }
  return failures;
}

function firstByteDivergence(left, right) {
  const length = Math.min(left.length, right.length);
  for (let offset = 0; offset < length; offset += 1) {
    if (left[offset] !== right[offset]) {
      return offset;
    }
  }
  return left.length === right.length ? null : length;
}

function firstJsonDifference(left, right, path = "$") {
  if (Object.is(left, right)) return null;
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      if (index >= left.length || index >= right.length) {
        return `${path}[${index}]: ${JSON.stringify(left[index])} != ${JSON.stringify(right[index])}`;
      }
      const difference = firstJsonDifference(left[index], right[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      if (!(key in left) || !(key in right)) {
        return `${path}.${key}: ${JSON.stringify(left[key])} != ${JSON.stringify(right[key])}`;
      }
      const difference = firstJsonDifference(left[key], right[key], `${path}.${key}`);
      if (difference) return difference;
    }
    return null;
  }
  return `${path}: ${JSON.stringify(left)} != ${JSON.stringify(right)}`;
}

function compareTrees(left, right, expected) {
  for (const relativePath of expected) {
    const leftBytes = readFileSync(resolve(left, relativePath));
    const rightBytes = readFileSync(resolve(right, relativePath));
    const offset = firstByteDivergence(leftBytes, rightBytes);
    if (offset !== null) {
      const leftByte = offset < leftBytes.length ? `0x${leftBytes[offset].toString(16).padStart(2, "0")}` : "EOF";
      const rightByte = offset < rightBytes.length ? `0x${rightBytes[offset].toString(16).padStart(2, "0")}` : "EOF";
      const structural = firstJsonDifference(
        JSON.parse(leftBytes.toString("utf8")),
        JSON.parse(rightBytes.toString("utf8")),
      );
      fail(`fresh-process output differs at ${relativePath}, first byte ${offset}: ${leftByte} != ${rightByte}; ${structural}`);
    }
  }
}

const initialStatus = gitStatus();
assertOracleSource();
const outputRoot = parseOutputRoot(process.argv.slice(2));
const expected = expectedInventory();
const commitSha = exporterSha();
const tempRoot = mkdtempSync(join(process.env.RUNNER_TEMP ?? process.env.TMPDIR ?? "/tmp", "pokerogue-m4-oracle-"));
const first = join(tempRoot, "first");
const second = join(tempRoot, "second");
const firstRaw = join(tempRoot, "first-raw");
const secondRaw = join(tempRoot, "second-raw");
mkdirSync(first);
mkdirSync(second);
mkdirSync(firstRaw);
mkdirSync(secondRaw);
try {
  const firstFailures = runPass(first, firstRaw, 1, commitSha);
  const secondFailures = runPass(second, secondRaw, 2, commitSha);
  const failures = [...firstFailures, ...secondFailures];
  if (failures.length > 0) {
    process.stderr.write(`${failures.join("\n")}\n`);
    cpSync(secondRaw, resolve(outputRoot, "raw-failure"), { recursive: true });
    writeCanonicalFile(resolve(outputRoot, "raw-failure", "child-failures.json"), failures);
    const finalStatus = gitStatus();
    if (finalStatus !== initialStatus) {
      fail(`export changed the checkout; initial=${JSON.stringify(initialStatus)} final=${JSON.stringify(finalStatus)}`);
    }
    fail(`M4A exporter child process failures:\n${failures.join("\n")}`);
  }
  try {
    verifyCanonicalFiles(first, expected);
    verifyCanonicalFiles(second, expected);
    compareTrees(first, second, expected);
  } catch (error) {
    cpSync(first, resolve(outputRoot, "diagnostic-first"), { recursive: true });
    cpSync(second, resolve(outputRoot, "diagnostic-second"), { recursive: true });
    writeCanonicalFile(resolve(outputRoot, "export-failure.json"), {
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  cpSync(first, outputRoot, { recursive: true });
  const published = verifyCanonicalFiles(outputRoot, expected);
  const finalStatus = gitStatus();
  if (finalStatus !== initialStatus) {
    fail(`export changed the checkout; initial=${JSON.stringify(initialStatus)} final=${JSON.stringify(finalStatus)}`);
  }
  console.log(`M4A oracle exporter: wrote ${published.length} byte-identical verified files to ${outputRoot}`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
