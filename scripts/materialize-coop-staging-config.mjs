#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = resolve(ROOT, "workers/er-coop-api/wrangler.staging.toml");
const PRODUCTION = resolve(ROOT, "workers/er-coop-api/wrangler.toml");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA = /^[0-9a-f]{40}$/u;

const [databaseId, sourceSha, outputArg] = process.argv.slice(2);
if (!UUID.test(databaseId ?? "")) {
  throw new Error("staging co-op D1 id must be a canonical UUID");
}
if (!SHA.test(sourceSha ?? "")) {
  throw new Error("staging co-op source SHA must be a full lowercase Git SHA");
}
if (!outputArg) {
  throw new Error("an output config path is required");
}

const production = readFileSync(PRODUCTION, "utf8");
const productionId = production.match(/^database_id\s*=\s*"([^"]+)"\s*$/mu)?.[1];
if (!UUID.test(productionId ?? "")) {
  throw new Error("production co-op D1 id is missing or malformed");
}
if (databaseId.toLowerCase() === productionId.toLowerCase()) {
  throw new Error("refusing to bind the staging co-op Worker to the production D1");
}

const template = readFileSync(TEMPLATE, "utf8");
if (!/^name\s*=\s*"er-coop-api-staging"\s*$/mu.test(template)) {
  throw new Error("staging template must target er-coop-api-staging");
}
if (!/^database_name\s*=\s*"er-coop-staging"\s*$/mu.test(template)) {
  throw new Error("staging template must target er-coop-staging");
}
if ((template.match(/__STAGING_COOP_D1_ID__/gu) ?? []).length !== 1) {
  throw new Error("staging template must contain exactly one D1 placeholder");
}
if ((template.match(/__SOURCE_SHA__/gu) ?? []).length !== 1) {
  throw new Error("staging template must contain exactly one source-SHA placeholder");
}

const output = resolve(ROOT, outputArg);
if (!output.startsWith(`${ROOT}\\`) && !output.startsWith(`${ROOT}/`)) {
  throw new Error("output config must remain inside the repository workspace");
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  template.replace("__STAGING_COOP_D1_ID__", databaseId).replace("__SOURCE_SHA__", sourceSha),
  "utf8",
);
console.log(`materialized isolated staging co-op config at ${outputArg}`);
