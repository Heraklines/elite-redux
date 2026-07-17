#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const value = name => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const output = value("--output");
if (!output) {
  throw new Error("write-coop-ci-status requires --output");
}

const evidence = [];
for (const path of [value("--log"), value("--assignment")].filter(Boolean)) {
  const absolute = resolve(path);
  if (!existsSync(absolute)) {
    continue;
  }
  const contents = readFileSync(absolute);
  evidence.push({
    path: path.replaceAll("\\", "/"),
    bytes: statSync(absolute).size,
    sha256: createHash("sha256").update(contents).digest("hex"),
  });
}

const exitCode = value("--exit-code");
const manifest = {
  version: 1,
  sha: process.env.GITHUB_SHA ?? "local",
  workflow: process.env.GITHUB_WORKFLOW ?? "local",
  runId: process.env.GITHUB_RUN_ID ?? "local",
  ref: process.env.GITHUB_REF ?? "local",
  kind: value("--kind") ?? "unknown",
  lane: value("--lane"),
  shard: value("--shard"),
  exitCode: exitCode == null || exitCode === "" ? null : Number(exitCode),
  status: exitCode === "0" ? "passed" : exitCode == null || exitCode === "" ? "unknown" : "failed",
  completedAt: new Date().toISOString(),
  evidence,
};
writeFileSync(resolve(output), `${JSON.stringify(manifest, null, 2)}\n`);
