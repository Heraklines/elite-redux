// =============================================================================
// PER-BUILD DATA DICTIONARY generator (#player-telemetry). NOT runtime - a build-time script.
//
// Telemetry events carry numeric IDs (move/ability ids, held-item id strings) + the build id, NOT the
// balance values themselves. This script exports the id -> attributes tables the ML side joins against,
// keyed by build id, so training against a historical dataset joins against the dictionary OF THAT BUILD:
// a later balance change (a move's power, an ability's effect) can NEVER corrupt older data, because the
// old data is read with the old build's dictionary.
//
// Source of truth = the ER 2.65 authoritative dex tables already in the repo (src/data/elite-redux/
// er-moves.ts / er-abilities.ts / er-move-tables.ts). Those modules are pure static data (no imports),
// so this runs WITHOUT booting the engine - Node 24 strips the TS types on import.
//
// Usage:  node scripts/export-data-dictionary.mjs [--out <path>]
//   Default out: dev-logs/data-dictionary/er-data-dictionary-<build>.json
//
// The artifact is meant to be uploaded to R2 alongside telemetry, once per deployed build (the upload is
// wired later; this generator + the JSON contract is the deliverable now). See
// docs/plans/combat-ai-roadmap.md and docs/plans/player-telemetry-schema-v1.md.
// =============================================================================

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ER_ABILITIES } from "../src/data/elite-redux/er-abilities.ts";
import { ER_SPLIT_NAMES, ER_TARGET_NAMES } from "../src/data/elite-redux/er-move-tables.ts";
import { ER_MOVES } from "../src/data/elite-redux/er-moves.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
const build = pkg.version;

/** The telemetry schema version this dictionary pairs with (kept in sync with telemetry-schema.ts). */
const TELEMETRY_SCHEMA_VERSION = 1;

const moves = {};
for (const m of ER_MOVES) {
  moves[m.id] = {
    name: m.name,
    types: [...m.types],
    power: m.power,
    accuracy: m.accuracy,
    pp: m.pp,
    priority: m.priority,
    split: m.split,
    splitName: ER_SPLIT_NAMES[m.split] ?? String(m.split),
    target: m.target,
    targetName: ER_TARGET_NAMES[m.target] ?? String(m.target),
    effect: m.effect,
    effectChance: m.effectChance,
    flags: [...m.flags],
    // The 2.65 dex DESCRIPTION TEXT is authoritative (CLAUDE.md) - keep it so an attribute+text
    // featurization can embed it (see the roadmap's featurization principle).
    description: m.description,
    longDescription: m.longDescription,
  };
}

const abilities = {};
for (const a of ER_ABILITIES) {
  abilities[a.id] = {
    name: a.name,
    description: a.description,
  };
}

const dictionary = {
  schemaVersion: TELEMETRY_SCHEMA_VERSION,
  build,
  generatedAt: new Date().toISOString(),
  source: "ER 2.65 authoritative dex (er-moves.ts / er-abilities.ts / er-move-tables.ts)",
  splitNames: [...ER_SPLIT_NAMES],
  targetNames: [...ER_TARGET_NAMES],
  moves,
  abilities,
  // EXTENSION POINT: held-item ids in telemetry are ModifierType id STRINGS. Their id->name/attributes
  // table lives in the initialized modifier-type registry (needs an engine boot), so it is intentionally
  // left empty here and joined from a later engine-boot export. Documented in the roadmap.
  items: {},
};

const outArgIdx = process.argv.indexOf("--out");
const outPath =
  outArgIdx !== -1 && process.argv[outArgIdx + 1]
    ? resolve(process.cwd(), process.argv[outArgIdx + 1])
    : resolve(repoRoot, "dev-logs", "data-dictionary", `er-data-dictionary-${build}.json`);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(dictionary, null, 2));

console.log(
  `[data-dictionary] build ${build}: ${Object.keys(moves).length} moves, ${Object.keys(abilities).length} abilities -> ${outPath}`,
);
