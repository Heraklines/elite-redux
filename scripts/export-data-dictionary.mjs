#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
const outputIndex = process.argv.indexOf("--out");
const output =
  outputIndex >= 0 && process.argv[outputIndex + 1]
    ? resolve(process.cwd(), process.argv[outputIndex + 1])
    : resolve(repoRoot, "dev-logs", "data-dictionary", `er-data-dictionary-${pkg.version}.json`);
const isWindows = process.platform === "win32";
const command = isWindows ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
const args = isWindows
  ? ["/d", "/s", "/c", "pnpm exec vitest run scripts/export-data-dictionary.test.ts"]
  : ["exec", "vitest", "run", "scripts/export-data-dictionary.test.ts"];
const result = spawnSync(command, args, {
  cwd: repoRoot,
  env: { ...process.env, ER_DATA_DICTIONARY_OUT: output },
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`[data-dictionary] runtime registry for build ${pkg.version} -> ${output}`);
