#!/usr/bin/env node

import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}
const root = resolve(import.meta.dirname, "..");
const envelope = JSON.parse(readFileSync(resolve(root, required("--manifest")), "utf8"));
const artifactDirectory = args.has("--artifacts") ? resolve(root, required("--artifacts")) : null;
const rawPublic = Buffer.from(args.get("--public-key") ?? "fczPxkyYx6bQOL0KZHFZ8GuVh79NdRJL7RZ4CNWpJY4=", "base64");
if (rawPublic.length !== 32 || envelope.envelope_version !== 1 || envelope.signature?.length !== 64) {
  throw new Error("M9 release envelope or trust root is invalid");
}
const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), rawPublic]);
const publicKey = createPublicKey({ key: spki, format: "der", type: "spki" });
const signed = Buffer.from(`er-m9:release-manifest-v1\0${canonical(envelope.payload)}`);
if (!verify(null, signed, publicKey, Buffer.from(envelope.signature))) {
  throw new Error("M9 release signature verification failed");
}
if (artifactDirectory != null) {
  for (const artifact of Object.values(envelope.payload.artifacts)) {
    const name = basename(new URL(artifact.url, "https://release.invalid").pathname);
    const bytes = readFileSync(resolve(artifactDirectory, name));
    if (
      bytes.length !== artifact.bytes
      || sha256(bytes) !== artifact.sha256
      || !artifact.url.includes(`/${artifact.sha256}/`)
    ) {
      throw new Error(`M9 artifact verification failed: ${name}`);
    }
  }
}
process.stdout.write(`${JSON.stringify({ release_id: envelope.payload.release_id, verified: true })}\n`);

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
