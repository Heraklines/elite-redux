#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const BROWSER_SHA = "b2ed1a6eb050a18d5f335ec826e01b7b425ce311";
const RUST_SHA = "ea57c3cedd5dbc5856baf3748c0f03a7dc2c9273";
const RUST_TAG = "rust-kernel-m72-final";
const fail = message => {
  throw new Error(`M8 contract check: ${message}`);
};
const read = path => readFileSync(resolve(ROOT, path), "utf8");
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

if (git("rev-parse", `${RUST_TAG}^{commit}`) !== RUST_SHA) {
  fail("M7.2 tag mismatch");
}
if (git("rev-parse", `${BROWSER_SHA}^{commit}`) !== BROWSER_SHA) {
  fail("browser base unavailable");
}
const sourceLock = read("rust/fixtures/m8/m8-browser-source-lock.toml");
for (const value of [BROWSER_SHA, RUST_SHA, "33236341480", "PATH_MANIFEST_ONLY_NO_MERGE_NO_REBASE"]) {
  if (!sourceLock.includes(value)) {
    fail(`source lock omits ${value}`);
  }
}

const transplant = JSON.parse(read("rust/fixtures/m8/m8-transplant-manifest.json"));
if (
  transplant.schema_version !== 1
  || transplant.browser_base_sha !== BROWSER_SHA
  || transplant.rust_source_sha !== RUST_SHA
  || transplant.rust_source_tag !== RUST_TAG
  || transplant.file_count !== transplant.files.length
  || transplant.digest_kind !== "git-blob-sha1"
) {
  fail("transplant manifest identity mismatch");
}
const paths = transplant.files.map(entry => entry.path);
if (
  new Set(paths).size !== paths.length
  || paths.some((path, index) => index > 0 && paths[index - 1].localeCompare(path) >= 0)
) {
  fail("transplant paths duplicate or unsorted");
}
const mutable = new Set(transplant.mutable_imported_paths);
for (const entry of transplant.files) {
  const expected = git("rev-parse", `${RUST_TAG}:${entry.path}`);
  if (expected !== entry.digest) {
    fail(`transplant source digest mismatch ${entry.path}`);
  }
  if (!mutable.has(entry.path)) {
    const actual = git("hash-object", entry.path);
    if (actual !== entry.digest) {
      fail(`transplanted file drift ${entry.path}`);
    }
  }
}

const forbiddenBrowser = git(
  "diff",
  "--name-only",
  BROWSER_SHA,
  "--",
  "package.json",
  "pnpm-lock.yaml",
  "vite.config.ts",
  "index.html",
  "index.css",
  "workers",
  "deploy",
  "assets",
  "editor",
  "locales",
)
  .split(/\r?\n/u)
  .filter(Boolean);
if (forbiddenBrowser.length > 0) {
  fail(`frozen browser paths changed: ${forbiddenBrowser.join(", ")}`);
}
const browserDiff = git("diff", "--name-only", BROWSER_SHA, "--", "src", "test").split(/\r?\n/u).filter(Boolean);
const allowedBrowserAddition = path =>
  path.startsWith("src/rust-browser/")
  || path.startsWith("test/browser/rust-browser/")
  || path.startsWith("test/node/rust-browser/")
  || path.startsWith("test/kernel-fixtures/v1/")
  || path === "test/kernel-fixtures/m3/export-battle-oracle.test.ts"
  || path === "test/kernel-fixtures/m4/export-helper-runner.test.ts"
  || path === "test/kernel-fixtures/m4/export-run-oracle.test.ts"
  || path.startsWith("test/kernel-fixtures/m4/export/");
const forbiddenBrowserDiff = browserDiff.filter(path => !allowedBrowserAddition(path));
if (forbiddenBrowserDiff.length > 0) {
  fail(`unapproved browser source change: ${forbiddenBrowserDiff.join(", ")}`);
}

const refresh = JSON.parse(read("rust/fixtures/m8/m8-content-refresh-report.json"));
const drift = JSON.parse(read("rust/fixtures/m8/m8-oracle-drift-report.json"));
if (
  refresh.oracle_sha !== BROWSER_SHA
  || refresh.unclassified_canonical_behavior_count !== 0
  || refresh.unsupported_canonical_behavior_count !== 0
  || refresh.pending_bespoke_behavior_count !== 0
  || refresh.status !== "QUALIFIED_FOR_G39"
  || drift.oracle_sha !== BROWSER_SHA
  || drift.unclassified_path_count !== 0
) {
  fail("oracle refresh is not zero-gap");
}

