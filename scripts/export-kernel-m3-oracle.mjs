#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TEST_PATH = "test/kernel-fixtures/m3/export-battle-oracle.test.ts";
const ORACLE_SHA = process.env.M5_ORACLE_REFRESH_SHA ?? "3b534099919efae827019d4a3f3c4ab0ecd6d67b";

function fail(message) {
  console.error(`M3A-05 exporter: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
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
    fail("usage: node scripts/export-kernel-m3-oracle.mjs --output-root <absolute-directory>");
  }

  const supplied = argv[1];
  if (!isAbsolute(supplied)) {
    fail("--output-root must be absolute");
  }

  const outputRoot = resolve(supplied);
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
    if (readdirSync(outputRoot).length > 0) {
      fail("--output-root must not contain any entries");
    }
  } else {
    mkdirSync(outputRoot, { recursive: true });
  }

  return outputRoot;
}

function expectedInventory() {
  const manifestPath = resolve(REPO_ROOT, "rust/fixtures/m3/m3-oracle-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const cases = manifest.case_contracts.map(contract => contract.fixture_path.replace(/^rust\/fixtures\/m3\/oracle\//u, ""));
  const support = manifest.supporting_artifact_contracts.map(contract =>
    contract.fixture_path.replace(/^rust\/fixtures\/m3\/oracle\//u, ""),
  );
  return [...cases, ...support].sort();
}

function inventory(root) {
  const files = [];
  const visit = (directory, prefix = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path, name);
      } else if (entry.isFile()) {
        files.push(name.replaceAll("\\", "/"));
      } else {
        fail(`output root contains unsupported entry: ${name}`);
      }
    }
  };
  visit(root);
  return files.sort();
}

function runVitest(outputRoot) {
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
    M3_ORACLE_OUTPUT_ROOT: outputRoot,
    M3_ORACLE_SHA: ORACLE_SHA,
  };
  const result = spawnSync(
    process.execPath,
    [
      vitestEntry,
      "run",
      TEST_PATH,
      "--reporter=default",
      "--pool=forks",
      "--maxWorkers=1",
      "--no-file-parallelism",
    ],
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
    const diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.split(/\r?\n/u).slice(-240).join("\n").trim();
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

const initialStatus = gitStatus();
const outputRoot = parseOutputRoot(process.argv.slice(2));
runVitest(outputRoot);

const actual = inventory(outputRoot);
const expected = expectedInventory();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  fail(`output inventory mismatch; expected ${expected.length} files and found ${actual.length}`);
}

const finalStatus = gitStatus();
if (finalStatus !== initialStatus) {
  fail(
    `export changed the checkout; generated evidence must remain outside the source tree; initial=${JSON.stringify(initialStatus)} final=${JSON.stringify(finalStatus)}`,
  );
}

console.log(`M3A-05 exporter: wrote ${actual.length} verified files to ${outputRoot}`);
