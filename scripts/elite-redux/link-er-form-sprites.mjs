#!/usr/bin/env node
// =============================================================================
// Elite Redux — link/copy ER form sprites into pokerogue's id-keyed layout.
//
// ER ships sprites as `assets/images/pokemon/elite-redux/<slug>/{front,back,
// shiny,icon,...}.png` (slug-keyed directories). Pokerogue's sprite loader
// expects flat files at `assets/images/pokemon/<id>-<formKey>.png` (front),
// `assets/images/pokemon/back/<id>-<formKey>.png` (back), etc.
//
// For each ER form variant injected by `initEliteReduxSpecies` (mega / primal
// / regional / forme), this script copies the ER source PNG into the
// pokerogue-expected path so the dex / battle scene can find it. Idempotent.
// =============================================================================

import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

const REPO_ROOT = new URL("../..", import.meta.url).pathname.slice(1); // strip leading "/" on Windows
const ER_SPRITE_DIR = join(REPO_ROOT, "assets", "images", "pokemon", "elite-redux");
const POKEROGUE_SPRITE_DIR = join(REPO_ROOT, "assets", "images", "pokemon");

// ER suffix → pokerogue form key. Mirrors ER_FORM_SUFFIXES in
// init-elite-redux-species.ts (longest-match-first ordering).
const SUFFIX_TO_FORMKEY = [
  ["_mega_x", "mega-x"],
  ["_mega_y", "mega-y"],
  ["_hisuian_mega", "hisui-mega"],
  ["_mega_galarian", "galar-mega"],
  ["_primal", "primal"],
  ["_origin", "origin"],
  ["_mega", "mega"],
  ["_alolan", "alola"],
  ["_galarian", "galar"],
  ["_hisuian", "hisui"],
  ["_paldean", "paldea"],
  ["_sunny", "sunny"],
  ["_rainy", "rainy"],
  ["_snowy", "snowy"],
  ["_attack", "attack"],
  ["_defense", "defense"],
  ["_speed", "speed"],
  ["_heat", "heat"],
];

// Read the auto-generated ER species table to map slug → species id.
async function loadSpeciesMap() {
  const erSpeciesFile = join(REPO_ROOT, "src", "data", "elite-redux", "er-species.ts");
  const idMapFile = join(REPO_ROOT, "src", "data", "elite-redux", "er-id-map.ts");
  const { readFileSync } = await import("node:fs");
  const idMapContent = readFileSync(idMapFile, "utf-8");
  const idMapMatch = idMapContent.match(/"species":\s*\{([^}]+)\}/s);
  const idPairs = new Map();
  for (const [, k, v] of idMapMatch[1].matchAll(/"(\d+)":\s*(\d+)/g)) {
    idPairs.set(Number(k), Number(v));
  }

  const erSpeciesContent = readFileSync(erSpeciesFile, "utf-8");
  // Parse `{ "id": N, "speciesConst": "SPECIES_X", ...}` records.
  const slugById = new Map(); // erId → slug (lowercased speciesConst minus "SPECIES_")
  const constById = new Map(); // erId → speciesConst
  for (const [, idStr, constName] of erSpeciesContent.matchAll(/"id":\s*(-?\d+),\s*"speciesConst":\s*"([^"]+)"/g)) {
    const erId = Number(idStr);
    if (erId < 0) {
      continue;
    }
    const slug = constName.replace(/^SPECIES_/, "").toLowerCase();
    slugById.set(erId, slug);
    constById.set(erId, constName);
  }
  return { idPairs, slugById, constById };
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(filePath) {
  await mkdir(dirname(filePath), { recursive: true });
}

async function copyIfMissing(src, dst, report) {
  if (!(await exists(src))) {
    report.missingSource++;
    return;
  }
  if (await exists(dst)) {
    report.skippedExisting++;
    return;
  }
  await ensureDir(dst);
  await copyFile(src, dst);
  report.copied++;
}