const dynamicDrift = JSON.parse(read("rust/fixtures/m8/m8-dynamic-oracle-drift-report.json"));
const oracleAttestation = JSON.parse(read("rust/fixtures/m8/m8-oracle-refresh-attestation.json"));
if (
  dynamicDrift.candidate_oracle_sha !== BROWSER_SHA
  || dynamicDrift.m3.counts.SEMANTIC_CHANGE !== 39
  || dynamicDrift.m3.counts.PROVENANCE_ONLY !== 1
  || dynamicDrift.m3.files.length !== 40
  || dynamicDrift.m4.counts.SEMANTIC_CHANGE !== 8
  || dynamicDrift.m4.counts.PROVENANCE_ONLY !== 2
  || dynamicDrift.m4.files.length !== 10
  || refresh.dynamic_oracle_unclassified_count !== 0
  || drift.dynamic_oracle_refresh?.unclassified_fixture_count !== 0
  || oracleAttestation.browser_oracle_sha !== BROWSER_SHA
  || oracleAttestation.workflow_run_id !== 33243667688
  || oracleAttestation.unclassified_fixture_count !== 0
  || oracleAttestation.artifacts.m3.archive_sha256
    !== "882dcd4f82cd29f866b9d501d897fec7c06fb2ea8fb5d3d232ef931add011137"
  || oracleAttestation.artifacts.m4.archive_sha256
    !== "13bcde37a72cf2b56bcccf2cb28608ed2e2355f09148e57c446d46a680cfe9f3"
) {
  fail("dynamic M3/M4 oracle refresh is not fully classified");
}

const g40 = JSON.parse(read("rust/fixtures/m8/m8-g40-qualification.json"));
const shadowDrift = JSON.parse(read("rust/fixtures/m8/shadow/known-drift-v1.json"));
if (
  g40.candidate_sha !== "8600691498501f16d0ccbb613dcf3dac9fbe30db"
  || g40.workflow_run_id !== 33250719775
  || g40.conclusion !== "SUCCESS"
  || g40.production_default !== "LEGACY_TYPESCRIPT"
  || g40.deployment_authorized !== false
  || shadowDrift.browser_sha !== BROWSER_SHA
  || shadowDrift.known_drift_count !== 47
  || shadowDrift.unexplained_drift_count !== 0
  || shadowDrift.known_drifts.length !== 47
) {
  fail("G40 attestation or M8 shadow drift registry is invalid");
}

const g41 = JSON.parse(read("rust/fixtures/m8/m8-g41-qualification.json"));
if (
  g41.candidate_sha !== "1c30288a380b743f05889edf4d9f7c30601bcb97"
  || g41.workflow_run_id !== 33252792510
  || g41.conclusion !== "SUCCESS"
  || g41.unexplained_mechanical_divergence_count !== 0
  || g41.production_default !== "LEGACY_TYPESCRIPT"
  || g41.deployment_authorized !== false
) {
  fail("G41 quarantined shadow attestation is invalid");
}

const g42 = JSON.parse(read("rust/fixtures/m8/m8-g42-qualification.json"));
const browserSecurity = JSON.parse(read("rust/fixtures/m8/m8-browser-security-audit.json"));
if (
  g42.candidate_sha !== "ae063bd48bb4391c17e5658a8922a7abc99e4440"
  || g42.workflow_run_id !== 33256066882
  || g42.conclusion !== "SUCCESS"
  || g42.full_rust_phaser_solo !== true
  || g42.two_browser_rust_webrtc !== true
  || g42.hot_rejoin !== true
  || g42.mixed_peer_rejected !== true
  || g42.production_default !== "LEGACY_TYPESCRIPT"
  || g42.deployment_authorized !== false
  || browserSecurity.browser_sha !== BROWSER_SHA
  || browserSecurity.open_security_gap_count !== 0
  || browserSecurity.checks.some(check => check.status !== "PASS")
  || read("src/main.ts").includes("rust-browser")
) {
  fail("G42 adapter attestation or final browser security audit is invalid");
}

const requiredContracts = [
  "m8-api.md",
  "m8-cache-release.md",
  "m8-contract.toml",
  "m8-error-policy.md",
  "m8-ownership.toml",
  "m8-performance.md",
  "m8-phaser-adapter.md",
  "m8-platform-adapters.md",
  "m8-security.md",
  "m8-shadow-parity.md",
  "m8-worker-protocol.md",
];
for (const file of requiredContracts) {
  if (read(`rust/contracts/${file}`).trim().length === 0) {
    fail(`empty contract ${file}`);
  }
}
const contract = read("rust/contracts/m8-contract.toml");
for (const value of [
  BROWSER_SHA,
  RUST_SHA,
  "CANONICAL_JSON_V1",
  "exactly one canonical authority per execution mode",
]) {
  if (!contract.includes(value)) {
    fail(`m8 contract omits ${value}`);
  }
}

const workspace = read("rust/Cargo.toml");
if (!workspace.includes('"crates/er-web"')) {
  fail("er-web missing from workspace");
}
const webSource = [read("rust/crates/er-web/src/contracts.rs"), read("rust/crates/er-web/src/host.rs")].join("\n");
for (const forbidden of ["choose_move", "select_reward", "apply_damage", "resolve_turn", "submit_command"]) {
  if (webSource.includes(forbidden)) {
    fail(`semantic Wasm export ${forbidden}`);
  }
}
const selector = read("src/rust-browser/host/browser-runtime-selector.ts");
if (!selector.includes("if (!import.meta.env.DEV)") || !selector.includes("LEGACY_TYPESCRIPT")) {
  fail("browser runtime selector does not fail to legacy in production");
}
console.log(
  `M8 contract check: browser ${BROWSER_SHA}, Rust ${RUST_SHA}, ${transplant.file_count} transplanted files, zero catalog gaps`,
);
