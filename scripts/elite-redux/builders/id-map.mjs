/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { emitModule } from "../lib/emit.mjs";

// Subset of v2.65 fields consumed by this transformer. See
// scripts/elite-redux/fixtures/README.md for the full schema.
/**
 * @typedef {Object} EnumKeyValue
 * @property {string} key   - UPPER_SNAKE_CASE
 * @property {number} value - numeric assignment
 */

/** First fresh ID per category. Anything ≥ these is an ER custom. */
const CUSTOM_ID_START = Object.freeze({
  species: 10000,
  abilities: 5000,
  moves: 5000,
  trainerClasses: 1000,
});

/**
 * Hand-curated aliases mapping ER trainer-class strings to pokerogue
 * `TrainerType` enum keys. Only entries that have a clear pokerogue
 * equivalent appear here; classes without a vanilla match get a fresh
 * custom ID at build time.
 *
 * Verified against `src/enums/trainer-type.ts` — every value below
 * resolves to a defined enum key.
 */
const TRAINER_CLASS_ALIASES = {
  "Pkmn Breeder": "BREEDER",
  "Pkmn Ranger": "RANGER",
  "Pkmn Trainer 1": "ACE_TRAINER",
  "Pkmn Trainer 2": "ACE_TRAINER",
  "Pkmn Trainer 3": "ACE_TRAINER",
  "Pkmn Trainer 4": "ACE_TRAINER",
  "Swimmer M": "SWIMMER",
  "Swimmer F": "SWIMMER",
  Cooltrainer: "ACE_TRAINER",
  "Cooltrainer 2": "ACE_TRAINER",
  "Team Aqua": "AQUA_GRUNT",
  "Team Magma": "MAGMA_GRUNT",
  "Aqua Admin": "AQUA_GRUNT",
  "Magma Admin": "MAGMA_GRUNT",
  "Aqua Leader": "ARCHIE",
  "Magma Leader": "MAXIE",
  "Bug Catcher": "BUG_CATCHER",
  "Battle Girl": "BLACK_BELT",
  "Ninja Boy": "ROUGHNECK",
  "Rich Boy": "RICH_KID",
  "Johto Champ": "LANCE_CHAMPION",
  "Monotype Champion": "BLUE",
  "Elite Four": "LORELEI",
  Leader: "BROCK",
  Champion: "BLUE",
  Triathlete: "CYCLIST",
  Kindler: "FIREBREATHER",
  Gentleman: "RICH",
  Skier: "SNOW_WORKER",
  Pokemaniac: "POKEFAN",
  Interviewer: "INTERVIEWERS",
  Winstrate: "POKEFAN",
  "Magikarp Guy": "FISHERMAN",
  "Sr And Jr": "TWINS",
  "Sis And Bro": "TWINS",
  "Old Couple": "YOUNG_COUPLE",
};

/**
 * Normalize a name for case+separator-insensitive matching.
 * Same rule as scripts/elite-redux/builders/abilities.mjs `normalizeName`.
 * @param {string} s
 */