async function main() {
  const { idPairs, slugById, constById } = await loadSpeciesMap();
  const report = { copied: 0, skippedExisting: 0, missingSource: 0, processedForms: 0 };

  // For each ER species, check if it's a form variant of a vanilla species.
  // If so, locate the base species and copy front/back/shiny/icon PNGs into
  // pokerogue's expected paths under the base species's id + form key.
  for (const [erId, slug] of slugById) {
    const constName = constById.get(erId);
    // Find a matching suffix
    let match = null;
    for (const [suffix, formKey] of SUFFIX_TO_FORMKEY) {
      if (slug.endsWith(suffix)) {
        const baseSlug = slug.slice(0, -suffix.length);
        const baseConst = `SPECIES_${baseSlug.toUpperCase()}`;
        // Find the base species's pokerogue id (via reverse lookup)
        const baseErId = [...constById.entries()].find(([_, c]) => c === baseConst)?.[0];
        if (baseErId !== undefined) {
          const basePokerogueId = idPairs.get(baseErId);
          if (basePokerogueId !== undefined && basePokerogueId < 10000) {
            match = { baseId: basePokerogueId, formKey };
            break;
          }
        }
      }
    }
    // No form-suffix match: maybe this is a standalone ER-custom species
    // (e.g. SPECIES_CRABRUISER_REDUX is a new species with pokerogue id >= 10000,
    // not a form on a vanilla mon). Link its sprites at the canonical
    // id-keyed path so the dex/battle can find them.
    if (!match) {
      const customPokerogueId = idPairs.get(erId);
      if (customPokerogueId === undefined || customPokerogueId < 10000) {
        continue;
      }
      report.processedForms++;
      const sourceDir = join(ER_SPRITE_DIR, slug);
      const targetBase = `${customPokerogueId}`;
      await copyIfMissing(join(sourceDir, "front.png"), join(POKEROGUE_SPRITE_DIR, `${targetBase}.png`), report);
      await copyIfMissing(join(sourceDir, "back.png"), join(POKEROGUE_SPRITE_DIR, "back", `${targetBase}.png`), report);
      await copyIfMissing(
        join(sourceDir, "shiny.png"),
        join(POKEROGUE_SPRITE_DIR, "shiny", `${targetBase}.png`),
        report,
      );
      await copyIfMissing(
        join(sourceDir, "shiny-back.png"),
        join(POKEROGUE_SPRITE_DIR, "back", "shiny", `${targetBase}.png`),
        report,
      );
      await copyIfMissing(
        join(sourceDir, "shiny-2.png"),
        join(POKEROGUE_SPRITE_DIR, "shiny", `${targetBase}_2.png`),
        report,
      );
      await copyIfMissing(
        join(sourceDir, "shiny-3.png"),
        join(POKEROGUE_SPRITE_DIR, "shiny", `${targetBase}_3.png`),
        report,
      );
      await copyIfMissing(
        join(sourceDir, "icon.png"),
        join(POKEROGUE_SPRITE_DIR, "icons", `${targetBase}.png`),
        report,
      );
      continue;
    }

    report.processedForms++;
    const sourceDir = join(ER_SPRITE_DIR, slug);
    const targetBase = `${match.baseId}-${match.formKey}`;

    // Also link to the standalone ER-custom species id if this form was
    // registered as its own species (e.g. SPECIES_MEGANIUM_MEGA → pokerogue
    // id 10457). Players reaching the custom species via the dex's next/prev
    // navigation hit the bare id path; players reaching it via the form-cycle
    // hit the form path. Cover both.
    const standaloneId = idPairs.get(erId);
    if (standaloneId !== undefined && standaloneId >= 10000) {
      await copyIfMissing(join(sourceDir, "front.png"), join(POKEROGUE_SPRITE_DIR, `${standaloneId}.png`), report);
      await copyIfMissing(
        join(sourceDir, "back.png"),
        join(POKEROGUE_SPRITE_DIR, "back", `${standaloneId}.png`),
        report,
      );
      await copyIfMissing(
        join(sourceDir, "shiny.png"),
        join(POKEROGUE_SPRITE_DIR, "shiny", `${standaloneId}.png`),
        report,
      );
      await copyIfMissing(
        join(sourceDir, "icon.png"),
        join(POKEROGUE_SPRITE_DIR, "icons", `${standaloneId}.png`),
        report,
      );
    }

    // Copy the standard set of sprites.
    await copyIfMissing(join(sourceDir, "front.png"), join(POKEROGUE_SPRITE_DIR, `${targetBase}.png`), report);
    await copyIfMissing(join(sourceDir, "back.png"), join(POKEROGUE_SPRITE_DIR, "back", `${targetBase}.png`), report);
    await copyIfMissing(join(sourceDir, "shiny.png"), join(POKEROGUE_SPRITE_DIR, "shiny", `${targetBase}.png`), report);
    await copyIfMissing(
      join(sourceDir, "shiny-back.png"),
      join(POKEROGUE_SPRITE_DIR, "back", "shiny", `${targetBase}.png`),
      report,
    );
    await copyIfMissing(
      join(sourceDir, "shiny-2.png"),
      join(POKEROGUE_SPRITE_DIR, "shiny", `${targetBase}_2.png`),
      report,
    );
    await copyIfMissing(
      join(sourceDir, "shiny-3.png"),
      join(POKEROGUE_SPRITE_DIR, "shiny", `${targetBase}_3.png`),
      report,
    );
    await copyIfMissing(join(sourceDir, "icon.png"), join(POKEROGUE_SPRITE_DIR, "icons", `${targetBase}.png`), report);
  }

  console.log(`er-link-form-sprites: ${report.processedForms} ER form variants processed`);
  console.log(`  copied:           ${report.copied}`);
  console.log(`  skipped existing: ${report.skippedExisting}`);
  console.log(`  missing source:   ${report.missingSource}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
