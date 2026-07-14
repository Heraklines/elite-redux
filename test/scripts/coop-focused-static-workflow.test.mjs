/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflow = readFileSync(resolve(root, ".github/workflows/coop-focused-branch.yml"), "utf8").replaceAll(
  "\r\n",
  "\n",
);
const staticGate = readFileSync(resolve(root, "scripts/run-coop-static-gate.mjs"), "utf8").replaceAll("\r\n", "\n");

function job(name, nextName) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  const end = workflow.indexOf(`\n  ${nextName}:\n`, start + 1);
  assert.notEqual(start, -1, `${name} job must exist`);
  assert.notEqual(end, -1, `${nextName} job must follow ${name}`);
  return workflow.slice(start, end);
}

test("focused static checks the planner's exact declared train base", () => {
  assert.match(workflow, /declared_base_sha: \$\{\{ steps\.ownership\.outputs\.base_sha \}\}/u);

  const staticJob = job("static", "gate");
  assert.match(staticJob, /needs: plan/u);
  assert.equal(
    [...staticJob.matchAll(/COOP_BASE_SHA: \$\{\{ needs\.plan\.outputs\.declared_base_sha \}\}/gu)].length,
    2,
  );
  assert.match(staticJob, /git fetch --no-tags --depth=1 origin "\$COOP_BASE_SHA"/u);
  assert.match(staticJob, /node scripts\/run-coop-static-gate\.mjs/u);
  assert.match(staticJob, /if: success\(\)[\s\S]*coop-focused-static-status\.json/u);
  assert.match(staticJob, /if: failure\(\)[\s\S]*coop-focused-static\.log/u);
});

test("focused static accepts ignored-only metadata after the non-vacuous type ratchet", () => {
  assert.match(staticGate, /biome", "check", "--no-errors-on-unmatched"/u);
});

test("focused aggregate requires static and isolated shard evidence", () => {
  assert.match(workflow, /group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}/u);

  const gateJob = job("gate", "focused-required");
  assert.match(gateJob, /fail-fast: false/u);

  const requiredStart = workflow.indexOf("\n  focused-required:\n");
  assert.notEqual(requiredStart, -1, "focused-required job must exist");
  const requiredJob = workflow.slice(requiredStart);
  assert.match(requiredJob, /needs: \[plan, static, gate\]/u);
  assert.match(requiredJob, /STATIC_RESULT: \$\{\{ needs\.static\.result \}\}/u);
  assert.match(requiredJob, /test "\$STATIC_RESULT" = success/u);
});
