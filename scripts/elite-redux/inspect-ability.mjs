#!/usr/bin/env node
// =============================================================================
// Quick inspector — given an ability name or er id, prints the ER spec and
// the current wiring side-by-side so you can eyeball mismatches.
//
// Usage:
//   node scripts/elite-redux/inspect-ability.mjs "Flame Body"
//   node scripts/elite-redux/inspect-ability.mjs 49
//   node scripts/elite-redux/inspect-ability.mjs                 # list all
// =============================================================================

import { readFileSync } from "node:fs";

const arg = process.argv[2];

const dump = JSON.parse(readFileSync("vendor/elite-redux/v2.65beta.json", "utf-8"));

function findAbility(input) {
  const n = Number(input);
  if (!Number.isNaN(n)) {
    return dump.abilities[n];
  }
  const lower = String(input).toLowerCase();
  return dump.abilities.find(a => a && a.name && a.name.toLowerCase() === lower);
}

const archetypeFile = readFileSync("src/data/elite-redux/er-ability-archetypes.ts", "utf-8");
const dispatcherFile = readFileSync("src/data/elite-redux/archetype-dispatcher.ts", "utf-8");
const rebalanceFile = readFileSync("src/data/elite-redux/init-elite-redux-vanilla-rebalance.ts", "utf-8");

function classifierLine(erId) {
  const re = new RegExp(`^\\s*${erId}: \\{[^}]+\\}`, "m");
  const m = archetypeFile.match(re);
  return m ? m[0].trim() : "(no classifier entry)";
}

function dispatcherCase(erId) {
  const re = new RegExp(`case ${erId}:[^\\n]*\\n(?:\\s+//[^\\n]*\\n)*\\s+return [^;]+;`, "m");
  const m = dispatcherFile.match(re);
  return m ? m[0] : "(no dispatcher case)";
}

function vanillaPatch(name) {
  if (!name) return null;
  const enumName = name.replace(/\s/g, "_").toUpperCase().replace(/[^A-Z_0-9]/g, "");
  const re = new RegExp(`\\[AbilityId\\.${enumName},[^\\]]+\\]`, "m");
  const m = rebalanceFile.match(re);
  return m ? m[0] : null;
}

if (!arg) {
  console.log("Usage: node scripts/elite-redux/inspect-ability.mjs <name|id>");
  console.log("\nSample of available abilities (first 20):");
  for (let i = 1; i <= 20; i++) {
    const a = dump.abilities[i];
    if (a) console.log(`  ${i}: ${a.name}`);
  }
  process.exit(0);
}

const a = findAbility(arg);
if (!a) {
  console.error(`No ability found for: ${arg}`);
  process.exit(1);
}

console.log(`\n=== ER ability #${a.id}: ${a.name} ===`);
console.log(`\nSpec: ${a.desc}`);
console.log(`\nClassifier: ${classifierLine(a.id)}`);

const patch = vanillaPatch(a.name);
if (patch) {
  console.log(`\nVanilla rebalance patch:\n  ${patch}`);
} else {
  console.log(`\nVanilla rebalance: (no entry — vanilla pokerogue behavior unchanged)`);
}

console.log(`\nDispatcher case:\n${dispatcherCase(a.id)}`);
console.log();
