#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const M7_TAG = "rust-kernel-m7-final";
const M7_SHA = "1599f19c5d05ec8646819414f6ef7556f1f8bc89";
const fail = message => {
  throw new Error(`M7.1 G30 parity: ${message}`);
};
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

if (git("rev-parse", `${M7_TAG}^{commit}`) !== M7_SHA) {
  fail("frozen M7 tag does not resolve to the G30 SHA");
}

const protectedPaths = [
  "rust/crates/er-state/src",
  "rust/crates/er-battle/src",
  "rust/crates/er-run/src",
  "rust/crates/er-game/src",
  "rust/crates/er-kernel/src",
  "rust/crates/er-protocol/src",
  "rust/crates/er-mechanics/src",
  "rust/fixtures/m7",
  "rust/contracts/m7-contract.toml",
  "rust/contracts/m7-api.md",
];
const changed = git("diff", "--name-only", M7_TAG, "--", ...protectedPaths)
  .split(/\r?\n/u)
  .filter(Boolean);
if (changed.length !== 0) {
  fail(`protected M7 mechanical paths changed: ${changed.join(", ")}`);
}

const attestation = JSON.parse(
  readFileSync(resolve(ROOT, "rust/fixtures/m71/m7-final-attestation.json"), "utf8"),
);
if (
  attestation.commit_sha !== M7_SHA
  || attestation.g30_run_id !== 33191709410
  || attestation.g30_conclusion !== "success"
) {
  fail("M7 final attestation mismatch");
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
for (const core of ["er-state", "er-battle", "er-run", "er-game", "er-kernel", "er-protocol", "er-mechanics"]) {
  const manifest = readFileSync(resolve(ROOT, `rust/crates/${core}/Cargo.toml`), "utf8");
  for (const developer of developerCrates) {
    if (manifest.includes(developer)) {
      fail(`forbidden dependency ${core} -> ${developer}`);
    }
  }
}

console.log(`M7.1 G30 parity: protected M7 mechanical paths match ${M7_SHA}`);
