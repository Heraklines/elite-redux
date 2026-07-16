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
  assert.match(workflow, /^\s*group:\s*deploy-staging\s*$/mu);
  assert.match(workflow, /^\s*cancel-in-progress:\s*false\s*$/mu);

  const build = requiredOffset("- name: Build standalone bundle");
  const verify = requiredOffset("- name: Verify assembled dist");
  const contract = requiredOffset("- name: Verify staging promotion contract");
  const worker = requiredOffset("- name: Deploy cloud-save API (staging)");
  const pages = requiredOffset("- name: Deploy to Cloudflare Pages (staging)");

  assert.ok(build < verify, "the browser bundle must build before it is verified");
  assert.ok(verify < contract, "the assembled bundle must verify before the promotion contract runs");
  assert.ok(contract < worker, "all local verification must finish before the Worker mutates");
  assert.ok(worker < pages, "the save contract must be live before the matching browser is published");
});
