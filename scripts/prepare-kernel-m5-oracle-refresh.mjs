#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OVERLAY_PATHS = [
  "scripts/export-kernel-m3-oracle.mjs",
  "scripts/export-kernel-m4-oracle.mjs",
  "test/kernel-fixtures/m3",
  "test/kernel-fixtures/m4",
  "rust/fixtures/m3",
  "rust/fixtures/m4",
];

function fail(message) {
  console.error(`M5 oracle refresh overlay: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function git(root, ...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    fail(`git ${args.join(" ")} failed in ${root}: ${result.error?.message ?? result.stderr ?? result.status}`);
  }
  return result.stdout.trim();
}

function parseArgs(argv) {
  if (argv.length !== 4 || argv[0] !== "--oracle-root" || argv[2] !== "--oracle-sha") {
    fail("usage: node scripts/prepare-kernel-m5-oracle-refresh.mjs --oracle-root <absolute-directory> --oracle-sha <40-hex>");
  }
  if (!isAbsolute(argv[1]) || !/^[0-9a-f]{40}$/u.test(argv[3])) {
    fail("--oracle-root must be absolute and --oracle-sha must be lowercase 40-hex");
  }
  return { oracleRoot: resolve(argv[1]), oracleSha: argv[3] };
}

function isWithin(root, path) {
  const fromRoot = relative(realpathSync(root), realpathSync(path));
  return fromRoot === "" || (!isAbsolute(fromRoot) && !fromRoot.startsWith(".."));
}

const { oracleRoot, oracleSha } = parseArgs(process.argv.slice(2));
if (!existsSync(oracleRoot) || !statSync(oracleRoot).isDirectory()) {
  fail("--oracle-root must name an existing directory");
}
if (isWithin(REPO_ROOT, oracleRoot)) {
  fail("oracle checkout must be outside the integration checkout");
}
if (git(oracleRoot, "rev-parse", "HEAD") !== oracleSha) {
  fail(`oracle checkout is not at ${oracleSha}`);
}
if (git(oracleRoot, "status", "--porcelain", "--untracked-files=all") !== "") {
  fail("oracle checkout must be clean before applying the test-only overlay");
}
for (const relativePath of OVERLAY_PATHS) {
  const source = resolve(REPO_ROOT, relativePath);
  const destination = resolve(oracleRoot, relativePath);
  if (!existsSync(source)) {
    fail(`integration checkout is missing ${relativePath}`);
  }
  if (existsSync(destination)) {
    fail(`oracle checkout already contains overlay target ${relativePath}`);
  }
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
}
const changed = git(oracleRoot, "status", "--porcelain", "--untracked-files=all").split(/\r?\n/u).filter(Boolean);
if (changed.length === 0 || changed.some(line => line.slice(3).startsWith("src/"))) {
  fail("overlay must add test/fixture tooling and must not touch production TypeScript");
}
console.log(`M5 oracle refresh overlay: added ${OVERLAY_PATHS.length} test-only paths at ${oracleSha}`);
