#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const ORACLE_SHA = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";
const ROOT = resolve(import.meta.dirname, "..");
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}
const oracleRoot = args.get("--oracle-worktree");
const outputArgument = args.get("--output") ?? "rust/fixtures/m9/solo-entry/starter-oracle-v1.json";
if (oracleRoot == null || !isAbsolute(oracleRoot)) {
  throw new Error(
    "usage: export-kernel-m9-bootstrap-oracle --oracle-worktree <absolute pinned worktree> [--output <path>]",
  );
}
const oracle = resolve(oracleRoot);
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: oracle, encoding: "utf8" }).trim();
if (head !== ORACLE_SHA) {
  throw new Error(`M9 bootstrap oracle worktree is ${head}, expected ${ORACLE_SHA}`);
}
const helperSource = resolve(ROOT, "test/kernel-fixtures/m9/export-starter-oracle.ts");
const helperTarget = resolve(oracle, "test/kernel-fixtures/m9-export-starter-oracle.test.ts");
const output = isAbsolute(outputArgument) ? resolve(outputArgument) : resolve(ROOT, outputArgument);
const first = `${output}.first.tmp`;
const second = `${output}.second.tmp`;
mkdirSync(resolve(output, ".."), { recursive: true });
mkdirSync(resolve(helperTarget, ".."), { recursive: true });
copyFileSync(helperSource, helperTarget);
const vitestArgs = [
  "pnpm",
  "exec",
  "vitest",
  "run",
  "test/kernel-fixtures/m9-export-starter-oracle.test.ts",
  "--pool=forks",
  "--isolate",
  "--no-file-parallelism",
];
const executable = process.platform === "win32" ? "cmd.exe" : "corepack";
const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", `corepack ${vitestArgs.join(" ")}`] : vitestArgs;
try {
  for (const target of [first, second]) {
    execFileSync(executable, commandArgs, {
      cwd: oracle,
      stdio: "inherit",
      env: { ...process.env, M9_BOOTSTRAP_ORACLE_OUTPUT: target, NODE_OPTIONS: "--max-old-space-size=4096" },
    });
  }
  const firstBytes = readFileSync(first);
  const secondBytes = readFileSync(second);
  if (!firstBytes.equals(secondBytes)) {
    throw new Error("fresh-process M9 bootstrap oracle exports are not byte-identical");
  }
  writeFileSync(output, firstBytes);
  console.log(`M9 bootstrap oracle: ${output}`);
} finally {
  rmSync(helperTarget, { force: true });
  rmSync(first, { force: true });
  rmSync(second, { force: true });
}
