#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

function fail(message) {
  throw new Error(`M7 closure gate: ${message}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(ROOT, path), "utf8"));
}

const argumentsMap = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || value === undefined) {
    fail("arguments must be --name value pairs");
  }
  argumentsMap.set(key, value);
}
const reportPath = argumentsMap.get("--report");
if (!reportPath || !isAbsolute(reportPath)) {
  fail("--report must be an absolute path");
}

const run = readJson("rust/fixtures/m7/run-behavior-unit-manifest-v1.json");
const scenarios = readJson("rust/fixtures/m7/scenario-catalog-v1.json");
const ai = readJson("rust/fixtures/m7/ai-policy-catalog-v1.json");
const gaps = readJson("rust/fixtures/m7/m7-gap-clusters-v1.json");

function unresolved(catalog) {
  return catalog.behaviors.filter(behavior => behavior.implementation_status === "REQUIRES_M7");
}

const requiredCampaigns = [
  "rust/crates/er-testkit/tests/m7_raw_key_solo.rs",
  "rust/crates/er-testkit/tests/m7_raw_key_coop.rs",
  "rust/crates/er-testkit/tests/m7_full_run_differential.rs",
  "rust/crates/er-testkit/tests/m7_randomized_campaigns.rs",
];
const report = {
  schema_version: 1,
  run_unresolved: unresolved(run).length,
  scenario_unresolved: unresolved(scenarios).length,
  ai_unresolved: unresolved(ai).length,
  clustered_gaps: gaps.gap_count,
  missing_campaigns: requiredCampaigns.filter(path => !existsSync(resolve(ROOT, path))),
  final_qualification_manifest: existsSync(resolve(ROOT, "rust/fixtures/m7/m7-final-qualification.json")),
};
writeFileSync(reportPath, `${JSON.stringify(report)}\n`);
const closed =
  report.run_unresolved === 0
  && report.scenario_unresolved === 0
  && report.ai_unresolved === 0
  && report.clustered_gaps === 0
  && report.missing_campaigns.length === 0
  && report.final_qualification_manifest;
if (!closed) {
  fail(JSON.stringify(report));
}
console.log("M7 closure gate: complete game behavior and campaign closure is green");
