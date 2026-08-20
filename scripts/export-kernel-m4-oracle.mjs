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
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TEST_PATH = "test/kernel-fixtures/m4/export-run-oracle.test.ts";
const MANIFEST_PATH = "rust/fixtures/m4/m4-oracle-manifest.json";
const ORACLE_SHA = "45c89493e7edec9c4da247a98cd7858b1f015c09";

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
  if (manifest.oracle_game_sha !== ORACLE_SHA) {
    fail(`M4 manifest oracle_game_sha is not ${ORACLE_SHA}`);
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

function runVitest(outputRoot, run, exporterCommitSha) {
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
    M4_ORACLE_OUTPUT_ROOT: outputRoot,
    M4_ORACLE_SHA: ORACLE_SHA,
    M4_ORACLE_EXPORTER_SHA: exporterCommitSha,
    M4_ORACLE_PROCESS: String(run),
  };
  const result = spawnSync(
    process.execPath,
    [vitestEntry, "run", TEST_PATH, "--reporter=default", "--pool=forks", "--maxWorkers=1", "--no-file-parallelism"],
    {
      cwd: REPO_ROOT,
      env,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.error) {
    fail(`Vitest exporter process failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.split(/\r?\n/u).slice(-300).join("\n").trim();
    if (diagnostic.length > 0) {
      process.stderr.write(`${diagnostic}\n`);
    }
    process.exitCode = result.status ?? 1;
    throw new Error(`Vitest exporter process failed with status ${result.status}`);
  }
  if (result.signal) {
    process.exitCode = 1;
    throw new Error(`Vitest exporter process terminated by ${result.signal}`);
  }
}

function compareTrees(left, right, expected) {
  for (const relativePath of expected) {
    const leftBytes = readFileSync(resolve(left, relativePath));
    const rightBytes = readFileSync(resolve(right, relativePath));
    if (!leftBytes.equals(rightBytes)) {
      fail(`fresh-process output differs at ${relativePath}`);
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
mkdirSync(first);
mkdirSync(second);
try {
  runVitest(first, 1, commitSha);
  verifyCanonicalFiles(first, expected);
  runVitest(second, 2, commitSha);
  verifyCanonicalFiles(second, expected);
  compareTrees(first, second, expected);
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
