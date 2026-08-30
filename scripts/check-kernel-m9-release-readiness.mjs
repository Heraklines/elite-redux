#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFileSync(resolve(root, path), "utf8");
const fail = message => {
  throw new Error(`M9 release readiness: ${message}`);
};
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

if (git("rev-parse", "rust-kernel-m81-final^{commit}") !== "1b9b167ded66a2dcef842a8aae5789c08d9f6d5b") {
  fail("M8.1 final tag moved");
}
git("merge-base", "--is-ancestor", "rust-kernel-m81-final", "HEAD");

const main = read("src/main.ts");
if (!main.includes("startConfiguredProductionMainV1") || main.includes("?runtime=") || main.includes("localStorage")) {
  fail("production selector is not immutable Rust-first");
}

const productionGraph = [
  "src/main.ts",
  "src/rust-browser/production/configured-production-main.ts",
  "src/rust-browser/production/bootstrap.ts",
  "src/rust-browser/production/rust-production-entry.ts",
  "src/rust-browser/routes/rust-phaser-entry.ts",
]
  .map(read)
  .join("\n");
for (const forbidden of [
  "../../battle-scene",
  "hot-reload/dev-controls",
  "window.location.reload",
  "AuthorityResolutionPlan",
]) {
  if (productionGraph.includes(forbidden)) {
    fail(`production graph includes forbidden legacy/debug authority: ${forbidden}`);
  }
}

const transport = read("src/rust-browser/adapters/transport-adapter.ts");
const frame = read("src/rust-browser/production/coop-frame.ts");
if (
  !transport.includes("signCoopFrameV1")
  || !transport.includes("verifyCoopFrameV1")
  || !transport.includes("expectedSequence")
  || transport.includes("this.#generations.current()")
  || !frame.includes("er-m9:coop-frame-v1")
  || !frame.includes("payload_sha256")
  || !frame.includes("verifySignedCoopFrameBindingV1")
) {
  fail("public co-op frame authentication or replay fencing is absent");
}
const rustHost = read("rust/crates/er-web/src/host.rs");
if (!rustHost.includes("if *generation != protocol_generation(kernel)?")) {
  fail("Rust network frame generation defense is absent");
}

const health = read("src/rust-browser/production/health-event.ts");
const healthWorker = read("workers/er-telemetry/src/m9-health.ts");
for (const required of [
  "ProductionHealthEventV1",
  "hard_stop_rule",
  "input_event_aggregate_hash",
  "aggregatePerformanceSummaryV1",
  "failureFingerprintV1",
]) {
  if (!health.includes(required) && !healthWorker.includes(required)) {
    fail(`production health contract is incomplete: ${required}`);
  }
}
for (const forbidden of ["raw_save", "raw_input_history", "refresh_token", "full_party"]) {
  if (health.includes(forbidden) || healthWorker.includes(forbidden)) {
    fail(`bounded default telemetry includes forbidden field: ${forbidden}`);
  }
}

const buildWorkflow = read(".github/workflows/build-m9-release.yml");
const publishWorkflow = read(".github/workflows/publish-m9-release.yml");
const promoteWorkflow = read(".github/workflows/promote-m9-rollout.yml");
const rollbackWorkflow = read(".github/workflows/rollback-m9-rollout.yml");
if (
  !buildWorkflow.includes("Sign and independently verify release")
  || !publishWorkflow.includes("Verify immutable release before publication")
) {
  fail("immutable build/publish verification is absent");
}
for (const [name, workflow] of [
  ["promotion", promoteWorkflow],
  ["rollback", rollbackWorkflow],
]) {
  if (workflow.includes("pnpm build") || workflow.includes("cargo build") || workflow.includes("vite build")) {
    fail(`${name} rebuilds qualified release bytes`);
  }
}
if (
  !promoteWorkflow.includes("expected_current_policy_hash")
  || !rollbackWorkflow.includes("M9_RELEASE_SIGNING_PRIVATE_KEY")
) {
  fail("protected policy promotion or signed rollback is absent");
}

for (const required of [
  ".github/workflows/rust-kernel-m9-g48.yml",
  ".github/workflows/rust-kernel-m9-g49.yml",
  ".github/workflows/rust-kernel-m9-g50.yml",
  ".github/workflows/rust-kernel-m9-g51.yml",
  ".github/workflows/rust-kernel-m9-g52.yml",
]) {
  read(required);
}

process.stdout.write(`M9 release-readiness audit passed for ${git("rev-parse", "HEAD")}\n`);
