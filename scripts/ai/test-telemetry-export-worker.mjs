#!/usr/bin/env node
import assert from "node:assert/strict";
import { gunzipSync, gzipSync } from "node:zlib";
import { handleRequest } from "../../workers/er-ai-telemetry-export/src/index.mjs";

const objects = [
  {
    key: "private-a",
    size: 15,
    uploaded: new Date("2026-08-03T00:00:00Z"),
    customMetadata: { combatContractVersion: "4", enc: "plain" },
    body: '{"batch":"a"}',
  },
  {
    key: "legacy-b",
    size: 15,
    uploaded: new Date("2026-08-03T00:00:01Z"),
    customMetadata: { combatContractVersion: "0", enc: "plain" },
    body: '{"batch":"b"}',
  },
  {
    key: "private-gzip",
    size: 21,
    uploaded: new Date("2026-08-03T00:00:02Z"),
    customMetadata: { combatContractVersion: "4", enc: "gz" },
    body: '{"batch":"gzip"}',
  },
];
const bucket = {
  async get(key) {
    const object = objects.find(candidate => candidate.key === key);
    if (!object) {
      return null;
    }
    const bytes = object.customMetadata.enc === "gz" ? gzipSync(object.body) : object.body;
    const response = new Response(bytes);
    return {
      arrayBuffer: () => response.clone().arrayBuffer(),
      body: response.body,
      text: () => response.clone().text(),
    };
  },
  async list() {
    return {
      cursor: "next-page",
      objects: objects.map(({ body: _body, ...object }) => object),
      truncated: true,
    };
  },
};
const env = { EXPORT_TOKEN: "test-secret", TELEMETRY: bucket };

const unauthorized = await handleRequest(new Request("https://example.test/v1/export"), env);
assert.equal(unauthorized.status, 401);

const oversized = await handleRequest(
  new Request("https://example.test/v1/export?limit=101", {
    headers: { authorization: "Bearer test-secret" },
  }),
  env,
);
assert.equal(oversized.status, 400);

const response = await handleRequest(
  new Request("https://example.test/v1/export?contractVersion=4", {
    headers: { authorization: "Bearer test-secret" },
  }),
  env,
);
assert.equal(response.status, 200);
assert.equal(response.headers.get("x-er-listed-objects"), "3");
assert.equal(response.headers.get("x-er-selected-objects"), "2");
assert.equal(response.headers.get("x-er-next-cursor"), "next-page");
const rows = (await response.text())
  .trim()
  .split("\n")
  .map(line => JSON.parse(line));
assert.deepEqual(rows[0], {
  body: '{"batch":"a"}',
  customMetadata: { combatContractVersion: "4", enc: "plain" },
  lastModified: "2026-08-03T00:00:00.000Z",
  size: 15,
  transferEncoding: "text",
});
assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(rows[1].bodyBase64, "base64")).toString("utf8")), { batch: "gzip" });
assert.deepEqual(
  { ...rows[1], bodyBase64: "<compressed>" },
  {
    bodyBase64: "<compressed>",
    customMetadata: { combatContractVersion: "4", enc: "gz" },
    lastModified: "2026-08-03T00:00:02.000Z",
    size: 21,
    transferEncoding: "base64-gzip",
  },
);

console.log("telemetry export worker tests passed");
