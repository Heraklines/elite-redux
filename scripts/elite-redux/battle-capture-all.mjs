#!/usr/bin/env node
// =============================================================================
// CLI runner — extensive battle capture across ALL wired bespoke abilities.
//
// Loads the dispatcher's bespoke-id list, spawns a vitest run targeting the
// bespoke-battle-capture.test.ts file, parses the per-ability CSV, prints a
// pretty table grouped by status (OK / NO-OBSERVABLE / CRASHED / INIT-FAILED),
// and exits non-zero on any CRASHED.
//
// Usage:
//   node scripts/elite-redux/battle-capture-all.mjs
//   node scripts/elite-redux/battle-capture-all.mjs --fast  (sanity only)
// =============================================================================

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const FAST = process.argv.includes("--fast");

const env = { ...process.env };
if (FAST) {
  env.ER_FAST = "1";
}

console.log(`\n=== Bespoke battle capture (${FAST ? "FAST mode — sanity only" : "FULL mode — heavy"}) ===\n`);

const result = spawnSync(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  ["test", "test/tests/elite-redux/integration/bespoke-battle-capture.test.ts"],
  {
    env,
    stdio: "inherit",
    timeout: FAST ? 60_000 : 900_000,
  },
);

const csvPath = "docs/plans/bespoke-battle-capture.csv";
if (!existsSync(csvPath)) {
  console.warn(`\n[capture] no CSV emitted at ${csvPath}; vitest may have crashed.`);
  process.exit(result.status ?? 1);
}

const csv = readFileSync(csvPath, "utf-8").trim().split(/\r?\n/).slice(1);
const buckets = { OK: [], "NO-OBSERVABLE": [], CRASHED: [], "INIT-FAILED": [] };
for (const line of csv) {
  const cols = line.match(/^(\d+),(-?\d+),(\w+(?:-\w+)*),"([^"]*)","([^"]*)"$/);
  if (!cols) {
    continue;
  }
  const [, erId, pkrgId, status, observable, error] = cols;
  buckets[status]?.push({ erId, pkrgId, observable, error });
}

console.log("\n=== Summary ===");
for (const [bucket, rows] of Object.entries(buckets)) {
  console.log(`${bucket.padEnd(14)} ${rows.length}`);
}

if (buckets.CRASHED.length > 0) {
  console.log("\n=== CRASHED ===");
  for (const row of buckets.CRASHED) {
    console.log(`  er ${row.erId} (${row.pkrgId}): ${row.error}`);
  }
}

if (buckets["NO-OBSERVABLE"].length > 0) {
  console.log("\n=== NO-OBSERVABLE (ability didn't visibly fire in 1 turn) ===");
  for (const row of buckets["NO-OBSERVABLE"]) {
    console.log(`  er ${row.erId} (pokerogue ${row.pkrgId})`);
  }
}

if (buckets.OK.length > 0) {
  console.log("\n=== OK ===");
  for (const row of buckets.OK) {
    console.log(`  er ${row.erId}: ${row.observable}`);
  }
}

process.exit(buckets.CRASHED.length > 0 ? 1 : 0);
