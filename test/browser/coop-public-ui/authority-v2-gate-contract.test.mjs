/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../../../", import.meta.url);
const gateWorkflow = readFileSync(new URL(".github/workflows/coop-gate-sharded.yml", root), "utf8");
const campaignWorkflow = readFileSync(new URL(".github/workflows/coop-public-ui-campaign.yml", root), "utf8");
const stagingWorkflow = readFileSync(new URL(".github/workflows/deploy-staging.yml", root), "utf8");
const coopRuntime = readFileSync(new URL("src/data/elite-redux/coop/coop-runtime.ts", root), "utf8");

function jobBlock(workflow, job) {
  const lines = workflow.split(/\r?\n/gu);
  const start = lines.indexOf(`  ${job}:`);
  assert.notEqual(start, -1, `workflow contains the ${job} job`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index++) {
    if (/^ {2}[a-z0-9-]+:\s*$/iu.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

test("every real-engine shard qualifies Authority V2 instead of hiding behind legacy", () => {
  const gate = jobBlock(gateWorkflow, "gate");
  assert.match(gate, /COOP_AUTHORITY_V2_TURN:\s*"on"/u);
  assert.match(gate, /COOP_AUTHORITY_V2_REPLACEMENT:\s*"on"/u);
  assert.match(gate, /node scripts\/run-coop-gate\.mjs/u);
  assert.doesNotMatch(
    gate,
    /COOP_AUTHORITY_V2_(?:TURN|REPLACEMENT):\s*"(?:off|false|0)"/u,
    "the exhaustive gameplay matrix may never downgrade the production architecture",
  );
});

test("public-browser campaign and staging bundle qualify the same V2 cutover", () => {
  const browserBuild = jobBlock(gateWorkflow, "browser-build");
  assert.match(browserBuild, /VITE_COOP_AUTHORITY_V2_TURN:\s*"on"/u);
  assert.match(browserBuild, /VITE_COOP_AUTHORITY_V2_REPLACEMENT:\s*"on"/u);
  assert.match(campaignWorkflow, /VITE_COOP_AUTHORITY_V2_TURN:\s*"on"/u);
  assert.match(campaignWorkflow, /VITE_COOP_AUTHORITY_V2_REPLACEMENT:\s*"on"/u);
  assert.match(stagingWorkflow, /echo "VITE_COOP_AUTHORITY_V2_TURN=on"/u);
  assert.match(stagingWorkflow, /echo "VITE_COOP_AUTHORITY_V2_REPLACEMENT=on"/u);
});

test("an existing Authority V2 runtime rebinds only after the replacement channel is authenticated", () => {
  const start = coopRuntime.indexOf("export function getCoopV2Shadow(");
  const end = coopRuntime.indexOf("\nexport function ", start + 1);
  assert.notEqual(start, -1, "runtime exposes the Authority V2 harness resolver");
  assert.notEqual(end, -1, "runtime resolver has a bounded source block");
  const resolver = coopRuntime.slice(start, end);
  const identity = resolver.indexOf("const identity = resolveCoopV2ShadowIdentity(runtime);");
  const unavailable = resolver.indexOf("if (identity == null)");
  const existing = resolver.indexOf("const existing = coopV2ShadowHarnesses.get(runtime);");
  const rebind = resolver.indexOf("existing.rebindIdentity(identity);");
  assert.ok(identity >= 0 && unavailable > identity, "replacement identity is resolved and required");
  assert.ok(existing > unavailable && rebind > existing, "a retained harness is rebound only after identity proof");
  assert.match(resolver, /reasonCode:\s*"binding-mismatch"/u, "a rejected rebind fails the shared session closed");
});
