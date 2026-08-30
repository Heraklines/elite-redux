#!/usr/bin/env node

import { createPrivateKey, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}
const root = resolve(import.meta.dirname, "..");
const input = resolve(root, required("--input"));
const output = resolve(root, required("--output"));
const domain = required("--domain");
const keyId = required("--key-id");
if (!/^er-m9:(runtime-assignment|rollout-policy|rollback-directive)-v1$/u.test(domain)) {
  throw new Error("M9 signing domain is not allowlisted");
}
const privateKeyBase64 = process.env.M9_RELEASE_SIGNING_PRIVATE_KEY;
if (privateKeyBase64 == null || privateKeyBase64.length === 0) {
  throw new Error("M9_RELEASE_SIGNING_PRIVATE_KEY is required");
}
const payload = JSON.parse(readFileSync(input, "utf8"));
const bytes = Buffer.from(`${domain}\0${canonical(payload)}`);
const privateKey = createPrivateKey({
  key: Buffer.from(privateKeyBase64, "base64"),
  format: "der",
  type: "pkcs8",
});
const signature = sign(null, bytes, privateKey);
writeFileSync(
  output,
  `${canonical({ envelope_version: 1, key_id: keyId, payload, signature: Array.from(signature) })}\n`,
);

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
