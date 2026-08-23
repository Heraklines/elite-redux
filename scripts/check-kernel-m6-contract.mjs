#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CONTRACT_PATH = resolve(ROOT, "rust/contracts/m6-contract.toml");

function fail(message) {
  throw new Error(`M6 contract check: ${message}`);
}

function parseContract(text) {
  const values = new Map();
  for (const [index, rawLine] of text.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^([a-z0-9_]+)\s*=\s*(.+)$/u.exec(line);
    if (!match) fail(`unsupported TOML at line ${index + 1}`);
    const [, key, encoded] = match;
    let value;
    if (encoded.startsWith('"')) value = JSON.parse(encoded);
    else if (encoded === "true" || encoded === "false") value = encoded === "true";
    else if (/^-?\d+$/u.test(encoded)) value = Number(encoded);
    else fail(`unsupported value for ${key}`);
    if (values.has(key)) fail(`duplicate contract key ${key}`);
    values.set(key, value);
  }
  return values;
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(ROOT, relativePath), "utf8"));
}

function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(canonical);
  const output = {};
  for (const key of Object.keys(value).sort()) output[key] = canonical(value[key]);
  return output;
}

function canonicalSha256(relativePath) {
  const value = readJson(relativePath);
  return createHash("sha256").update(`${JSON.stringify(canonical(value))}\n`).digest("hex");
}

