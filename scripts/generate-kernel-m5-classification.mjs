#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CATALOG_PATH = resolve(ROOT, "rust/fixtures/m5/source-catalog-v1.json");
const OUTPUT_ROOT = resolve(ROOT, "rust/fixtures/m5");
const ORACLE_SHA = "328824692f95b1aa1b38af85b54a6b72d9259eb4";

function fail(message) {
  throw new Error(`M5 classification generator: ${message}`);
}

function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  const output = {};
  for (const key of Object.keys(value).sort()) {
    output[key] = canonical(value[key]);
  }
  return output;
}

function writeJson(name, value) {
  const path = resolve(OUTPUT_ROOT, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(canonical(value))}\n`);
}

function numeric(kind, entry, programs = []) {
  if (Number.isSafeInteger(entry.numeric_id)) {
    return classification({ kind, numeric_id: entry.numeric_id, registry_key: null }, programs);
  }
  if (typeof entry.member === "string" && entry.member.length > 0) {
    return classification({ kind, numeric_id: null, registry_key: entry.member }, programs);
  }
  fail(`${kind}/${String(entry.member)} has no stable identity`);
}
function registry(kind, key) {
  if (typeof key !== "string" || key.length === 0) {
    fail(`${kind} has an empty registry key`);
  }
  return classification({ kind, numeric_id: null, registry_key: key }, []);
}

function classification(subject, programs) {
  if (
    (subject.kind === "ACTIVE_ABILITY" || subject.kind === "PASSIVE_ABILITY")
    && subject.numeric_id === 22
  ) {
    return {
      subject,
      kind: "COMPILED",
      programs: [subject.kind === "ACTIVE_ABILITY" ? 1 : 2],
      bespoke_symbol: null,
      unsupported_reason: null,
    };
  }
  return {
    subject,
    kind: "UNSUPPORTED",
    programs,
    bespoke_symbol: null,
    unsupported_reason: "SOURCE_MECHANIC_NOT_ADMITTED_BY_M5_PROGRAM_SET",
  };
}

const catalogBytes = readFileSync(CATALOG_PATH);
const catalog = JSON.parse(catalogBytes.toString("utf8"));
if (catalog.schema_version !== 1 || catalog.oracle_sha !== ORACLE_SHA) {
  fail("catalog identity mismatch");
}
const entries = [
  ...catalog.moves.map(entry => numeric("MOVE", entry)),
  ...catalog.abilities.map(entry => numeric("ACTIVE_ABILITY", entry)),
  ...catalog.abilities.map(entry => numeric("PASSIVE_ABILITY", entry)),
  ...catalog.modifier_types.map(entry => registry("HELD_ITEM", entry.key)),
  ...catalog.statuses.map(entry => numeric("MAJOR_STATUS", entry)),
  ...catalog.weather.map(entry => numeric("WEATHER", entry)),
  ...catalog.terrain.map(entry => numeric("TERRAIN", entry)),
  ...catalog.arena_tags.map(entry => numeric("ARENA_TAG", entry)),
  ...catalog.battler_tags.map(entry => numeric("BATTLER_TAG", entry)),
  ...catalog.positional_tags.map(entry => numeric("POSITIONAL_TAG", entry)),
];

const KIND_RANK = new Map([
  "MOVE",
  "ACTIVE_ABILITY",
  "PASSIVE_ABILITY",
  "HELD_ITEM",
  "MAJOR_STATUS",
  "VOLATILE_STATUS",
  "WEATHER",
  "TERRAIN",
  "SIDE_CONDITION",
  "ARENA_TAG",
  "BATTLER_TAG",
  "POSITIONAL_TAG",
  "BESPOKE",
].map((kind, rank) => [kind, rank]));

entries.sort((left, right) => {
  const leftRank = KIND_RANK.get(left.subject.kind);
  const rightRank = KIND_RANK.get(right.subject.kind);
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  const leftNumeric = left.subject.numeric_id;
  const rightNumeric = right.subject.numeric_id;
  if (leftNumeric !== rightNumeric) {
    if (leftNumeric == null) return -1;
    if (rightNumeric == null) return 1;
    return leftNumeric - rightNumeric;
  }
  const leftKey = left.subject.registry_key ?? "";
  const rightKey = right.subject.registry_key ?? "";
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
});

const keys = new Set();
for (const entry of entries) {
  const key = JSON.stringify(entry.subject);
  if (keys.has(key)) {
    fail(`duplicate classification ${key}`);
  }
  keys.add(key);
}
const compiled = entries.filter(entry => entry.kind === "COMPILED").length;
const unsupported = entries.filter(entry => entry.kind === "UNSUPPORTED").length;
const catalogDigest = createHash("sha256").update(JSON.stringify(canonical(catalog))).digest("hex");
writeJson("classification-manifest-v1.json", {
  schema_version: 1,
  oracle_sha: ORACLE_SHA,
  source_catalog_sha256: catalogDigest,
  entries,
});
writeJson("bespoke-manifest-v1.json", {
  schema_version: 1,
  oracle_sha: ORACLE_SHA,
  entries: [],
});
writeJson("capability-report-v1.json", {
  schema_version: 1,
  oracle_sha: ORACLE_SHA,
  source_catalog_sha256: catalogDigest,
  source_count: entries.length,
  compiled_count: compiled,
  bespoke_count: 0,
  unsupported_count: unsupported,
  unclassified_count: 0,
  compiled_sources: [
    { kind: "ACTIVE_ABILITY", numeric_id: 22, program_id: 1 },
    { kind: "PASSIVE_ABILITY", numeric_id: 22, program_id: 2 },
  ],
});
console.log(`M5 classification generator: ${entries.length} sources, ${compiled} compiled, ${unsupported} unsupported, 0 unclassified`);
