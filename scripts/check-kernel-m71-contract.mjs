#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const fail = message => {
  throw new Error(`M7.1 contract check: ${message}`);
};
const read = path => readFileSync(resolve(ROOT, path), "utf8");
const json = path => JSON.parse(read(path));

function contractValues(text) {
  const values = new Map();
  for (const [index, raw] of text.split(/\r?\n/u).entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const match = /^([a-z0-9_]+)\s*=\s*(.+)$/u.exec(line);
    if (!match) {
      fail(`unsupported contract TOML line ${index + 1}`);
    }
    const [, key, encoded] = match;
    const value = encoded.startsWith('"')
      ? JSON.parse(encoded)
      : /^(?:true|false)$/u.test(encoded)
        ? encoded === "true"
        : /^\d+$/u.test(encoded)
          ? Number(encoded)
          : fail(`unsupported contract value ${key}`);
    if (values.has(key)) {
      fail(`duplicate contract key ${key}`);
    }
    values.set(key, value);
  }
  return values;
}

const contract = contractValues(read("rust/contracts/m71-contract.toml"));
const required = key => {
  if (!contract.has(key)) {
    fail(`missing contract key ${key}`);
  }
  return contract.get(key);
};
const attestation = json("rust/fixtures/m71/m7-final-attestation.json");
if (
  required("m7_final_sha") !== "1599f19c5d05ec8646819414f6ef7556f1f8bc89"
  || required("m7_g30_run_id") !== 33191709410
  || required("m7_oracle_sha") !== "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7"
  || attestation.commit_sha !== required("m7_final_sha")
  || attestation.g30_run_id !== required("m7_g30_run_id")
  || attestation.g30_conclusion !== "success"
  || attestation.oracle_sha !== required("m7_oracle_sha")
) {
  fail("M7 final attestation differs from the frozen green base");
}

const requiredFiles = [
  "rust/contracts/m71-api.md",
  "rust/contracts/m71-ownership.toml",
  "rust/contracts/m71-error-policy.md",
  "rust/contracts/m71-privacy.md",
  "rust/contracts/m71-performance.md",
  "docs/plans/rust-kernel/m71-snapshot-session-audit.md",
  "docs/plans/rust-kernel/m71-evidence-digest-audit.md",
  "docs/plans/rust-kernel/m71-boundary-security-audit.md",
  "docs/plans/rust-kernel/m71-repro-impact-performance-audit.md",
];
for (const path of requiredFiles) {
  if (!existsSync(resolve(ROOT, path))) {
    fail(`missing frozen contract evidence ${path}`);
  }
}

const developerCrates = [
  "er-dev-types",
  "er-devplane",
  "er-repro",
  "er-agent-protocol",
  "er-model",
  "er-render-model",
  "er-impact",
  "er-batch",
];
const workspace = read("rust/Cargo.toml");
for (const crate of developerCrates) {
  if (!workspace.includes(`crates/${crate}`) || !existsSync(resolve(ROOT, `rust/crates/${crate}/Cargo.toml`))) {
    fail(`developer crate ${crate} is not wired into the workspace`);
  }
}
const coreCrates = [
  "er-state",
  "er-battle",
  "er-run",
  "er-game",
  "er-kernel",
  "er-protocol",
  "er-mechanics",
];
for (const core of coreCrates) {
  const manifest = read(`rust/crates/${core}/Cargo.toml`);
  for (const developer of developerCrates) {
    if (manifest.includes(developer)) {
      fail(`forbidden dependency ${core} -> ${developer}`);
    }
  }
}

const forbiddenMethods = [
  "choose_move",
  "select_reward",
  "apply_damage",
  "force_capture",
  "resolve_turn",
  "session.choose_move",
  "session.select_reward",
  "session.capture",
  "session.resolve_turn",
];
const developerSources = developerCrates
  .map(crate => read(`rust/crates/${crate}/src/lib.rs`))
  .join("\n");
for (const method of forbiddenMethods) {
  if (developerSources.includes(method)) {
    fail(`semantic action bypass is present: ${method}`);
  }
}

if (
  required("execution_identity_version") !== 1
  || required("restorable_snapshot_version") !== 7
  || required("kernel_trace_version") !== 7
  || required("agent_protocol_version") !== 1
  || required("game_semantics_policy") !== "M7 G30 bytes and behavior remain exact"
) {
  fail("schema or semantics freeze differs from G31");
}

console.log(`M7.1 contract check: ${developerCrates.length} downstream crates, frozen M7 ${attestation.commit_sha}`);
