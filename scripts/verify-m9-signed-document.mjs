#!/usr/bin/env node

import { createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}
const domain = required("--domain");
if (!/^er-m9:(runtime-assignment|rollout-policy|rollback-directive)-v1$/u.test(domain)) {
  throw new Error("M9 verification domain is not allowlisted");
}
const envelope = JSON.parse(readFileSync(resolve(import.meta.dirname, "..", required("--input")), "utf8"));
if (envelope.envelope_version !== 1 || envelope.key_id !== "m9-prod-2026-01" || envelope.signature?.length !== 64) {
  throw new Error("M9 signed document envelope is invalid");
}
const rawPublic = Buffer.from("fczPxkyYx6bQOL0KZHFZ8GuVh79NdRJL7RZ4CNWpJY4=", "base64");
const publicKey = createPublicKey({
  key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), rawPublic]),
  format: "der",
  type: "spki",
});
if (
  !verify(null, Buffer.from(`${domain}\0${canonical(envelope.payload)}`), publicKey, Buffer.from(envelope.signature))
) {
  throw new Error("M9 signed document signature is invalid");
}
process.stdout.write(`${JSON.stringify({ domain, verified: true })}\n`);

function required(name) {
  const value = args.get(name);
  if (value == null || value.length === 0) {
    throw new Error(`Missing ${name}`);
  }
  return value;
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
