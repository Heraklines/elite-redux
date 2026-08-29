#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const BASE_SHA = "8122fdd5863ee47b6c122d6e6fbb4228906b0b4f";
const BASE_TAG = "rust-kernel-m8-final";
const fail = message => {
  throw new Error(`M8.1 contract check: ${message}`);
};
const read = path => readFileSync(resolve(ROOT, path), "utf8");
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

if (git("rev-parse", `${BASE_TAG}^{commit}`) !== BASE_SHA) {
  fail("frozen M8 tag mismatch");
}
const required = [
  "rust/contracts/m81-contract.toml",
  "rust/contracts/m81-worker-abi.md",
  "rust/contracts/m81-reload-policy.md",
  "rust/contracts/m81-migration.md",
  "rust/contracts/m81-coop-reload.md",
  "rust/contracts/m81-security.md",
  "rust/contracts/m81-performance.md",
  "rust/contracts/m81-ownership.toml",
  "rust/crates/er-kernel-worker/Cargo.toml",
  "rust/crates/er-lab/src/kernel_reload/mod.rs",
  "src/rust-browser/hot-reload/transactional-reload.ts",
  "src/rust-browser/hot-reload/generation-worker-host.ts",
];
for (const path of required) {
  if (read(path).trim().length === 0) {
    fail(`required path is empty: ${path}`);
  }
}
const contract = read("rust/contracts/m81-contract.toml");
for (const value of [
  BASE_SHA,
  "LENGTH_PREFIXED_CANONICAL_JSON_V1",
  "TRANSFERABLE_CANONICAL_JSON_ARRAYBUFFER_V1",
  "maximum_typical_reload_ms = 250",
  "same-process dynamic libraries are forbidden",
]) {
  if (!contract.includes(value)) {
    fail(`contract lock is missing ${value}`);
  }
}
const workspace = read("rust/Cargo.toml");
if (!workspace.includes('"crates/er-kernel-worker"')) {
  fail("er-kernel-worker is absent from the workspace");
}
const changedProductionEntrypoints = git(
  "diff",
  "--name-only",
  BASE_SHA,
  "--",
  "src/main.ts",
  "index.html",
  "deploy",
  "workers",
)
  .split(/\r?\n/u)
  .filter(Boolean);
if (changedProductionEntrypoints.length > 0) {
  fail(`production default changed: ${changedProductionEntrypoints.join(", ")}`);
}
const sources = [
  read("rust/crates/er-kernel-worker/src/main.rs"),
  read("rust/crates/er-lab/src/kernel_reload/endpoint.rs"),
  read("src/rust-browser/hot-reload/dev-controls.ts"),
].join("\n");
for (const forbidden of ["libloading", "LoadLibrary", "dlopen", "globalThis.reloadKernel", "window.reloadKernel"]) {
  if (sources.includes(forbidden)) {
    fail(`forbidden reload seam present: ${forbidden}`);
  }
}
console.log(
  `M8.1 contract check: frozen M8 ${BASE_SHA}, process/Worker replacement only, production default unchanged`,
);