export function normalizeName(s) {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Parse a pokerogue enum file and return a Map of `normalizedKey → numericValue`.
 * Handles both `KEY = N,` (explicit) and `KEY,` (sequential — auto-incremented).
 * If `= <expr>` is non-literal (unlikely for these enums but defensive), the
 * sequence is preserved by incrementing from the last value.
 *
 * Throws if fewer than `minSize` keys parse — drift guard against the enum
 * file format changing (split, const enum, generated, etc.) which would
 * silently flip every ER entity to "custom".
 *
 * @param {string} enumFilename - relative to src/enums/
 * @param {number} minSize
 * @returns {Promise<Map<string, number>>}
 */
export async function loadEnumValues(enumFilename, minSize) {
  const enumPath = resolve(import.meta.dirname, "../../../src/enums", enumFilename);
  const src = await readFile(enumPath, "utf8");
  /** @type {Map<string, number>} */
  const out = new Map();
  let lastValue = -1;
  // Match either `KEY = N,` (explicit), `KEY,` (sequential), or
  // `KEY = <expr>,` (non-literal — sequence-preserved).
  const lineRe = /^\s*([A-Z][A-Z0-9_]*)\s*(?:=\s*(-?\d+|[^,\n]+))?\s*,?/gm;
  for (const match of src.matchAll(lineRe)) {
    const key = match[1];
    const expr = match[2]?.trim();
    let value;
    if (expr === undefined) {
      value = lastValue + 1;
    } else if (/^-?\d+$/.test(expr)) {
      value = Number.parseInt(expr, 10);
    } else {
      // Non-literal expression (e.g. bitfield-style enum); skip but keep sequence.
      value = lastValue + 1;
    }
    out.set(normalizeName(key), value);
    lastValue = value;
  }
  if (out.size < minSize) {
    throw new Error(`loadEnumValues(${enumFilename}): parsed only ${out.size} keys, expected ≥${minSize}`);
  }
  return out;
}

/**
 * Build an ID map for one entity category. For each entry, the normalized
 * name is looked up in `vanillaMap`; on miss, a fresh custom ID is assigned
 * starting at `customStart` and incremented monotonically.
 *
 * @param {Iterable<{id: number, name: string}>} entries
 * @param {Map<string, number>} vanillaMap - normalized name → pokerogue numeric value
 * @param {number} customStart - first ID to assign for ER customs
 * @returns {{ map: Record<number, number>, vanillaCount: number, customCount: number }}
 */
export function buildIdMapForCategory(entries, vanillaMap, customStart) {
  /** @type {Record<number, number>} */
  const map = {};
  let nextCustom = customStart;
  let vanillaCount = 0;
  let customCount = 0;
  for (const e of entries) {
    // Special-case: ER's id=0 ability is "-------" (sentinel), id=-1 species is
    // SPECIES_NONE, id=0 move is MOVE_NONE. Map directly to pokerogue's NONE
    // constant (value 0 by convention in pokerogue's enums) without consuming
    // a custom ID slot. Without this, the normalized empty / "none" name would
    // miss the vanilla lookup and flip these sentinels into the custom range.
    if (e.id === 0 || e.id === -1) {
      map[e.id] = 0;
      vanillaCount++;
      continue;
    }
    const norm = normalizeName(e.name);
    const vanillaId = norm ? vanillaMap.get(norm) : undefined;
    if (vanillaId === undefined) {
      map[e.id] = nextCustom++;
      customCount++;
    } else {
      map[e.id] = vanillaId;
      vanillaCount++;
    }
  }
  return { map, vanillaCount, customCount };
}

/**
 * Build the trainer-class ID map. Differs from the generic per-category
 * builder by consulting the hand-curated alias table FIRST — only on a miss
 * does it fall back to direct name-normalized lookup, and finally to a
 * fresh custom ID.
 *
 * @param {string[]} classNames - ER tclassT array; the index is the ER class id
 * @param {Map<string, number>} vanillaMap - normalized TrainerType key → numeric value
 * @param {Readonly<Record<string, string>>} aliases
 * @returns {{ map: Record<number, number>, vanillaCount: number, customCount: number }}
 */
export function buildTrainerClassMap(classNames, vanillaMap, aliases) {
  /** @type {Record<number, number>} */
  const map = {};
  let nextCustom = CUSTOM_ID_START.trainerClasses;
  let vanillaCount = 0;
  let customCount = 0;
  for (let i = 0; i < classNames.length; i++) {
    const name = classNames[i];
    // Check explicit alias first.
    const aliasKey = aliases[name];
    if (aliasKey) {
      const v = vanillaMap.get(normalizeName(aliasKey));
      if (v !== undefined) {
        map[i] = v;
        vanillaCount++;
        continue;
      }
    }
    // Fall back to name-normalized match.
    const norm = normalizeName(name);
    const vanillaId = norm ? vanillaMap.get(norm) : undefined;
    if (vanillaId !== undefined) {
      map[i] = vanillaId;
      vanillaCount++;
      continue;
    }
    map[i] = nextCustom++;
    customCount++;
  }
  return { map, vanillaCount, customCount };
}

/** @type {import("../lib/builder-types.mjs").BuildFn} */
export async function build({ dump, outDir, flags }) {
  const speciesEnum = await loadEnumValues("species-id.ts", 1000);
  const abilitiesEnum = await loadEnumValues("ability-id.ts", 200);
  const movesEnum = await loadEnumValues("move-id.ts", 400);
  const trainerTypesEnum = await loadEnumValues("trainer-type.ts", 50);

  const speciesRaws = /** @type {Array<{id: number, NAME?: string, name?: string}>} */ (dump.species ?? []);
  const abilityRaws = /** @type {Array<{id: number, name?: string}>} */ (dump.abilities ?? []);
  const moveRaws = /** @type {Array<{id: number, NAME?: string, name?: string}>} */ (dump.moves ?? []);
  const tclassNames = /** @type {string[]} */ (dump.tclassT ?? []);

  // ER's NAME for species is "SPECIES_BULBASAUR"; pokerogue's enum key is
  // "BULBASAUR". Strip the SPECIES_ prefix before normalization. Same for
  // moves (MOVE_). Abilities have no const-NAME prefix — `name` is the
  // human-readable form ("Overgrow") and normalize() handles it.
  const speciesForLookup = speciesRaws.map(s => ({
    id: s.id,
    name: (s.NAME ?? s.name ?? "").replace(/^SPECIES_/, ""),
  }));
  const abilityEntries = abilityRaws.map(a => ({ id: a.id, name: a.name ?? "" }));
  const moveForLookup = moveRaws.map(m => ({
    id: m.id,
    name: (m.NAME ?? m.name ?? "").replace(/^MOVE_/, ""),
  }));

  const speciesResult = buildIdMapForCategory(speciesForLookup, speciesEnum, CUSTOM_ID_START.species);
  const abilitiesResult = buildIdMapForCategory(abilityEntries, abilitiesEnum, CUSTOM_ID_START.abilities);
  const movesResult = buildIdMapForCategory(moveForLookup, movesEnum, CUSTOM_ID_START.moves);
  const trainerResult = buildTrainerClassMap(tclassNames, trainerTypesEnum, TRAINER_CLASS_ALIASES);

  const idMap = {
    species: speciesResult.map,
    abilities: abilitiesResult.map,
    moves: movesResult.map,
    trainerClasses: trainerResult.map,
  };

  const body = `export interface ErIdMap {
  /** ER species id → pokerogue SpeciesId number, OR a fresh ID ≥10000 for ER customs. */
  readonly species: Readonly<Record<number, number>>;
  /** ER ability id → pokerogue AbilityId number, OR a fresh ID ≥5000 for ER customs. */
  readonly abilities: Readonly<Record<number, number>>;
  /** ER move id → pokerogue MoveId number, OR a fresh ID ≥5000 for ER customs. */
  readonly moves: Readonly<Record<number, number>>;
  /** ER trainer class id → pokerogue TrainerType number, OR a fresh ID ≥1000 for ER customs. */
  readonly trainerClasses: Readonly<Record<number, number>>;
}

export const ER_ID_MAP: ErIdMap = ${JSON.stringify(idMap, null, 2)} as const;
`;
  const aliasBody = `/** Manually-curated aliases for ER trainer classes whose names don't exact-match
 *  pokerogue's TrainerType enum after normalization. Used at build time by
 *  scripts/elite-redux/builders/id-map.mjs.
 */
export const ER_TRAINER_CLASS_ALIASES: Readonly<Record<string, string>> = ${JSON.stringify(TRAINER_CLASS_ALIASES, null, 2)} as const;
`;

  if (flags.dryRun) {
    console.log(
      `[er:idmap] would emit map (species: ${speciesResult.vanillaCount}/${speciesResult.customCount}, `
        + `abilities: ${abilitiesResult.vanillaCount}/${abilitiesResult.customCount}, `
        + `moves: ${movesResult.vanillaCount}/${movesResult.customCount}, `
        + `trainerClasses: ${trainerResult.vanillaCount}/${trainerResult.customCount})`,
    );
    return;
  }
  await emitModule(resolve(outDir, "er-id-map.ts"), body);
  await emitModule(resolve(outDir, "er-trainer-class-aliases.ts"), aliasBody);
  console.log(
    `[er:idmap] species: ${speciesResult.vanillaCount} vanilla / ${speciesResult.customCount} custom, `
      + `abilities: ${abilitiesResult.vanillaCount} / ${abilitiesResult.customCount}, `
      + `moves: ${movesResult.vanillaCount} / ${movesResult.customCount}, `
      + `trainerClasses: ${trainerResult.vanillaCount} / ${trainerResult.customCount}`,
  );
}
