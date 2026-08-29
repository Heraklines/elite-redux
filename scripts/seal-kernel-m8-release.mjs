#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const BROWSER_SHA = "b2ed1a6eb050a18d5f335ec826e01b7b425ce311";
const RUST_SHA = "ea57c3cedd5dbc5856baf3748c0f03a7dc2c9273";
const ORACLE_SHA = BROWSER_SHA;
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}
const input = args.get("--input-dir");
const output = args.get("--output");
const releaseId = args.get("--release-id");
const candidateSha = args.get("--candidate-sha");
const contentHash = args.get("--content-hash");
const privateRoute = args.get("--private-route");
if (
  !input
  || !output
  || !isAbsolute(input)
  || !isAbsolute(output)
  || !releaseId
  || !candidateSha
  || !contentHash
  || !privateRoute
) {
  throw new Error(
    "usage: seal-kernel-m8-release --input-dir <absolute> --output <absolute> --release-id <id> --candidate-sha <sha> --content-hash <hash> --private-route </private/path>",
  );
}
if (
  !/^[a-zA-Z0-9._-]{1,128}$/u.test(releaseId)
  || !/^[0-9a-f]{40}$/u.test(candidateSha)
  || !privateRoute.startsWith("/private/")
) {
  throw new Error("release identity arguments are invalid");
}
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
if (head !== candidateSha) {
  throw new Error("release candidate SHA is not checkout HEAD");
}
const root = resolve(input);
const build = JSON.parse(readFileSync(resolve(root, "m8-web-assets.json"), "utf8"));
const required = [
  "er_web.wasm",
  "er_web.js",
  "content-pack.json",
  "execution-identity.bin",
  "session-start.json",
  "session-authority.json",
  "session-replica.json",
];
const assets = {};
for (const name of required) {
  const path = resolve(root, name);
  const bytes = readFileSync(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (
    build.assets?.[name]?.sha256 !== sha256
    || build.assets?.[name]?.bytes !== bytes.length
    || statSync(path).size !== bytes.length
  ) {
    throw new Error(`release asset identity mismatch: ${name}`);
  }
  assets[name] = { bytes: bytes.length, sha256 };
}
const manifest = {
  schema_version: 1,
  release_id: releaseId,
  candidate_sha: candidateSha,
  browser_source_sha: BROWSER_SHA,
  rust_source_sha: RUST_SHA,
  oracle_sha: ORACLE_SHA,
  worker_protocol: 1,
  authority_protocol: "er-coop-47",
  content_hash: contentHash,
  assets: Object.fromEntries(Object.entries(assets).sort(([left], [right]) => left.localeCompare(right))),
  private_route: privateRoute,
  production_default: "LEGACY_TYPESCRIPT",
  deployment_authorized: false,
};
const encoded = `${JSON.stringify(manifest)}\n`;
writeFileSync(resolve(output), encoded);
console.log(`M8 release manifest sha256 ${createHash("sha256").update(encoded).digest("hex")}`);
