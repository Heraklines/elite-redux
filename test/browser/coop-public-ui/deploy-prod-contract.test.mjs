import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(new URL("../../../.github/workflows/deploy-prod.yml", import.meta.url), "utf8");
const commandUiHandler = readFileSync(
  new URL("../../../src/ui/handlers/command-ui-handler.ts", import.meta.url),
  "utf8",
);

function requiredOffset(fragment) {
  const offset = workflow.indexOf(fragment);
  assert.notEqual(offset, -1, `deploy-prod.yml must contain ${JSON.stringify(fragment)}`);
  return offset;
}

test("production verifies one save-worker and browser contract before publishing", () => {
  assert.match(workflow, /^\s*group:\s*deploy-prod\s*$/mu);
  assert.match(workflow, /^\s*cancel-in-progress:\s*false\s*$/mu);

  const sealSource = requiredOffset("- name: Seal exact promotion source");
  const build = requiredOffset("- name: Build standalone bundle");
  const verify = requiredOffset("- name: Verify assembled dist");
  const contract = requiredOffset("- name: Verify production promotion contract");
  const worker = requiredOffset("- name: Deploy cloud-save API (production)");
  const pages = requiredOffset("- name: Deploy to Cloudflare Pages (PRODUCTION)");

  assert.ok(sealSource < build, "the checked-out source must be sealed before the browser build");
  assert.ok(build < verify, "the browser bundle must build before verification");
  assert.ok(verify < contract, "the assembled bundle must verify before the production contract");
  assert.ok(contract < worker, "all local verification must finish before production mutates");
  assert.ok(worker < pages, "the production save contract must be live before the browser is published");
});

test("production uses shared telemetry while excluding co-op and developer bindings", () => {
  assert.match(workflow, /echo "VITE_SERVER_URL=https:\/\/er-save-api\.heraklines\.workers\.dev"/u);
  assert.match(workflow, /echo "VITE_SERVER_URL_TELEMETRY=https:\/\/er-telemetry\.heraklines\.workers\.dev"/u);
  assert.match(workflow, /command: deploy --config workers\/er-save-api\/wrangler\.toml/u);
  assert.doesNotMatch(workflow, /echo "VITE_DEV_TOOLS=/u);
  assert.doesNotMatch(workflow, /VITE_ENABLE_SHOWDOWN_TOURNAMENTS/u);
  assert.doesNotMatch(workflow, /VITE_COOP_SERVER_URL/u);
  assert.doesNotMatch(workflow, /workers\/er-coop-api/u);
  assert.doesNotMatch(workflow, /wrangler\.staging\.toml/u);
});

test("the player Reset command is independent of staging developer tools", () => {
  assert.match(commandUiHandler, /i18next\.t\("commandUiHandler:reset"\)/u);
  assert.match(commandUiHandler, /case Command\.RESET/u);
  assert.doesNotMatch(commandUiHandler, /isDevToolsEnabled|VITE_DEV_TOOLS|resetEnabled/u);
});
