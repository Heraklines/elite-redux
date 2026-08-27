#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const CONTRACT_PATH = resolve(ROOT, "rust/contracts/m7-contract.toml");

function fail(message) {
  throw new Error(`M7 contract check: ${message}`);
}

function parseContract(text) {
  const values = new Map();
  for (const [index, rawLine] of text.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const match = /^([a-z0-9_]+)\s*=\s*(.+)$/u.exec(line);
    if (!match) {
      fail(`unsupported TOML at line ${index + 1}`);
    }
    const [, key, encoded] = match;
    let value;
    if (encoded.startsWith('"')) {
      value = JSON.parse(encoded);
    } else if (encoded === "true" || encoded === "false") {
      value = encoded === "true";
    } else if (/^-?\d+$/u.test(encoded)) {
      value = Number(encoded);
    } else {
      fail(`unsupported value for ${key}`);
    }
    if (values.has(key)) {
      fail(`duplicate contract key ${key}`);
    }
    values.set(key, value);
  }
  return values;
}

function required(contractValues, key) {
  if (!contractValues.has(key)) {
    fail(`missing contract key ${key}`);
  }
  return contractValues.get(key);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(ROOT, path), "utf8"));
}
function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function fileSha256(path) {
  const bytes = `${JSON.stringify(canonicalize(readJson(path)))}\n`;
  return createHash("sha256").update(bytes).digest("hex");
}

function uniqueIds(entries, label) {
  const ids = new Set();
  for (const entry of entries) {
    if (typeof entry.id !== "string" || !/^[0-9a-f]{64}$/u.test(entry.id)) {
      fail(`${label} has invalid identity`);
    }
    if (ids.has(entry.id)) {
      fail(`${label} has duplicate identity ${entry.id}`);
    }
    ids.add(entry.id);
  }
  return ids;
}

const contract = parseContract(readFileSync(CONTRACT_PATH, "utf8"));
const selection = readJson("rust/fixtures/m7/oracle-selection.json");
const m6Final = readJson("rust/fixtures/m6/m6-final-qualification.json");
assertEqual(required(contract, "m7_base_sha"), m6Final.sha, "M7 base SHA");
assertEqual(required(contract, "m6_gate_run_id"), m6Final.gate_run_id, "M6 gate run");
assertEqual(required(contract, "m7_oracle_sha"), selection.oracle_sha, "M7 oracle SHA");
assertEqual(required(contract, "m7_oracle_tree_sha"), selection.oracle_tree_sha, "M7 oracle tree SHA");
assertEqual(required(contract, "production_typescript_read_only"), true, "production TypeScript policy");

const files = [
  ["game_system_catalog_sha256", "rust/fixtures/m7/game-system-catalog-v1.json"],
  ["run_behavior_manifest_sha256", "rust/fixtures/m7/run-behavior-unit-manifest-v1.json"],
  ["scenario_catalog_sha256", "rust/fixtures/m7/scenario-catalog-v1.json"],
  ["ai_policy_catalog_sha256", "rust/fixtures/m7/ai-policy-catalog-v1.json"],
  ["save_field_catalog_sha256", "rust/fixtures/m7/save-field-catalog-v1.json"],
  ["platform_boundary_manifest_sha256", "rust/fixtures/m7/platform-boundary-manifest-v1.json"],
  ["gap_cluster_manifest_sha256", "rust/fixtures/m7/m7-gap-clusters-v1.json"],
  ["oracle_witness_plan_sha256", "rust/fixtures/m7/m7-oracle-witness-plan-v1.json"],
  ["behavior_implementation_manifest_sha256", "rust/fixtures/m7/m7-behavior-implementation-v1.json"],
  ["performance_security_audit_sha256", "rust/fixtures/m7/performance-security-audit-v1.json"],
  ["legacy_bridge_audit_sha256", "rust/fixtures/m7/legacy-bridge-audit-v1.json"],
  ["m6_catalog_drift_sha256", "rust/fixtures/m7/m6-catalog-drift-v1.json"],
  ["m6_semantic_drift_sha256", "rust/fixtures/m7/m6-semantic-drift-v1.json"],
  ["historical_oracle_drift_sha256", "rust/fixtures/m7/m7-oracle-fixture-drift-v1.json"],
];
for (const [key, path] of files) {
  assertEqual(fileSha256(path), required(contract, key), path);
}

