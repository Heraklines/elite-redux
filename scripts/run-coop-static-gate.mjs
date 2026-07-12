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

const changedResult = run("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]);
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

function isCoopStaticScope(file) {
  return (
    file.startsWith("src/data/elite-redux/coop/")
    || file.startsWith("src/phases/coop-")
    || file.startsWith("test/tests/elite-redux/coop/")
    || (file.startsWith("test/tools/coop-") && file !== "test/tools/coop-soak-driver.ts")
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
if (typecheck.status !== 0) {
  process.stdout.write(
    `Full repository typecheck has ${diagnostics.length} pre-existing diagnostics; none are in this checkpoint's changed files.\n`,
  );
}

const trackedResult = run("git", ["ls-files"]);
if (trackedResult.status !== 0) {
  process.stderr.write(trackedResult.stderr ?? "Unable to enumerate tracked files.\n");
  process.exit(1);
}
const tracked = (trackedResult.stdout ?? "")
  .split(/\r?\n/)
  .map(file => file.trim().replaceAll("\\", "/"))
  .filter(Boolean);
const biomeFiles = [...new Set([...changed, ...tracked.filter(isCoopStaticScope)])].filter(file =>
  /\.(?:[cm]?[jt]sx?|jsonc?|ya?ml|md)$/.test(file),
);
if (biomeFiles.length > 0) {
  const biome = run(command, ["exec", "biome", "check", ...biomeFiles], { stdio: "inherit", encoding: undefined });
  if (biome.status !== 0) {
    process.exit(biome.status ?? 1);
  }
}

process.stdout.write(`Co-op static gate passed for the full co-op scope and ${changed.size} changed files.\n`);
