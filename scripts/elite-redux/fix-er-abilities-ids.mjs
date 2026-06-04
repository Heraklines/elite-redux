#!/usr/bin/env node
// =============================================================================
// Elite Redux — fix ID drift in er-abilities.ts vs v2.65 JSON source.
//
// The build pipeline emits er-abilities.ts entries whose `id` field doesn't
// always match the v2.65 dump's actual position for that ability name. E.g.
// the dump has Cryostasis at index 981 and Flower Necklace at 982, but the
// emitted draft swaps them (id=981 Hollow Ice Zone, id=982 Cryostasis).
//
// This rewrites each draft entry's `id` field to match the position of the
// matching ability in the JSON dump (by name). The id-map (already resynced
// to the enum) plus the corrected draft IDs together make
// `allAbilities[id-map[draft.id]]` return the right ability instance.
// =============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = new URL("../..", import.meta.url).pathname.slice(1);
const DRAFT_FILE = join(REPO_ROOT, "src", "data", "elite-redux", "er-abilities.ts");
const DUMP_FILE = join(REPO_ROOT, "vendor", "elite-redux", "v2.65beta.json");

const dump = JSON.parse(readFileSync(DUMP_FILE, "utf-8"));

// Build name → JSON-position index. Empty/duplicate names (rare) get the
// first occurrence — those are the no-op slots between gen-X and ER ranges.
const nameToJsonId = new Map();
for (let i = 0; i < dump.abilities.length; i++) {
  const name = dump.abilities[i]?.name || "";
  if (name && !nameToJsonId.has(name)) {
    nameToJsonId.set(name, i);
  }
}

let content = readFileSync(DRAFT_FILE, "utf-8");

// Parse each draft entry's (id, name) pair, find the correct id from JSON
// position, and rewrite if different. Each entry looks like:
//   { "id": 982, "name": "Cryostasis", ...
let fixed = 0;
let unchanged = 0;
let unmapped = 0;
const seenJsonIds = new Set();

content = content.replace(
  /\{\s*"id":\s*(\d+),\s*"name":\s*"([^"]+)"/g,
  (match, idStr, name) => {
    const draftId = Number(idStr);
    const jsonId = nameToJsonId.get(name);
    if (jsonId === undefined) {
      unmapped++;
      return match;
    }
    if (jsonId !== draftId) {
      fixed++;
      seenJsonIds.add(jsonId);
      return match.replace(`"id": ${draftId}`, `"id": ${jsonId}`);
    }
    unchanged++;
    return match;
  },
);

console.log(`er-abilities draft fix:`);
console.log(`  fixed:    ${fixed} entry ids`);
console.log(`  unchanged: ${unchanged} (already correct)`);
console.log(`  unmapped: ${unmapped} (name not in JSON dump)`);

if (fixed > 0) {
  writeFileSync(DRAFT_FILE, content, "utf-8");
  console.log(`Wrote ${DRAFT_FILE}`);
}
