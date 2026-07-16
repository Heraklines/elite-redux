import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SCRIPT = resolve(ROOT, "scripts/materialize-coop-staging-config.mjs");
const PRODUCTION_CONFIG = resolve(ROOT, "workers/er-coop-api/wrangler.toml");
const SOURCE_SHA = "a".repeat(40);

function invoke(databaseId, output) {
  return spawnSync(process.execPath, [SCRIPT, databaseId, SOURCE_SHA, relative(ROOT, output)], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

test("staging config materialization replaces both seals and rejects production D1", () => {
  const directory = mkdtempSync(resolve(ROOT, ".tmp-coop-staging-config-"));
  try {
    const output = resolve(directory, "wrangler.toml");
    const stagingId = "11111111-1111-4111-8111-111111111111";
    const accepted = invoke(stagingId, output);
    assert.equal(accepted.status, 0, accepted.stderr);
    const config = readFileSync(output, "utf8");
    assert.match(config, new RegExp(`database_id = "${stagingId}"`, "u"));
    assert.match(config, new RegExp(`SOURCE_SHA = "${SOURCE_SHA}"`, "u"));
    assert.doesNotMatch(config, /__[A-Z0-9_]+__/u);

    const productionId = readFileSync(PRODUCTION_CONFIG, "utf8").match(/^database_id\s*=\s*"([^"]+)"$/mu)?.[1];
    assert.ok(productionId);
    const rejected = invoke(productionId, resolve(directory, "must-not-exist.toml"));
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /refusing to bind the staging co-op Worker to the production D1/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
