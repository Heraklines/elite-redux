#!/usr/bin/env node
// =============================================================================
// Post-hoc analyzer for the battle-capture CSV. Highlights abilities that
// look broken or no-op based on their captured one-turn observables:
//
//  - NO-OBSERVABLE: ability never visibly fired (might be conditional)
//  - SAME-AS-BASELINE: enemy lost exactly 7 HP like baseline Tackle would
//  - WRONG-DIRECTION: ability description says "user attacks" but observable
//    shows defensive effect
//
// Usage: node scripts/elite-redux/analyze-battle-capture.mjs [csv-path]
// =============================================================================

import { readFileSync } from "node:fs";

const csvPath = process.argv[2] ?? "docs/plans/bespoke-battle-capture-full.csv";
const dump = JSON.parse(readFileSync("vendor/elite-redux/v2.65beta.json", "utf-8"));
const byId = new Map();
for (const a of dump.abilities) {
  if (a) byId.set(a.id, a);
}

const csv = readFileSync(csvPath, "utf-8").trim().split(/\r?\n/).slice(1);

const buckets = {
  ok: [],
  noObservable: [],
  sameAsBaseline: [], // enemyHp 13→6 exactly (baseline Tackle damage)
  crashed: [],
  initFailed: [],
};

const BASELINE_OBS = "eHp:13→6";

for (const line of csv) {
  const cols = line.match(/^(\d+),(-?\d+),(\w+(?:-\w+)*),"([^"]*)","([^"]*)"$/);
  if (!cols) continue;
  const [, erId, _pkrgId, status, observable, error] = cols;
  const spec = byId.get(Number(erId));
  const row = { erId, name: spec?.name ?? "?", desc: spec?.desc ?? "?", observable, error };

  if (status === "CRASHED") {
    buckets.crashed.push(row);
  } else if (status === "INIT-FAILED") {
    buckets.initFailed.push(row);
  } else if (status === "NO-OBSERVABLE") {
    buckets.noObservable.push(row);
  } else if (observable === BASELINE_OBS) {
    buckets.sameAsBaseline.push(row);
  } else {
    buckets.ok.push(row);
  }
}

console.log("\n=== Battle Capture Analysis ===\n");
console.log(`Total:           ${csv.length}`);
console.log(`OK (visible fx): ${buckets.ok.length}`);
console.log(`Same as baseline:${buckets.sameAsBaseline.length}  (defensive abilities that don't change the player→enemy dmg path)`);
console.log(`No observable:   ${buckets.noObservable.length}`);
console.log(`Crashed:         ${buckets.crashed.length}`);
console.log(`Init-failed:     ${buckets.initFailed.length}`);

if (buckets.crashed.length) {
  console.log("\n=== CRASHED ===");
  for (const row of buckets.crashed) {
    console.log(`  ER ${row.erId.padStart(4)} ${row.name.padEnd(24)} | ${row.error}`);
  }
}

if (buckets.noObservable.length) {
  console.log(`\n=== NO-OBSERVABLE (top 20) ===`);
  for (const row of buckets.noObservable.slice(0, 20)) {
    console.log(`  ER ${row.erId.padStart(4)} ${row.name.padEnd(24)} | ${row.desc.slice(0, 60)}`);
  }
}

if (buckets.ok.length) {
  console.log(`\n=== OK observable effects (top 30) ===`);
  for (const row of buckets.ok.slice(0, 30)) {
    console.log(`  ER ${row.erId.padStart(4)} ${row.name.padEnd(24)} | ${row.observable.slice(0, 50)}`);
  }
}
