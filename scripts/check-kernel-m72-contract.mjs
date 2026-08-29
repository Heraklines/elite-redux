#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const BASE_TAG = "rust-kernel-m7-devplane-final";
const BASE_SHA = "79e3544029e422deb8389a12f8b75e7f0febfb3e";
const fail = message => {
  throw new Error(`M7.2 contract check: ${message}`);
};
const read = path => readFileSync(resolve(ROOT, path), "utf8");
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

if (git("rev-parse", `${BASE_TAG}^{commit}`) !== BASE_SHA) {
  fail("frozen M7.1 tag does not resolve to the G34 SHA");
}

const attestation = JSON.parse(read("rust/fixtures/m72/m71-final-attestation.json"));
if (
  attestation.schema_version !== 1
  || attestation.commit_sha !== BASE_SHA
  || attestation.tag !== BASE_TAG
  || attestation.g34_run_id !== 33224176335
  || attestation.g34_conclusion !== "success"
  || attestation.g34_job_count !== 17
  || attestation.g34_non_successful_job_count !== 0
) {
  fail("M7.1 final attestation mismatch");
}

const requiredFiles = [
  "rust/contracts/m72-contract.toml",
  "rust/contracts/m72-api.md",
  "rust/contracts/m72-ownership.toml",
  "rust/contracts/m72-error-policy.md",
  "rust/contracts/m72-performance.md",
  "rust/contracts/m72-architecture-simplification.md",
  "rust/fixtures/m72/m72-slice-manifest.json",
  "rust/fixtures/m72/architecture-manifest.json",
  "docs/plans/rust-kernel/m72-oracle-extraction.md",
];
for (const file of requiredFiles) {
  if (read(file).trim().length === 0) {
    fail(`required contract is empty: ${file}`);
  }
}

const contract = read("rust/contracts/m72-contract.toml");
const requiredValues = new Map();
for (const line of contract.split(/\r?\n/u)) {
  const match = line.match(/^([a-z0-9_]+)\s*=\s*(.+)$/u);
  if (match) requiredValues.set(match[1], match[2].replace(/^"|"$/gu, ""));
}
const requireValue = (key, expected) => {
  if (requiredValues.get(key) !== String(expected)) {
    fail(`contract ${key} differs from ${expected}`);
  }
};
requireValue("m71_final_sha", BASE_SHA);
requireValue("m71_g34_run_id", 33224176335);
for (const key of [
  "bootstrap_machine_version",
  "new_run_material_version",
  "scenario_specification_version",
  "scenario_reachability_version",
  "scenario_preset_version",
  "artifact_store_version",
  "query_protocol_version",
  "legality_evidence_version",
  "navigation_plan_version",
  "lab_daemon_version",
  "experiment_plan_version",
  "coverage_target_version",
  "failure_fingerprint_version",
  "counterfactual_query_version",
  "bisect_report_version",
  "regression_corpus_version",
  "mutation_plan_version",
  "content_diff_version",
  "content_reload_version",
  "architecture_manifest_version",
]) requireValue(key, 1);
requireValue("warm_preset_session_millis", 20);
requireValue("snapshot_restore_millis", 20);
requireValue("scenario_construction_millis", 250);
requireValue("navigation_planning_millis", 2);
requireValue("state_control_query_millis", 5);
requireValue("ten_thousand_jsonl_millis", 2000);
requireValue("thousand_session_forks_millis", 10000);

const architecture = JSON.parse(read("rust/fixtures/m72/architecture-manifest.json"));
if (architecture.schema_version !== 1 || architecture.m71_base_sha !== BASE_SHA) {
  fail("architecture manifest identity mismatch");
}
const concerns = architecture.current_owners.map(entry => entry.concern);
if (
  new Set(concerns).size !== concerns.length
  || concerns.some((value, index) => index > 0 && concerns[index - 1] >= value)
  || architecture.new_crate_budget.join(",") !== "er-lab"
) {
  fail("architecture current owners are duplicated, unsorted, or over budget");
}

const slice = JSON.parse(read("rust/fixtures/m72/m72-slice-manifest.json"));
if (
  slice.schema_version !== 1
  || slice.oracle_sha !== "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7"
  || !slice.startup_stages.includes("SAVE_SELECT")
  || slice.post_initialization_policy !== "RAW_PHYSICAL_INPUT_AND_EXTERNAL_EVENTS_ONLY"
) {
  fail("M7.2 slice manifest mismatch");
}

const changedTs = git("diff", "--name-only", BASE_TAG, "--", "src", "test", "scripts/export-kernel-m3-oracle.mjs")
  .split(/\r?\n/u)
  .filter(Boolean);
if (changedTs.length !== 0) {
  fail(`production/oracle TypeScript changed: ${changedTs.join(", ")}`);
}

const changedM71 = git("diff", "--name-only", BASE_TAG, "--", "rust/contracts/m71-*", "rust/fixtures/m71")
  .split(/\r?\n/u)
  .filter(Boolean);
if (changedM71.length !== 0) {
  fail(`frozen M7.1 qualification artifact changed: ${changedM71.join(", ")}`);
}

const coreCrates = ["er-state", "er-battle", "er-run", "er-game", "er-kernel", "er-protocol", "er-mechanics"];
for (const crate of coreCrates) {
  const manifest = read(`rust/crates/${crate}/Cargo.toml`);
  if (manifest.includes("er-lab")) {
    fail(`forbidden dependency ${crate} -> er-lab`);
  }
}

const api = read("rust/contracts/m72-api.md");
for (const requirement of [
  "Natural begins at Title",
  "ScenarioReachabilityV1",
  "control.plan_navigation",
  "er-cli agent --protocol jsonl --warm",
  "GOOD, BAD, or INCOMPATIBLE",
  "Native code hotpatching is forbidden",
]) {
  if (!api.includes(requirement)) fail(`API contract omits ${requirement}`);
}

console.log(`M7.2 contract freeze: base ${BASE_SHA}, one er-lab crate budget, oracle locked`);
