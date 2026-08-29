#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const groups = JSON.parse(
  readFileSync(resolve(ROOT, "rust/fixtures/m7/m7-semantic-groups-v1.json"), "utf8"),
);
const legacy = JSON.parse(
  readFileSync(resolve(ROOT, "rust/fixtures/m7/m7-behavior-implementation-v1.json"), "utf8"),
);
const output = resolve(ROOT, "rust/fixtures/m7/m7-behavior-implementation-v2.json");

function fail(message) {
  throw new Error(`M7 implementation V2: ${message}`);
}

const legacyById = new Map(
  legacy.implementations.map(entry => [entry.behavior_unit, entry]),
);
const implementations = [];
for (const group of groups.groups) {
  const behaviorUnits = [...group.root_behaviors, ...group.helper_behaviors].sort();
  const entries = behaviorUnits.map(id => legacyById.get(id)).filter(Boolean);
  if (entries.length === 0) {
    continue;
  }
  if (entries.length !== behaviorUnits.length) {
    fail(`semantic group ${group.group_id} is only partially implemented`);
  }
  const statuses = [...new Set(entries.map(entry => entry.status))];
  if (statuses.length !== 1) {
    fail(`semantic group ${group.group_id} mixes implementation statuses`);
  }
  implementations.push({
    group_id: group.group_id,
    domain: group.domain,
    status: statuses[0],
    behavior_units: behaviorUnits,
    rust_symbols: [...new Set(entries.map(entry => entry.rust_symbol))].sort(),
    proof_registry_group: group.group_id,
    proof_tests: [...new Set(entries.map(entry => entry.proof.test))].sort(),
    proof_execution_digest: null,
  });
}
implementations.sort((left, right) => left.group_id.localeCompare(right.group_id));
const implementedIds = implementations.flatMap(entry => entry.behavior_units);
if (
  new Set(implementedIds).size !== implementedIds.length
  || implementedIds.length !== legacy.implementation_count
) {
  fail("V2 group union differs from the exact V1 implementation inventory");
}
const document = {
  schema_version: 2,
  oracle_sha: groups.oracle_sha,
  oracle_tree_sha: groups.oracle_tree_sha,
  publication_state: "PENDING_PROOF_EXECUTION",
  implementation_group_count: implementations.length,
  implementation_count: implementedIds.length,
  implementations,
};
writeFileSync(output, `${JSON.stringify(document)}\n`);
console.log(
  `M7 implementation V2: ${implementations.length} semantic groups, ${implementedIds.length} behaviors pending executed proofs`,
);
