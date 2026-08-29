#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}
const outputRoot = args.get("--out-dir");
const contentPath = args.get("--content");
const identityPath = args.get("--identity");
const sessionPath = args.get("--session");
if (!outputRoot || !isAbsolute(outputRoot) || !contentPath || !identityPath || !sessionPath) {
  throw new Error(
    "usage: build-kernel-m8-web --out-dir <absolute-directory> --content <content-pack-path> --identity <identity-path> --session <snapshot-path>",
  );
}
const out = resolve(outputRoot);
const content = resolve(ROOT, contentPath);
const identity = resolve(ROOT, identityPath);
const session = resolve(ROOT, sessionPath);
mkdirSync(out, { recursive: true });

function run(command, commandArgs, cwd = ROOT) {
  execFileSync(command, commandArgs, { cwd, stdio: "inherit", env: { ...process.env, SOURCE_DATE_EPOCH: "0" } });
}

run("cargo", [
  "build",
  "--manifest-path",
  "rust/Cargo.toml",
  "--locked",
  "--release",
  "--target",
  "wasm32-unknown-unknown",
  "-p",
  "er-web",
]);
const wasmInput = resolve(ROOT, "rust/target/wasm32-unknown-unknown/release/er_web.wasm");
run("wasm-bindgen", [wasmInput, "--target", "web", "--out-dir", out, "--out-name", "er_web"]);
renameSync(resolve(out, "er_web_bg.wasm"), resolve(out, "er_web.wasm"));
copyFileSync(content, resolve(out, "content-pack.json"));
copyFileSync(identity, resolve(out, "execution-identity.bin"));
copyFileSync(session, resolve(out, "session-start.json"));

const files = ["er_web.wasm", "er_web.js", "content-pack.json", "execution-identity.bin", "session-start.json"];
const assets = Object.fromEntries(
  files.map(file => {
    const bytes = readFileSync(resolve(out, file));
    return [file, { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }];
  }),
);
const metadata = {
  schema_version: 1,
  browser_worker_protocol_version: 1,
  source_sha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
  rust_source_sha: "ea57c3cedd5dbc5856baf3748c0f03a7dc2c9273",
  assets,
};
writeFileSync(resolve(out, "m8-web-assets.json"), `${JSON.stringify(metadata)}\n`);
console.log(`M8 web build: ${assets["er_web.wasm"].sha256}`);
