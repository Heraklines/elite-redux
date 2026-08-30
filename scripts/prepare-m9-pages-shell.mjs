#!/usr/bin/env node

import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}
const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, required("--manifest"));
const bootstrapPath = resolve(root, required("--bootstrap"));
const serviceWorkerPath = resolve(root, required("--service-worker"));
const output = resolve(root, required("--output"));
const assetSha = required("--asset-sha");
if (!/^[0-9a-f]{40}$/u.test(assetSha)) {
  throw new Error("M9 Pages shell asset SHA is invalid");
}
const envelope = JSON.parse(readFileSync(manifestPath, "utf8"));
const release = envelope?.payload;
if (release?.schema_version !== 2 || !/^[a-zA-Z0-9._:-]{1,128}$/u.test(release.release_id)) {
  throw new Error("M9 Pages shell release manifest is invalid");
}
assertArtifact(bootstrapPath, release.artifacts?.bootstrap_js, "bootstrap.js");
assertArtifact(serviceWorkerPath, release.artifacts?.service_worker, "service-worker.js");

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync(bootstrapPath, resolve(output, "bootstrap.js"));
cpSync(serviceWorkerPath, resolve(output, "service-worker.js"));
writeFileSync(
  resolve(output, "_headers"),
  `${readFileSync(resolve(root, "deploy/cloudflare/_headers"), "utf8")}\\n/bootstrap.js\\n  Cache-Control: no-cache\\n`,
);
const redirects = readFileSync(resolve(root, "deploy/cloudflare/_redirects"), "utf8").replace(
  /er-assets@[0-9a-f]{40}/gu,
  `er-assets@${assetSha}`,
);
if (
  !redirects.includes(`er-assets@${assetSha}`)
  || redirects.includes("er-assets@34275e401c6fcfd80474378dcf2438de8b2fd97a")
) {
  throw new Error("M9 Pages shell failed to pin the exact asset SHA");
}
writeFileSync(resolve(output, "_redirects"), redirects);
writeFileSync(
  resolve(output, "index.html"),
  `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="er-release-id" content="${release.release_id}"><title>PokéRogue Redux</title></head><body><div id="app"></div><script type="module" src="/bootstrap.js"></script></body></html>`,
);
writeFileSync(
  resolve(output, "release.json"),
  `${JSON.stringify({ schema_version: 1, release_id: release.release_id, manifest_sha256: sha256(readFileSync(manifestPath)) })}\n`,
);

function assertArtifact(path, artifact, basename) {
  const bytes = readFileSync(path);
  if (
    artifact == null
    || artifact.bytes !== bytes.byteLength
    || artifact.sha256 !== sha256(bytes)
    || !String(artifact.url).endsWith(`/${basename}`)
  ) {
    throw new Error(`M9 Pages shell ${basename} differs from the signed release`);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function required(name) {
  const value = args.get(name);
  if (value == null || value.length === 0) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}
