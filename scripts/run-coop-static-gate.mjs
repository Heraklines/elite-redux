/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(executable, args, opts = {}) {
  return spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024,
    ...opts,
  });
}

const configuredBase = process.env.COOP_BASE_SHA?.trim();
const base = configuredBase && !/^0+$/.test(configuredBase) ? configuredBase : "HEAD^";
const baseExists = run("git", ["cat-file", "-e", `${base}^{commit}`]);
if (baseExists.status !== 0) {
  process.stderr.write(`Co-op static gate cannot resolve base commit ${base}; checkout history is incomplete.\n`);
  process.exit(1);
}
const changedResult = run("git", ["diff", "--name-only", "--diff-filter=ACMR", base, "HEAD"]);
if (changedResult.status !== 0) {
  process.stderr.write(changedResult.stderr ?? "Unable to enumerate changed files.\n");
  process.exit(1);
}
const changed = new Set(
  (changedResult.stdout ?? "")
    .split(/\r?\n/)
    .map(file => file.trim().replaceAll("\\", "/"))
    .filter(Boolean),
);
if (changed.size === 0) {
  process.stderr.write(`Co-op static gate resolved zero changed files for ${base}..HEAD; refusing a vacuous pass.\n`);
  process.exit(1);
}

function isCoopStaticScope(file) {
  return (
    file.startsWith("src/data/elite-redux/coop/")
    || file.startsWith("src/phases/coop-")
    || file.startsWith("test/tests/elite-redux/coop/")
    || file.startsWith("test/tools/coop-")
    || file === "src/phases/command-phase.ts"
    || file === "src/phases/title-phase.ts"
  );
}

const typecheck = run(command, ["typecheck"]);
const typeOutput = `${typecheck.stdout ?? ""}\n${typecheck.stderr ?? ""}`;
const diagnostics = [...typeOutput.matchAll(/^([^\r\n(]+)\((\d+),(\d+)\): error (TS\d+:[^\r\n]*)/gm)].map(match => ({
  file: match[1].replaceAll("\\", "/").replace(/^\.\//, ""),
  line: match[2],
  column: match[3],
  message: match[4],
}));
const TYPE_DIAGNOSTIC_BASELINE = 299;
if (typecheck.status !== 0 && diagnostics.length === 0) {
  process.stderr.write(
    "Repository typecheck failed but the static gate parsed zero diagnostics; refusing a false green.\n",
  );
  process.stderr.write(typeOutput);
  process.exit(1);
}
const changedDiagnostics = diagnostics.filter(
  diagnostic => changed.has(diagnostic.file) || isCoopStaticScope(diagnostic.file),
);

if (changedDiagnostics.length > 0) {
  process.stderr.write(`Co-op-scope/changed-file TypeScript diagnostics (${changedDiagnostics.length}):\n`);
  for (const diagnostic of changedDiagnostics) {
    process.stderr.write(`${diagnostic.file}(${diagnostic.line},${diagnostic.column}): error ${diagnostic.message}\n`);
  }
  process.exit(1);
}
if (diagnostics.length > TYPE_DIAGNOSTIC_BASELINE) {
  process.stderr.write(
    `Repository TypeScript diagnostic ratchet regressed: ${diagnostics.length} > ${TYPE_DIAGNOSTIC_BASELINE}.\n`,
  );
  process.stderr.write(typeOutput);
  process.exit(1);
}
if (typecheck.status !== 0) {
  process.stdout.write(
    `Full repository typecheck has ${diagnostics.length} pre-existing diagnostics; none are in this checkpoint's changed files.\n`,
  );
}

// Biome has a substantial historical warning/format baseline in the wider co-op tree.
// Enforce it on every file introduced or changed by this checkpoint; applying it to all
// historical files would make unrelated legacy style debt block every architecture fix.
// TypeScript remains stricter above: every co-op diagnostic blocks, changed or not.
const biomeFiles = [...changed].filter(file => /\.(?:[cm]?[jt]sx?|jsonc?|ya?ml|md)$/.test(file));
if (biomeFiles.length > 0) {
  const biome = run(command, ["exec", "biome", "check", ...biomeFiles], { stdio: "inherit", encoding: undefined });
  if (biome.status !== 0) {
    process.exit(biome.status ?? 1);
  }
}

process.stdout.write(
  `Co-op static gate passed: zero TypeScript diagnostics in the full co-op scope and Biome-clean ${changed.size} changed files.\n`,
);