const game = readJson("rust/fixtures/m7/game-system-catalog-v1.json");
assertEqual(game.oracle_sha, selection.oracle_sha, "game-system oracle SHA");
assertEqual(game.oracle_tree_sha, selection.oracle_tree_sha, "game-system oracle tree SHA");
assertEqual(game.source_file_count, required(contract, "source_file_count"), "source file count");
assertEqual(game.behavior_count, required(contract, "game_behavior_count"), "game behavior count");
assertEqual(game.behaviors.length, game.behavior_count, "game behavior length");
const gameIds = uniqueIds(game.behaviors, "game behavior catalog");
const expectedDomains = new Map([
  ["AI_MODES", "ai_behavior_count"],
  ["BATTLE", "battle_behavior_count"],
  ["M6_PROTOCOL", "m6_protocol_behavior_count"],
  ["CAPTURE_PARTY", "capture_party_behavior_count"],
  ["CONTROL", "control_behavior_count"],
  ["INVENTORY_ECONOMY", "inventory_economy_behavior_count"],
  ["PLATFORM", "platform_boundary_count"],
  ["PRESENTATION", "presentation_boundary_count"],
  ["PROGRESSION", "progression_behavior_count"],
  ["QUEST_FACTION", "quest_faction_behavior_count"],
  ["RUN_META", "run_meta_behavior_count"],
  ["SAVE_REPLAY_PROFILE", "save_field_owner_behavior_count"],
  ["SCENARIO", "scenario_only_behavior_count"],
  ["WORLD", "world_behavior_count"],
]);
for (const [domain, key] of expectedDomains) {
  const count = game.domain_counts[domain] ?? 0;
  if (key === "save_field_owner_behavior_count" || key === "scenario_only_behavior_count") {
    if (!Number.isSafeInteger(count) || count < 0) {
      fail(`invalid ${domain} domain count`);
    }
  } else {
    assertEqual(count, required(contract, key), `${domain} domain count`);
  }
}

const run = readJson("rust/fixtures/m7/run-behavior-unit-manifest-v1.json");
assertEqual(run.behavior_count, required(contract, "run_behavior_count"), "run behavior count");
assertEqual(run.behaviors.length, run.behavior_count, "run behavior length");
for (const unit of run.behaviors) {
  if (!gameIds.has(unit.id)) {
    fail(`run behavior ${unit.id} is absent from game catalog`);
  }
  if (unit.domain === "BATTLE" || unit.domain === "PLATFORM" || unit.domain === "PRESENTATION") {
    fail(`run behavior ${unit.id} has excluded domain ${unit.domain}`);
  }
}

for (const [path, countKey] of [
  ["rust/fixtures/m7/scenario-catalog-v1.json", "scenario_behavior_count"],
  ["rust/fixtures/m7/ai-policy-catalog-v1.json", "ai_behavior_count"],
]) {
  const catalog = readJson(path);
  assertEqual(catalog.behavior_count, required(contract, countKey), `${path} count`);
  assertEqual(catalog.behaviors.length, catalog.behavior_count, `${path} length`);
  for (const unit of catalog.behaviors) {
    if (!gameIds.has(unit.id)) {
      fail(`${path} contains unknown behavior ${unit.id}`);
    }
  }
}

const save = readJson("rust/fixtures/m7/save-field-catalog-v1.json");
assertEqual(save.field_count, required(contract, "save_field_count"), "save field count");
assertEqual(save.fields.length, save.field_count, "save field length");
uniqueIds(save.fields, "save field catalog");

const platform = readJson("rust/fixtures/m7/platform-boundary-manifest-v1.json");
assertEqual(platform.boundary_count, required(contract, "platform_boundary_count"), "platform boundary count");
assertEqual(platform.boundaries.length, platform.boundary_count, "platform boundary length");
for (const boundary of platform.boundaries) {
  if (!gameIds.has(boundary.id) || boundary.implementation_status !== "PLATFORM_EFFECT") {
    fail(`invalid platform boundary ${boundary.id}`);
  }
}

