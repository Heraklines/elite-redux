#!/usr/bin/env node

import { createHash, createPrivateKey, sign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}
const root = resolve(import.meta.dirname, "..");
const inputDirectory = resolve(root, required("--input"));
const metadata = JSON.parse(readFileSync(resolve(root, required("--metadata")), "utf8"));
const output = resolve(root, required("--output"));
const keyId = required("--key-id");
const privateKeyBase64 = process.env.M9_RELEASE_SIGNING_PRIVATE_KEY;
if (privateKeyBase64 == null || privateKeyBase64.length === 0) {
  throw new Error("M9_RELEASE_SIGNING_PRIVATE_KEY is required");
}

const artifactFiles = {
  bootstrap_js: ["bootstrap.js", "text/javascript"],
  browser_js: ["browser.js", "text/javascript"],
  worker_js: ["rust-kernel-worker.js", "text/javascript"],
  wasm_glue_js: ["er_web.js", "text/javascript"],
  wasm: ["er_web.wasm", "application/wasm"],
  content: ["content-pack.json", "application/json"],
  asset_manifest: ["asset-manifest.json", "application/json"],
  service_worker: ["service-worker.js", "text/javascript"],
  session_template: ["session-start.json", "application/json"],
};
const artifacts = {};
for (const [kind, [name, mediaType]] of Object.entries(artifactFiles)) {
  const bytes = readFileSync(resolve(inputDirectory, name));
  if (bytes.length === 0) {
    throw new Error(`M9 artifact is empty: ${name}`);
  }
  const digest = sha256(bytes);
  artifacts[kind] = {
    url: `/__m9_releases/${metadata.release_id}/${digest}/${basename(name)}`,
    sha256: digest,
    bytes: bytes.length,
    media_type: mediaType,
  };
}
const artifactSetSha256 = sha256(Buffer.from(canonical(artifacts)));
const payload = {
  ...metadata,
  schema_version: 2,
  browser_kernel_abi: 1,
  worker_protocol: 1,
  authority_protocol: "er-coop-47",
  artifacts,
  qualification: {
    ...metadata.qualification,
    candidate_sha: metadata.integration_sha,
    conclusion: "SUCCESS",
    artifact_set_sha256: artifactSetSha256,
  },
};
const signedBytes = Buffer.concat([Buffer.from("er-m9:release-manifest-v1\0"), Buffer.from(canonical(payload))]);
const privateKey = createPrivateKey({
  key: Buffer.from(privateKeyBase64, "base64"),
  format: "der",
  type: "pkcs8",
});
const signature = sign(null, signedBytes, privateKey);
if (signature.length !== 64) {
  throw new Error("M9 release signer returned an invalid Ed25519 signature");
}
const envelope = {
  envelope_version: 1,
  key_id: keyId,
  payload,
  signature: Array.from(signature),
};
mkdirSync(resolve(output, ".."), { recursive: true });
writeFileSync(output, `${canonical(envelope)}\n`);
process.stdout.write(
  `${JSON.stringify({ release_id: payload.release_id, artifact_set_sha256: artifactSetSha256, manifest_sha256: sha256(readFileSync(output)) })}\n`,
);

function required(name) {
  const value = args.get(name);
  if (value == null || value.length === 0) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("M9 signed JSON contains an invalid number");
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  throw new Error("M9 signed JSON contains an unsupported value");
}