function required(contract, key) {
  if (!contract.has(key)) fail(`missing contract key ${key}`);
  return contract.get(key);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function identityKey(identity) {
  return `${identity.kind}:${identity.numeric_id ?? ""}:${identity.registry_key ?? ""}`;
}

function behaviorKey(id) {
  return `${identityKey(id.source)}:${id.unit_kind}:${id.ordinal}:${id.provenance_hash}`;
}

const contract = parseContract(readFileSync(CONTRACT_PATH, "utf8"));
assertEqual(required(contract, "m5_base_sha"), "200caaee1697fe40a293f0a5da76af8b11f3cea9", "M5 base SHA");
assertEqual(required(contract, "m6_oracle_sha"), "3bb6d49c924293ef79e3ab2f11e10cf4f5b9c6c7", "M6 oracle SHA");
assertEqual(required(contract, "production_typescript_read_only"), true, "production TypeScript policy");

const files = [
  ["raw_source_catalog_sha256", "rust/fixtures/m6/raw-source-catalog-v2.json"],
  ["semantic_catalog_sha256", "rust/fixtures/m6/semantic-catalog-v1.json"],
  ["behavior_unit_manifest_sha256", "rust/fixtures/m6/behavior-unit-manifest-v1.json"],
  ["primitive_gap_manifest_sha256", "rust/fixtures/m6/primitive-gap-manifest-v1.json"],
  ["bespoke_cluster_manifest_sha256", "rust/fixtures/m6/bespoke-clusters-v1.json"],
  ["oracle_witness_plan_sha256", "rust/fixtures/m6/oracle-witness-plan-v1.json"],
  ["rng_site_manifest_sha256", "rust/fixtures/m6/rng-site-manifest-v1.json"],
];
for (const [key, path] of files) assertEqual(canonicalSha256(path), required(contract, key), path);

const raw = readJson("rust/fixtures/m6/raw-source-catalog-v2.json");
assertEqual(raw.species.length, required(contract, "species_count"), "species count");
assertEqual(raw.forms.length, required(contract, "form_count"), "form count");
const uniqueNumericCount = entries => new Set(entries.map(entry => entry.numeric_id).filter(Number.isSafeInteger)).size;
assertEqual(raw.moves.length, required(contract, "move_declaration_count"), "move declaration count");
assertEqual(uniqueNumericCount(raw.moves), required(contract, "move_count"), "unique move count");
assertEqual(uniqueNumericCount(raw.abilities), required(contract, "active_ability_count"), "unique ability count");
assertEqual(raw.modifier_types.length, required(contract, "held_item_modifier_count"), "held-item modifier count");

const semantic = readJson("rust/fixtures/m6/semantic-catalog-v1.json");
const units = semantic.behavior_units;
const sources = semantic.sources;
assertEqual(sources.length, required(contract, "source_identity_count"), "source identity count");
assertEqual(units.length, required(contract, "behavior_unit_count"), "behavior-unit count");
const sourceKindCount = kind => sources.filter(entry => entry.source.kind === kind).length;
assertEqual(sourceKindCount("MOVE"), required(contract, "move_count"), "move source count");
assertEqual(sourceKindCount("ACTIVE_ABILITY"), required(contract, "active_ability_count"), "active ability source count");
assertEqual(sourceKindCount("PASSIVE_ABILITY"), required(contract, "passive_ability_count"), "passive ability source count");
assertEqual(sourceKindCount("HELD_ITEM"), required(contract, "held_item_modifier_count"), "held-item source count");
assertEqual(sourceKindCount("SPECIES"), required(contract, "species_count"), "species source count");
assertEqual(sourceKindCount("FORM"), required(contract, "form_count"), "form source count");

const numericSourceKinds = new Set(["MOVE", "ACTIVE_ABILITY", "PASSIVE_ABILITY", "MAJOR_STATUS", "WEATHER", "TERRAIN", "SPECIES"]);
const sourceKeys = new Set();
for (const entry of sources) {
  const key = identityKey(entry.source);
  if (sourceKeys.has(key)) fail(`duplicate source identity ${key}`);
  sourceKeys.add(key);
  if (!Number.isSafeInteger(entry.behavior_unit_count) || entry.behavior_unit_count <= 0) fail(`invalid behavior-unit count for ${key}`);
  const source = entry.source;
  if (numericSourceKinds.has(source.kind)) {
    if (!Number.isSafeInteger(source.numeric_id) || "registry_key" in source) fail(`invalid numeric source shape ${key}`);
  } else if (typeof source.registry_key !== "string" || source.registry_key === "" || "numeric_id" in source) {
    fail(`invalid registry source shape ${key}`);
  }
}

const behaviorKeys = new Set();
const resolutions = new Map();
for (const unit of units) {
  const key = behaviorKey(unit.id);
  if (behaviorKeys.has(key)) fail(`duplicate behavior unit ${key}`);
  behaviorKeys.add(key);
  if (!sourceKeys.has(identityKey(unit.id.source))) fail(`behavior unit has unknown source ${key}`);
  const resolution = unit.semantic.resolution;
  resolutions.set(resolution, (resolutions.get(resolution) ?? 0) + 1);
}
assertEqual(resolutions.get("RESOLVED_INTRINSIC") ?? 0, required(contract, "resolved_intrinsic_count"), "resolved intrinsic count");
assertEqual(resolutions.get("RESOLVED_OPERANDS") ?? 0, required(contract, "resolved_operand_count"), "resolved operand count");
assertEqual(resolutions.get("BESPOKE_GAP") ?? 0, required(contract, "primitive_gap_count"), "primitive gap count");

const gaps = readJson("rust/fixtures/m6/primitive-gap-manifest-v1.json");
assertEqual(gaps.gap_count, required(contract, "primitive_gap_count"), "gap manifest count");
assertEqual(gaps.gaps.length, gaps.gap_count, "gap manifest length");
for (const gap of gaps.gaps) {
  if (gap.semantic.resolution !== "BESPOKE_GAP") fail(`non-gap in primitive gap manifest ${behaviorKey(gap.id)}`);
  if (!behaviorKeys.has(behaviorKey(gap.id))) fail(`unknown gap behavior unit ${behaviorKey(gap.id)}`);
}

const clusters = readJson("rust/fixtures/m6/bespoke-clusters-v1.json");
assertEqual(clusters.clusters.length, required(contract, "bespoke_cluster_count"), "bespoke cluster count");
assertEqual(clusters.clusters.reduce((sum, cluster) => sum + cluster.behavior_units.length, 0), gaps.gap_count, "clustered gap count");

const rng = readJson("rust/fixtures/m6/rng-site-manifest-v1.json");
assertEqual(rng.site_count, required(contract, "rng_site_count"), "RNG site count");
assertEqual(rng.sites.length, rng.site_count, "RNG site manifest length");
const rngKeys = new Set();
for (const site of rng.sites) {
  const key = `${site.id.ordinal}:${site.id.provenance_hash}`;
  if (rngKeys.has(key)) fail(`duplicate RNG site ${key}`);
  rngKeys.add(key);
  if (!site.domain || !site.reason) fail(`unclassified RNG site ${key}`);
  if (site.owner == null || !behaviorKeys.has(behaviorKey(site.owner))) fail(`RNG site ${key} has unknown behavior-unit owner`);
  if (!Number.isSafeInteger(site.execution_ordinal) || site.execution_ordinal < 0) fail(`RNG site ${key} has invalid execution ordinal`);
  if (site.binding_status !== "BESPOKE_GAP") fail(`RNG site ${key} unexpectedly claims executable closure`);
  if (site.range?.kind !== "SOURCE_EXPRESSION_GAP" || site.singleton_policy !== "ORACLE_UNVERIFIED_GAP" || !site.stream) {
    fail(`RNG site ${key} lacks explicit gap range/stream/singleton evidence`);
  }
}


const witnessPlan = readJson("rust/fixtures/m6/oracle-witness-plan-v1.json");
assertEqual(witnessPlan.witness_count, units.length, "witness count");
const witnesses = new Map(witnessPlan.witnesses.map(witness => [behaviorKey(witness.behavior_unit), witness]));
for (const site of rng.sites) {
  const witness = witnesses.get(behaviorKey(site.owner));
  if (witness == null) fail(`RNG site ${site.id.ordinal} owner lacks witness`);
  if (!witness.rng_contract.some(id => JSON.stringify(id) === JSON.stringify(site.id))) {
    fail(`RNG site ${site.id.ordinal} is absent from owner witness contract`);
  }
}
for (const path of [
  "docs/plans/rust-kernel/m6-semantic-extraction.md",
  "docs/plans/rust-kernel/m6-trigger-order.md",
  "docs/plans/rust-kernel/m6-query-order.md",
  "docs/plans/rust-kernel/m6-targeting.md",
  "docs/plans/rust-kernel/m6-rng-sites.md",
  "docs/plans/rust-kernel/m6-migration-performance.md",
  "rust/contracts/m6-api.md",
  "rust/contracts/m6-mechanics-ir.md",
  "rust/contracts/m6-state-snapshot.md",
  "rust/contracts/m6-ownership.toml",
]) {
  if (!existsSync(resolve(ROOT, path))) fail(`missing frozen evidence ${path}`);
}

console.log(`M6 contract check: ${sources.length} sources, ${units.length} behavior units, ${gaps.gap_count} gaps, ${rng.site_count} RNG sites`);
