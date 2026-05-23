#!/usr/bin/env node
// =============================================================================
// Elite Redux — resync the id-map's abilities/moves/species sections to match
// the auto-generated enums.
//
// The build pipeline emits both files independently. When the walk-order
// differs between them (observed: 77 ability mismatches between
// er-id-map.ts and er-ability-id.ts after a clean build), the id-map's
// ER→pokerogue mapping points to the wrong allAbilities[] slot, surfacing as
// "Flower Necklace shows as Cryostasis in the dex" and similar.
//
// The enums are canonical: each name has exactly one numeric id. We re-derive
// the id-map's custom-id entries by:
//   1. For each ER ability, normalize its name to the enum-key form.
//   2. Look that key up in the enum to get the canonical pokerogue id.
//   3. Rewrite id-map[er_id] = canonical pokerogue id.
//
// Vanilla mappings (pokerogue ids < 5000) are left untouched — they reference
// pokerogue's vanilla AbilityId/MoveId/SpeciesId enums which the id-map
// builder gets right.
// =============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = new URL("../..", import.meta.url).pathname.slice(1);
const ID_MAP_FILE = join(REPO_ROOT, "src", "data", "elite-redux", "er-id-map.ts");
const ABILITY_ENUM_FILE = join(REPO_ROOT, "src", "enums", "er-ability-id.ts");
const MOVE_ENUM_FILE = join(REPO_ROOT, "src", "enums", "er-move-id.ts");
const SPECIES_ENUM_FILE = join(REPO_ROOT, "src", "enums", "er-species-id.ts");
const DUMP_FILE = join(REPO_ROOT, "vendor", "elite-redux", "v2.65beta.json");

function loadEnum(path) {
  const content = readFileSync(path, "utf-8");
  const out = new Map();
  for (const m of content.matchAll(/^\s+([A-Z][A-Z0-9_]*):\s*(\d+),/gm)) {
    out.set(m[1], Number(m[2]));
  }
  return out;
}

// Normalize an ER source name ("Flower Necklace", "King's Rock", "Mr. Mime") to
// the enum-key form ("FLOWER_NECKLACE", "KINGS_ROCK", "MR_MIME"). Mirrors the
// build-pipeline's naming, derived empirically against the existing enum.
function nameToEnumKey(rawName) {
  return rawName
    .toUpperCase()
    .replace(/['’‘]/g, "")
    .replace(/[â]/g, "")
    .replace(/[^A-Z0-9 _\-]/g, "")
    .trim()
    .replace(/[\s\-]+/g, "_")
    .replace(/^SPECIES_/, "")
    .replace(/_+/g, "_");
}

function resyncSection(idMapPairs, erEntries, enumMap, sectionName) {
  let fixed = 0;
  let unmapped = 0;
  for (const [erIdStr, pokerogueId] of Object.entries(idMapPairs)) {
    const erId = Number(erIdStr);
    if (pokerogueId < 5000 && sectionName !== "species") continue;
    if (sectionName === "species" && pokerogueId < 10000) continue;
    if (erId < 0 || erId >= erEntries.length) continue;
    const entry = erEntries[erId];
    if (!entry) continue;
    const rawName = entry.name || (sectionName === "species" ? (entry.NAME || "").replace(/^SPECIES_/, "") : "");
    if (!rawName) continue;
    const enumKey = nameToEnumKey(rawName);
    const canonical = enumMap.get(enumKey);
    if (canonical === undefined) {
      unmapped++;
      continue;
    }
    if (idMapPairs[erIdStr] !== canonical) {
      idMapPairs[erIdStr] = canonical;
      fixed++;
    }
  }
  console.log(`  ${sectionName}: ${fixed} entries resynced, ${unmapped} unmapped`);
  return { fixed, unmapped };
}

function main() {
  const dump = JSON.parse(readFileSync(DUMP_FILE, "utf-8"));
  const idMapContent = readFileSync(ID_MAP_FILE, "utf-8");

  const abilityEnum = loadEnum(ABILITY_ENUM_FILE);
  const moveEnum = loadEnum(MOVE_ENUM_FILE);
  const speciesEnum = loadEnum(SPECIES_ENUM_FILE);

  // Parse each section of the id-map, resync, re-emit.
  const sections = { abilities: dump.abilities, moves: dump.moves, species: dump.species };
  const enums = { abilities: abilityEnum, moves: moveEnum, species: speciesEnum };

  let updated = idMapContent;
  let totalFixed = 0;

  for (const [sectionName, entries] of Object.entries(sections)) {
    const sectionRegex = new RegExp(`"${sectionName}":\\s*\\{([^}]+)\\}`, "s");
    const match = sectionRegex.exec(updated);
    if (!match) {
      console.warn(`section ${sectionName} not found in id-map`);
      continue;
    }
    const body = match[1];
    const pairs = {};
    for (const m of body.matchAll(/"(\d+)":\s*(\d+)/g)) {
      pairs[m[1]] = Number(m[2]);
    }
    const { fixed } = resyncSection(pairs, entries, enums[sectionName], sectionName);
    totalFixed += fixed;

    // Re-emit section body preserving the existing order (sorted numerically).
    const sortedKeys = Object.keys(pairs)
      .map(k => [Number(k), k])
      .sort((a, b) => a[0] - b[0]);
    const newBody = sortedKeys.map(([_, k]) => `    "${k}": ${pairs[k]}`).join(",\n");
    const newSection = `"${sectionName}": {\n${newBody}\n  }`;
    updated = updated.replace(sectionRegex, newSection);
  }

  if (totalFixed > 0) {
    writeFileSync(ID_MAP_FILE, updated, "utf-8");
    console.log(`Wrote ${ID_MAP_FILE} with ${totalFixed} entry fixes`);
  } else {
    console.log("No fixes needed — id-map already in sync.");
  }
}

main();
