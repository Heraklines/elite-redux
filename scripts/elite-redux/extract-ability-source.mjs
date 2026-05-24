#!/usr/bin/env node
// =============================================================================
// Extract ability implementation context from the ER C decomp source.
//
// Given an ER ability name (or pokerogue ABILITY_ name), greps the C source
// at vendor/elite-redux/source/ for the surrounding context (~30 lines of
// each case ABILITY_X: block). Useful for verifying ER ability implementation
// details that the pokedex JSON dump elides.
//
// Usage:
//   node scripts/elite-redux/extract-ability-source.mjs FLAME_BODY
//   node scripts/elite-redux/extract-ability-source.mjs "Sand Force"
//   node scripts/elite-redux/extract-ability-source.mjs --all-context FLAME_BODY
// =============================================================================

import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const arg = process.argv.slice(2).join(" ").trim();
if (!arg) {
  console.error("Usage: extract-ability-source.mjs <ABILITY_NAME>");
  process.exit(1);
}

const SOURCE_DIR = "vendor/elite-redux/source";
if (!existsSync(SOURCE_DIR)) {
  console.error(`ER source not found at ${SOURCE_DIR}. Run:`);
  console.error("  git clone --depth=1 https://github.com/Elite-Redux/eliteredux.git vendor/elite-redux/source");
  process.exit(2);
}

// Normalize the input to ABILITY_FOO_BAR form.
const enumName = arg.toUpperCase().replace(/[-\s]+/g, "_").replace(/^ABILITY_?/, "");
const macro = `ABILITY_${enumName}`;

console.log(`\n=== Source for ${macro} ===\n`);

// 1. Find the constant definition + comment.
try {
  const defGrep = execSync(
    `git -C "${SOURCE_DIR}" grep -nE "#define ${macro}\\b" -- "include/constants/abilities.h"`,
    { encoding: "utf-8" },
  );
  console.log("Definition:");
  console.log("  " + defGrep.trim());
} catch (_e) {
  console.log("(no #define found in include/constants/abilities.h)");
}

// 2. Find each case in battle_util.c
try {
  const caseGrep = execSync(
    `git -C "${SOURCE_DIR}" grep -nE "case ${macro}\\b" -- "src/*.c"`,
    { encoding: "utf-8" },
  );
  console.log("\nCase sites:");
  console.log(caseGrep);
} catch (_e) {
  console.log("\n(no case sites found in src/*.c)");
}

// 3. For each case, print +30 lines of context.
try {
  const caseGrep = execSync(
    `git -C "${SOURCE_DIR}" grep -nE "case ${macro}\\b" -- "src/*.c"`,
    { encoding: "utf-8" },
  );
  const lines = caseGrep.trim().split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^([^:]+):(\d+):/);
    if (!m) continue;
    const [, file, lineNum] = m;
    const start = Math.max(1, Number(lineNum) - 2);
    const end = Number(lineNum) + 30;
    const path = `${SOURCE_DIR}/${file}`;
    const content = readFileSync(path, "utf-8").split(/\r?\n/);
    const slice = content.slice(start - 1, end).join("\n");
    console.log(`\n--- ${file}:${start}-${end} ---\n${slice}\n`);
  }
} catch (_e) {
  /* no-op */
}
