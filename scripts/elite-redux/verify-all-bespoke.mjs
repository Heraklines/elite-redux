#!/usr/bin/env node
// =============================================================================
// Elite Redux — verify every bespoke ability via the real dispatcher.
//
// Iterates ER_ABILITY_ARCHETYPES, picks every `archetype: "bespoke"` entry,
// calls `dispatchBespoke(erId)`, and classifies the result as:
//
//   - WIRED      — dispatcher returned `ok([...attrs])` with ≥1 AbAttr
//   - SKIP       — dispatcher returned `SKIP_BESPOKE` (formally deferred)
//   - ERROR      — dispatcher threw an exception
//   - MISSING    — no case in the switch (falls through to default)
//
// The whole point: this exercises the ACTUAL `dispatchBespoke` function
// the game uses at init time, not a parallel test harness. So if a wire
// passes verification here, the game will behave the same way.
//
// Output: pretty table + CSV for tracking. Exits non-zero if any ERROR.
// Usage:  pnpm node scripts/elite-redux/verify-all-bespoke.mjs [--csv]
// =============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = new URL("../..", import.meta.url).pathname.slice(1);

// Generate a tiny TS verifier that imports the real dispatcher, runs it
// over every bespoke id, and emits JSON to stdout. We spawn tsx to run it
// so the imports resolve via the project's tsconfig.
const VERIFIER_SRC = `
import { ER_ABILITY_ARCHETYPES } from "#data/elite-redux/er-ability-archetypes";
import { dispatchBespoke } from "#data/elite-redux/archetype-dispatcher";
import { initAbilities } from "#data/abilities/init-abilities";
import { initEliteReduxCustomAbilities } from "#data/elite-redux/init-elite-redux-custom-abilities";

// Pokerogue's ability table needs init before the dispatcher can resolve
// references to vanilla AbAttrs in some wires.
try {
  initAbilities();
  initEliteReduxCustomAbilities();
} catch (e) {
  // Some inits depend on global scene; tolerate failure here — the
  // dispatcher itself doesn't need scene at construct time.
}

const bespoke = Object.values(ER_ABILITY_ARCHETYPES).filter(e => e.archetype === "bespoke");
const results = [];
for (const entry of bespoke) {
  if (entry.erAbilityId === 0) continue;
  try {
    const res = dispatchBespoke(entry.erAbilityId);
    const attrCount = res.attrs?.length ?? 0;
    const status =
      attrCount > 0 ? "WIRED" : res.skipReason ? "SKIP" : "EMPTY";
    const constructorNames = (res.attrs ?? []).map(a => a.constructor?.name ?? "?").join(",");
    results.push({
      erId: entry.erAbilityId,
      status,
      attrCount,
      constructorNames,
      skipReason: res.skipReason ?? "",
    });
  } catch (err) {
    results.push({
      erId: entry.erAbilityId,
      status: "ERROR",
      attrCount: 0,
      constructorNames: "",
      skipReason: err instanceof Error ? err.message : String(err),
    });
  }
}
console.log(JSON.stringify(results));
`;

const verifierPath = join(REPO_ROOT, "scripts", "elite-redux", ".verify-bespoke-runner.ts");
writeFileSync(verifierPath, VERIFIER_SRC);

const dump = JSON.parse(readFileSync(join(REPO_ROOT, "vendor", "elite-redux", "v2.65beta.json"), "utf-8"));
const abilityNameById = new Map();
for (let i = 0; i < dump.abilities.length; i++) {
  abilityNameById.set(i, dump.abilities[i]?.name ?? "?");
}

console.log("Running dispatcher over every bespoke ER ability...");
const proc = spawnSync(
  process.execPath,
  ["--no-warnings", "--import", "tsx", verifierPath],
  { cwd: REPO_ROOT, encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 },
);

if (proc.status !== 0) {
  console.error("Verifier failed:");
  console.error(proc.stderr);
  process.exit(1);
}

// Parse last JSON line from stdout (other lines may be init noise).
const lines = proc.stdout.split(/\r?\n/).filter(l => l.trim().startsWith("["));
const results = JSON.parse(lines[lines.length - 1]);

const stats = { WIRED: 0, SKIP: 0, EMPTY: 0, ERROR: 0 };
for (const r of results) stats[r.status] = (stats[r.status] ?? 0) + 1;

console.log("\n=== Bespoke ability dispatch verification ===\n");
console.log("Status   Count    Pct");
const total = results.length;
for (const [status, count] of Object.entries(stats)) {
  const pct = ((count / total) * 100).toFixed(1).padStart(5);
  console.log(`${status.padEnd(8)} ${String(count).padStart(5)}    ${pct}%`);
}
console.log(`TOTAL    ${String(total).padStart(5)}    100.0%\n`);

if (process.argv.includes("--csv")) {
  const csv = ["er_id,name,status,attr_count,constructors,skip_reason"];
  for (const r of results) {
    const name = (abilityNameById.get(r.erId) ?? "?").replace(/,/g, " ");
    const reason = r.skipReason.replace(/,/g, ";").replace(/\n/g, " ");
    csv.push(`${r.erId},${name},${r.status},${r.attrCount},${r.constructorNames},${reason}`);
  }
  const csvPath = join(REPO_ROOT, "docs", "plans", "elite-redux-bespoke-verify.csv");
  writeFileSync(csvPath, csv.join("\n"));
  console.log(`CSV written to ${csvPath}`);
}

if (stats.ERROR > 0) {
  console.log("\nERRORS:");
  for (const r of results.filter(r => r.status === "ERROR")) {
    console.log(`  er ${r.erId} (${abilityNameById.get(r.erId)}): ${r.skipReason}`);
  }
  process.exit(1);
}
