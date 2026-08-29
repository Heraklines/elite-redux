#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const RUST_TAG = "rust-kernel-m72-final";
const RUST_SHA = "ea57c3cedd5dbc5856baf3748c0f03a7dc2c9273";
const BROWSER_SHA = "b2ed1a6eb050a18d5f335ec826e01b7b425ce311";
const OUTPUT = "rust/fixtures/m8/m8-transplant-manifest.json";
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
const approved = path =>
  path.startsWith("rust/")
  || path.startsWith("docs/plans/rust-kernel/")
  || /^scripts\/(?:audit|benchmark|build|check|classify|diagnose|export|generate|prepare)-kernel-.*\.mjs$/u.test(path)
  || path === "test/kernel-fixtures/m3/export-battle-oracle.test.ts"
  || path === "test/kernel-fixtures/m4/export-helper-runner.test.ts"
  || path === "test/kernel-fixtures/m4/export-run-oracle.test.ts"
  || path.startsWith("test/kernel-fixtures/m4/export/")
  || /^\.github\/workflows\/rust-kernel-.*\.yml$/u.test(path);

if (git("rev-parse", `${RUST_TAG}^{commit}`) !== RUST_SHA) {
  throw new Error("M8 transplant source tag mismatch");
}
const files = git("ls-tree", "-r", RUST_TAG)
  .split(/\r?\n/u)
  .filter(Boolean)
  .map(line => {
    const [metadata, path] = line.split("\t", 2);
    const [mode, type, digest] = metadata.split(" ");
    return { path, mode, type, digest };
  })
  .filter(entry => approved(entry.path));
files.sort((left, right) => left.path.localeCompare(right.path));
if (files.some(entry => entry.type !== "blob") || new Set(files.map(entry => entry.path)).size !== files.length) {
  throw new Error("M8 transplant contains non-blob or duplicate paths");
}
const mutableImportedPaths = new Set(["rust/Cargo.lock", "rust/Cargo.toml"]);
for (const entry of files) {
  const actual = git("hash-object", entry.path);
  if (actual !== entry.digest && !mutableImportedPaths.has(entry.path)) {
    throw new Error(`transplant mismatch ${entry.path}: ${actual} != ${entry.digest}`);
  }
}
const manifest = {
  schema_version: 1,
  browser_base_sha: BROWSER_SHA,
  rust_source_tag: RUST_TAG,
  rust_source_sha: RUST_SHA,
  digest_kind: "git-blob-sha1",
  mutable_imported_paths: [...mutableImportedPaths].sort(),
  allowed_roots: [
    ".github/workflows/rust-kernel-*.yml",
    "docs/plans/rust-kernel/**",
    "rust/**",
    "scripts/audit-kernel-*.mjs",
    "scripts/benchmark-kernel-*.mjs",
    "scripts/build-kernel-*.mjs",
    "scripts/check-kernel-*.mjs",
    "scripts/classify-kernel-*.mjs",
    "scripts/diagnose-kernel-*.mjs",
    "scripts/export-kernel-*.mjs",
    "scripts/generate-kernel-*.mjs",
    "scripts/prepare-kernel-*.mjs",
    "test/kernel-fixtures/m3/export-battle-oracle.test.ts",
    "test/kernel-fixtures/m4/export-helper-runner.test.ts",
    "test/kernel-fixtures/m4/export-run-oracle.test.ts",
    "test/kernel-fixtures/m4/export/**",
  ],
  forbidden_roots: [
    "assets/**",
    "deploy/**",
    "editor/**",
    "existing-browser-workflows",
    "existing-coop-workflows",
    "index.css",
    "index.html",
    "locales/**",
    "package.json",
    "pnpm-lock.yaml",
    "src/**",
    "test/**",
    "vite.config.*",
    "workers/**",
  ],
  file_count: files.length,
  files,
};
const output = resolve(ROOT, OUTPUT);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`M8 transplant manifest: ${files.length} files from ${RUST_SHA}`);