const gaps = readJson("rust/fixtures/m7/m7-gap-clusters-v1.json");
assertEqual(gaps.gap_count, required(contract, "initial_m7_gap_count"), "initial M7 gap count");
const clusteredGapIds = gaps.clusters.flatMap(cluster => cluster.behavior_units);
assertEqual(clusteredGapIds.length, gaps.gap_count, "clustered gap count");
if (new Set(clusteredGapIds).size !== clusteredGapIds.length) {
  fail("duplicate gap classification");
}
const runGapIds = new Set(
  run.behaviors.filter(unit => unit.implementation_status === "REQUIRES_M7").map(unit => unit.id),
);
for (const id of clusteredGapIds) {
  if (!runGapIds.has(id)) {
    fail(`gap ${id} is not a required M7 run behavior`);
  }
}
assertEqual(runGapIds.size, clusteredGapIds.length, "complete gap classification");

const implementations = readJson("rust/fixtures/m7/m7-behavior-implementation-v1.json");
assertEqual(
  implementations.implementation_count,
  required(contract, "implemented_behavior_count"),
  "implemented behavior count",
);
assertEqual(
  implementations.implementations.length,
  implementations.implementation_count,
  "implementation evidence length",
);
const implementedIds = new Set();
for (const entry of implementations.implementations) {
  if (
    !runGapIds.has(entry.behavior_unit)
    || implementedIds.has(entry.behavior_unit)
    || !["COMPILED", "BESPOKE_IMPLEMENTED", "SEMANTICALLY_INERT"].includes(entry.status)
    || typeof entry.rust_symbol !== "string"
    || entry.rust_symbol.length === 0
    || entry.proof?.kind !== "RUST_TEST"
    || !existsSync(resolve(ROOT, entry.proof.path))
  ) {
    fail(`invalid implementation evidence ${entry.behavior_unit}`);
  }
  implementedIds.add(entry.behavior_unit);
}

const witnesses = readJson("rust/fixtures/m7/m7-oracle-witness-plan-v1.json");
assertEqual(witnesses.witness_count, required(contract, "oracle_witness_count"), "oracle witness count");
assertEqual(witnesses.witnesses.length, witnesses.witness_count, "oracle witness length");
const witnessIds = new Set();
for (const witness of witnesses.witnesses) {
  if (!gameIds.has(witness.behavior_unit) || witnessIds.has(witness.behavior_unit)) {
    fail(`invalid or duplicate witness ${witness.behavior_unit}`);
  }
  witnessIds.add(witness.behavior_unit);
}

const architecture = readJson("rust/fixtures/m7/performance-security-audit-v1.json");
const legacy = readJson("rust/fixtures/m7/legacy-bridge-audit-v1.json");
const historicalDrift = readJson("rust/fixtures/m7/m7-oracle-fixture-drift-v1.json");
assertEqual(
  architecture.error_count,
  required(contract, "initial_architecture_error_count"),
  "architecture baseline errors",
);
assertEqual(
  legacy.occurrence_count,
  required(contract, "initial_legacy_bridge_occurrence_count"),
  "legacy baseline occurrences",
);
assertEqual(
  historicalDrift.m3.counts.SEMANTIC_CHANGE,
  required(contract, "m3_semantic_drift_count"),
  "M3 semantic drift count",
);
assertEqual(
  historicalDrift.m3.counts.PROVENANCE_ONLY,
  required(contract, "m3_provenance_drift_count"),
  "M3 provenance drift count",
);
assertEqual(
  historicalDrift.m4.counts.SEMANTIC_CHANGE,
  required(contract, "m4_semantic_drift_count"),
  "M4 semantic drift count",
);
assertEqual(
  historicalDrift.m4.counts.PROVENANCE_ONLY,
  required(contract, "m4_provenance_drift_count"),
  "M4 provenance drift count",
);
for (const key of [
  "final_unclassified_behavior_count",
  "final_unsupported_behavior_count",
  "final_pending_bespoke_count",
  "final_duplicate_classification_count",
  "final_unknown_platform_boundary_count",
  "final_legacy_bridge_occurrence_count",
  "final_architecture_error_count",
]) {
  assertEqual(required(contract, key), 0, key);
}

for (const path of ["rust/contracts/m7-api.md", "rust/contracts/m7-ownership.toml"]) {
  if (!existsSync(resolve(ROOT, path)) || readFileSync(resolve(ROOT, path), "utf8").trim() === "") {
    fail(`missing contract surface ${path}`);
  }
}
console.log(
  `M7 contract check: ${game.behavior_count} behaviors, ${run.behavior_count} run behaviors, ${gaps.gap_count} initial gaps`,
);
