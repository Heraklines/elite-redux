import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(new URL("../../../.github/workflows/deploy-staging.yml", import.meta.url), "utf8");

function requiredOffset(fragment) {
  const offset = workflow.indexOf(fragment);
  assert.notEqual(offset, -1, `deploy-staging.yml must contain ${JSON.stringify(fragment)}`);
  return offset;
}

test("staging promotes one verified browser/Worker contract without cancellable skew", () => {
  assert.match(
    workflow,
    /^\s*group:\s*\$\{\{ inputs\.operation == 'import_music' && 'er-youtube-bgm-import' \|\| 'deploy-staging' \}\}\s*$/mu,
  );
  assert.match(workflow, /^\s*cancel-in-progress:\s*false\s*$/mu);

  const build = requiredOffset("- name: Build standalone bundle");
  const sealSource = requiredOffset("- name: Seal exact promotion source");
  const verify = requiredOffset("- name: Verify assembled dist");
  const contract = requiredOffset("- name: Verify staging promotion contract");
  const resolveCoopD1 = requiredOffset("- name: Resolve isolated co-op D1 and seal staging Worker config");
  const worker = requiredOffset("- name: Deploy cloud-save API (staging)");
  const coopWorker = requiredOffset("- name: Deploy co-op signaling API (staging)");
  const coopHealth = requiredOffset("- name: Verify staging P33 signaling contract");
  const pages = requiredOffset("- name: Deploy to Cloudflare Pages (staging)");

  assert.ok(sealSource < build, "the exact checked-out source must be sealed before the browser build");
  assert.ok(build < verify, "the browser bundle must build before it is verified");
  assert.ok(verify < contract, "the assembled bundle must verify before the promotion contract runs");
  assert.ok(contract < resolveCoopD1, "all local verification must finish before staging bindings are resolved");
  assert.ok(resolveCoopD1 < worker, "D1 isolation must be proven before any Worker mutates");
  assert.ok(worker < coopWorker, "the save identity contract must be live before signaling is published");
  assert.ok(coopWorker < coopHealth, "the co-op Worker must be deployed before it is attested");
  assert.ok(coopHealth < pages, "P33 must be healthy at the exact SHA before the browser is published");
});

test("staging browser and signaling deployment are pinned to P33 without production bindings", () => {
  assert.match(workflow, /echo "VITE_COOP_SERVER_URL=https:\/\/er-coop-api-staging\.heraklines\.workers\.dev"/u);
  assert.match(workflow, /echo "VITE_COOP_SIGNALING_PROTOCOL=p33"/u);
  assert.match(workflow, /echo "VITE_COOP_AUTHORITY_V2_TURN=on"/u);
  assert.match(workflow, /echo "VITE_COOP_AUTHORITY_V2_REPLACEMENT=on"/u);
  assert.match(workflow, /echo "VITE_COOP_AUTHORITY_V2_WAVE=on"/u);
  assert.match(workflow, /echo "VITE_COOP_AUTHORITY_V2_RECOVERY=on"/u);
  assert.match(workflow, /node scripts\/materialize-coop-staging-config\.mjs/u);
  assert.match(workflow, /command: deploy --config workers\/er-coop-api\/wrangler\.generated\.staging\.toml/u);
  assert.match(workflow, /\.sourceSha == \$sha/u);
  assert.match(workflow, /for attempt in \$\(seq 1 24\); do/u);
  assert.match(workflow, /Cache-Control: no-cache/u);
  assert.match(workflow, /source_sha=\$\{PROMOTED_SHA\}&attempt=\$\{attempt\}/u);
  assert.doesNotMatch(workflow, /command: deploy --config workers\/er-coop-api\/wrangler\.toml/u);
});
