#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const M81_SHA = "1b9b167ded66a2dcef842a8aae5789c08d9f6d5b";
const M81_TAG = "rust-kernel-m81-final";
const M81_G47 = "33271954731";
const read = path => readFileSync(resolve(ROOT, path), "utf8");
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
const fail = message => {
  throw new Error(`M9 contract check: ${message}`);
};

if (git("rev-parse", `${M81_TAG}^{commit}`) !== M81_SHA) {
  fail("M8.1 final tag mismatch");
}
const contracts = [
  "m9-contract.toml",
  "m9-release-manifest.md",
  "m9-runtime-assignment.md",
  "m9-save-migration.md",
  "m9-generation-management.md",
  "m9-rollout.md",
  "m9-rollback.md",
  "m9-observability.md",
  "m9-security.md",
  "m9-performance.md",
  "m9-ownership.toml",
];
for (const name of contracts) {
  if (read(`rust/contracts/${name}`).trim().length === 0) {
    fail(`missing contract ${name}`);
  }
}
const lock = read("rust/contracts/m9-contract.toml");
for (const required of [
  M81_SHA,
  M81_TAG,
  M81_G47,
  'production_default_after_cutover = "RUST_PRODUCTION"',
  'signature_algorithm = "ED25519"',
  "build once; promote identical bytes",
  "copy-on-write migration",
  "mixed authority peers forbidden",
]) {
  if (!lock.includes(required)) {
    fail(`contract lock is missing ${required}`);
  }
}
const workspace = read("rust/Cargo.toml");
if (!workspace.includes('"crates/er-production"') || !workspace.includes("ed25519-dalek")) {
  fail("er-production or Ed25519 verifier is absent from workspace");
}
for (const path of [
  "docs/plans/rust-kernel/m9-production-boundary-inventory.md",
  "docs/plans/rust-kernel/m9-security-audit.md",
  "rust/fixtures/m9/m9-legacy-authority-import-map.json",
  "rust/fixtures/m9/m9-save-migration-corpus.json",
  "rust/fixtures/m9/m9-platform-api-map.json",
  "rust/fixtures/m9/m9-coop-rollout-map.json",
  "rust/fixtures/m9/m9-release-artifact-map.json",
  "rust/fixtures/m9/m9-rollout-baseline.json",
]) {
  if (read(path).trim().length === 0) {
    fail(`missing audit output ${path}`);
  }
}
const security = read("docs/plans/rust-kernel/m9-security-audit.md");
for (const finding of [
  "M9-SEC-001",
  "M9-SEC-002",
  "M9-SEC-003",
  "M9-SEC-004",
  "M9-SEC-005",
  "M9-SEC-006",
  "M9-SEC-007",
  "M9-SEC-008",
]) {
  if (!security.includes(finding)) {
    fail(`security audit omits ${finding}`);
  }
}
for (const path of [
  "src/rust-browser/production/release-keys.ts",
  "src/rust-browser/production/configured-production-main.ts",
  "src/rust-browser/production/release-cache-v2.ts",
  "scripts/seal-kernel-m9-release.mjs",
  ".github/workflows/build-m9-release.yml",
  ".github/workflows/publish-m9-release.yml",
  ".github/workflows/promote-m9-rollout.yml",
  ".github/workflows/rollback-m9-rollout.yml",
  ".github/workflows/m9-production-health.yml",
]) {
  if (read(path).trim().length === 0) {
    fail(`missing M9 release-control surface ${path}`);
  }
}
const productionMain = read("src/main.ts");
if (
  !productionMain.includes("startConfiguredProductionMainV1")
  || productionMain.includes("battle-scene")
  || productionMain.includes("startUpdateChecker")
) {
  fail("production entry is not Rust-first and minimal");
}
for (const workflow of ["promote-m9-rollout.yml", "rollback-m9-rollout.yml"]) {
  if (read(`.github/workflows/${workflow}`).includes("pnpm build")) {
    fail(`${workflow} rebuilds an immutable release`);
  }
}
console.log(
  `M9 G48 contract freeze: M8.1 ${M81_SHA}, G47 ${M81_G47}, ${contracts.length} contracts, eight security blockers classified`,
);
