#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}
const outputRoot = args.get("--out-dir");
if (outputRoot == null || !isAbsolute(outputRoot)) {
  throw new Error("usage: build-kernel-m9e-v7-web --out-dir <absolute-directory>");
}
const out = resolve(outputRoot);
mkdirSync(out, { recursive: true });
const env = { ...process.env, SOURCE_DATE_EPOCH: "0" };
execFileSync(
  "cargo",
  [
    "run",
    "--manifest-path",
    "rust/Cargo.toml",
    "--locked",
    "-p",
    "er-web",
    "--example",
    "m9e_v7_browser_fixtures",
    "--",
    out,
  ],
  { cwd: ROOT, stdio: "inherit", env },
);
execFileSync(
  "cargo",
  [
    "build",
    "--manifest-path",
    "rust/Cargo.toml",
    "--locked",
    "--release",
    "--target",
    "wasm32-unknown-unknown",
    "-p",
    "er-web",
  ],
  { cwd: ROOT, stdio: "inherit", env },
);
const wasmInput = resolve(ROOT, "rust/target/wasm32-unknown-unknown/release/er_web.wasm");
execFileSync("wasm-bindgen", [wasmInput, "--target", "web", "--out-dir", out, "--out-name", "er_web"], {
  cwd: ROOT,
  stdio: "inherit",
  env,
});
copyFileSync(
  resolve(ROOT, "rust/fixtures/m9/engineering/game-content-bundle-v2.json"),
  resolve(out, "game-content-bundle-v2.json"),
);
const files = [
  "er_web.js",
  "er_web_bg.wasm",
  "game-content-bundle-v2.json",
  "coop-authority-snapshot.json",
  "coop-replica-snapshot.json",
];
const assets = Object.fromEntries(
  files.map(file => {
    const bytes = readFileSync(resolve(out, file));
    return [file, { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }];
  }),
);
writeFileSync(
  resolve(out, "m9e-v7-web-assets.json"),
  `${JSON.stringify({
    schema_version: 1,
    browser_worker_protocol_version: 2,
    source_sha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    assets,
  })}\n`,
);
console.log(`M9-E V7 web build: ${assets["er_web_bg.wasm"].sha256}`);
