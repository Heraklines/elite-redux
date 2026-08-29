#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

function fail(message) {
  throw new Error(`M7 semantic drift classifier: ${message}`);
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail("invalid arguments");
    }
    values.set(key, value);
  }
  for (const key of ["--legacy", "--fresh", "--oracle-sha", "--output"]) {
    if (!values.has(key)) {
      fail(`missing ${key}`);
    }
  }
  const oracleSha = values.get("--oracle-sha");
  const output = values.get("--output");
  if (!/^[0-9a-f]{40}$/u.test(oracleSha) || !isAbsolute(output)) {
    fail("oracle SHA or output path is invalid");
  }
  return {
    legacy: resolve(values.get("--legacy")),
    fresh: resolve(values.get("--fresh")),
    oracleSha,
    output: resolve(output),
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stable(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stable).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort(compareText)
      .map(key => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
function normalizeSemantic(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeSemantic);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  const normalized = {};
  for (const key of Object.keys(value).sort(compareText)) {
    if (key === "provenance_hash") {
      continue;
    }
    const member = value[key];
    if (key === "source" && member && typeof member === "object" && typeof member.path === "string") {
      normalized.source = { path: member.path };
    } else {
      normalized[key] = normalizeSemantic(member);
    }
  }
  return normalized;
}

function sourceKey(source) {
  return stable(source);
}
function normalizedSourceKey(source) {
  if (source.kind !== "BESPOKE" || typeof source.registry_key !== "string") {
    return sourceKey(source);
  }
  const registryKey = source.registry_key.replace(
    /^(RNG:)?(.+\.ts):\d+:\d+:/u,
    (_match, prefix, path) => `${prefix ?? ""}${path}:*:*:`,
  );
  return stable({ ...source, registry_key: registryKey });
}

function unitKey(unit) {
  const { source, unit_kind: unitKind, ordinal } = unit.id;
  return `${sourceKey(source)}|${unitKind}|${ordinal}`;
}
function semanticKey(unit) {
  return `${normalizedSourceKey(unit.id.source)}|${unit.id.unit_kind}|${stable(normalizeSemantic(unit.semantic))}`;
}

function unmatched(left, right, key) {
  const available = new Map();
  for (const value of right) {
    const identity = key(value);
    available.set(identity, (available.get(identity) ?? 0) + 1);
  }
  const result = [];
  for (const value of left) {
    const identity = key(value);
    const remaining = available.get(identity) ?? 0;
    if (remaining === 0) {
      result.push(value);
    } else {
      available.set(identity, remaining - 1);
    }
  }
  return result;
}

function countBy(values, key) {
  const counts = new Map();
  for (const value of values) {
    const name = key(value);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort(([left], [right]) => compareText(left, right)));
}

const input = parseArgs(process.argv.slice(2));
const legacy = readJson(input.legacy);
const fresh = readJson(input.fresh);
if (
  legacy.schema_version !== 1
  || fresh.schema_version !== 1
  || fresh.oracle_sha !== input.oracleSha
  || !Array.isArray(legacy.sources)
  || !Array.isArray(fresh.sources)
  || !Array.isArray(legacy.behavior_units)
  || !Array.isArray(fresh.behavior_units)
) {
  fail("semantic catalog identity mismatch");
}

const legacySources = new Map(legacy.sources.map(entry => [sourceKey(entry.source), entry]));
const freshSources = new Map(fresh.sources.map(entry => [sourceKey(entry.source), entry]));
const allSourceKeys = [...new Set([...legacySources.keys(), ...freshSources.keys()])].sort(compareText);
const addedSources = [];
const removedSources = [];
const changedSourceCounts = [];
for (const key of allSourceKeys) {
  const before = legacySources.get(key);
  const after = freshSources.get(key);
  if (!before) {
    addedSources.push(after);
  } else if (!after) {
    removedSources.push(before);
  } else if (before.behavior_unit_count !== after.behavior_unit_count) {
    changedSourceCounts.push({
      source: after.source,
      before_count: before.behavior_unit_count,
      after_count: after.behavior_unit_count,
    });
  }
}

const legacyUnits = new Map(legacy.behavior_units.map(unit => [unitKey(unit), unit]));
const freshUnits = new Map(fresh.behavior_units.map(unit => [unitKey(unit), unit]));
const allUnitKeys = [...new Set([...legacyUnits.keys(), ...freshUnits.keys()])].sort(compareText);
const addedUnits = [];
const removedUnits = [];
const semanticChangedUnits = [];
const provenanceOnlyUnits = [];
for (const key of allUnitKeys) {
  const before = legacyUnits.get(key);
  const after = freshUnits.get(key);
  if (!before) {
    addedUnits.push(after);
  } else if (!after) {
    removedUnits.push(before);
  } else if (stable(before) !== stable(after)) {
    const change = { before, after };
    if (stable(normalizeSemantic(before.semantic)) === stable(normalizeSemantic(after.semantic))) {
      provenanceOnlyUnits.push(change);
    } else {
      semanticChangedUnits.push(change);
    }
  }
}
const semanticallyAddedUnits = unmatched(fresh.behavior_units, legacy.behavior_units, semanticKey);
const semanticallyRemovedUnits = unmatched(legacy.behavior_units, fresh.behavior_units, semanticKey);

const report = {
  schema_version: 1,
  legacy_oracle_sha: legacy.oracle_sha,
  candidate_oracle_sha: fresh.oracle_sha,
  source_counts: {
    before: legacy.sources.length,
    after: fresh.sources.length,
    added: addedSources.length,
    removed: removedSources.length,
    changed_behavior_counts: changedSourceCounts.length,
  },
  behavior_unit_counts: {
    before: legacy.behavior_units.length,
    after: fresh.behavior_units.length,
    identity_added: addedUnits.length,
    identity_removed: removedUnits.length,
    semantic_changed_at_stable_identity: semanticChangedUnits.length,
    provenance_only_changed: provenanceOnlyUnits.length,
    semantically_added: semanticallyAddedUnits.length,
    semantically_removed: semanticallyRemovedUnits.length,
  },
  resolution_counts: {
    before: countBy(legacy.behavior_units, unit => unit.semantic.resolution),
    after: countBy(fresh.behavior_units, unit => unit.semantic.resolution),
  },
  added_sources: addedSources,
  removed_sources: removedSources,
  changed_source_counts: changedSourceCounts,
  identity_added_units: addedUnits,
  identity_removed_units: removedUnits,
  semantic_changed_units: semanticChangedUnits,
  provenance_only_units: provenanceOnlyUnits,
  semantically_added_units: semanticallyAddedUnits,
  semantically_removed_units: semanticallyRemovedUnits,
};
mkdirSync(dirname(input.output), { recursive: true });
writeFileSync(input.output, `${stable(report)}\n`);
console.log(
  `M7 semantic drift classifier: sources ${legacy.sources.length}->${fresh.sources.length}; units ${legacy.behavior_units.length}->${fresh.behavior_units.length}; semantic-added=${semanticallyAddedUnits.length} semantic-removed=${semanticallyRemovedUnits.length} semantic-changed=${semanticChangedUnits.length} provenance-only=${provenanceOnlyUnits.length}`,
);
