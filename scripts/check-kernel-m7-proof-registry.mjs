#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

function fail(message) {
  throw new Error(`M7 proof registry: ${message}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
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
for (const key of ["--proof-artifact", "--test-list", "--report", "--qualified-output"]) {
  const path = argumentsMap.get(key);
  if (!path || !isAbsolute(path)) {
    fail(`${key} must be an absolute path`);
  }
}
const proofPath = argumentsMap.get("--proof-artifact");
const testListPath = argumentsMap.get("--test-list");
const reportPath = argumentsMap.get("--report");
const qualifiedOutputPath = argumentsMap.get("--qualified-output");
if (!existsSync(proofPath) || !existsSync(testListPath)) {
  fail("compiled proof artifact and cargo test list must exist");
}
const groups = readJson(resolve(ROOT, "rust/fixtures/m7/m7-semantic-groups-v1.json"));
const implementationPath = argumentsMap.has("--implementation")
  ? argumentsMap.get("--implementation")
  : resolve(ROOT, "rust/fixtures/m7/m7-behavior-implementation-v2.json");
if (!isAbsolute(implementationPath)) {
  fail("--implementation must be an absolute path when supplied");
}
const implementation = readJson(implementationPath);
const proof = readJson(proofPath);
const testList = readFileSync(testListPath, "utf8");
const discoveredTests = new Set(
  testList
    .split(/\r?\n/u)
    .map(line => /^(.+): test$/u.exec(line)?.[1])
    .filter(Boolean),
);

if (
  implementation.schema_version !== 2
  || implementation.oracle_sha !== groups.oracle_sha
  || proof.schema_version !== 1
  || proof.oracle_sha !== groups.oracle_sha
  || proof.proof_count !== proof.proofs.length
) {
  fail("proof, implementation, and semantic-group identities disagree");
}
const groupById = new Map(groups.groups.map(group => [group.group_id, group]));
const implementationByGroup = new Map(
  implementation.implementations.map(entry => [entry.group_id, entry]),
);
if (implementationByGroup.size !== implementation.implementations.length) {
  fail("implementation V2 contains duplicate semantic groups");
}
const proofGroups = new Set();
const emittedBehaviors = new Set();
for (const executed of proof.proofs) {
  const expected = implementationByGroup.get(executed.group_id);
  const group = groupById.get(executed.group_id);
  if (!expected || !group || proofGroups.has(executed.group_id)) {
    fail(`unknown or duplicate proof group ${executed.group_id}`);
  }
  proofGroups.add(executed.group_id);
  const expectedBehaviors = [...expected.behavior_units].sort();
  const actualBehaviors = [...executed.behavior_units].sort();
  const reached = [...executed.evidence.reached_behaviors].sort();
  if (
    JSON.stringify(actualBehaviors) !== JSON.stringify(expectedBehaviors)
    || JSON.stringify(reached) !== JSON.stringify(expectedBehaviors)
    || expected.proof_registry_group !== executed.group_id
    || !expected.rust_symbols.includes(executed.rust_symbol)
    || !discoveredTests.has(executed.test_name)
    || !/^blake3-v1:[0-9a-f]{64}$/u.test(executed.evidence_digest)
  ) {
    fail(`executed proof ${executed.group_id} does not match its compiled registry contract`);
  }
  for (const behavior of actualBehaviors) {
    if (emittedBehaviors.has(behavior)) {
      fail(`behavior ${behavior} was emitted by more than one proof`);
    }
    emittedBehaviors.add(behavior);
  }
}
const expectedGroups = new Set(implementationByGroup.keys());
if (
  proofGroups.size !== expectedGroups.size
  || [...expectedGroups].some(group => !proofGroups.has(group))
  || emittedBehaviors.size !== implementation.implementation_count
  || proof.behavior_count !== emittedBehaviors.size
) {
  fail("compiled proof registry does not exhaust the implementation V2 manifest");
}
const proofByGroup = new Map(proof.proofs.map(entry => [entry.group_id, entry]));
const qualifiedImplementation = {
  ...implementation,
  publication_state: "QUALIFIED",
  implementations: implementation.implementations.map(entry => {
    const executed = proofByGroup.get(entry.group_id);
    return {
      ...entry,
      proof_tests: [executed.test_name],
      proof_execution_digest: executed.evidence_digest,
    };
  }),
};
writeFileSync(qualifiedOutputPath, `${JSON.stringify(qualifiedImplementation)}\n`);
const report = {
  schema_version: 1,
  oracle_sha: proof.oracle_sha,
  proof_groups: proofGroups.size,
  emitted_behaviors: emittedBehaviors.size,
  discovered_tests: discoveredTests.size,
};
writeFileSync(reportPath, `${JSON.stringify(report)}\n`);
console.log(
  `M7 proof registry: ${report.proof_groups} groups emitted ${report.emitted_behaviors} exact behaviors`,
);
