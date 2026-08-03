#!/usr/bin/env node
import assert from "node:assert/strict";
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
];
const bucket = {
  async get(key) {
    const object = objects.find(candidate => candidate.key === key);
    return object ? { text: async () => object.body } : null;
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

const response = await handleRequest(
  new Request("https://example.test/v1/export?contractVersion=4", {
    headers: { authorization: "Bearer test-secret" },
  }),
  env,
);
assert.equal(response.status, 200);
assert.equal(response.headers.get("x-er-listed-objects"), "2");
assert.equal(response.headers.get("x-er-selected-objects"), "1");
assert.equal(response.headers.get("x-er-next-cursor"), "next-page");
assert.deepEqual(
  (await response.text())
    .trim()
    .split("\n")
    .map(line => JSON.parse(line)),
  [
    {
      body: '{"batch":"a"}',
      customMetadata: { combatContractVersion: "4", enc: "plain" },
      lastModified: "2026-08-03T00:00:00.000Z",
      size: 15,
    },
  ],
);

console.log("telemetry export worker tests passed");
