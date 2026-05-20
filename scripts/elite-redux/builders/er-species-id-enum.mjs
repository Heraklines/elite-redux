/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { resolve } from "node:path";
import { emitModule } from "../lib/emit.mjs";
import { buildIdMapForCategory, loadEnumValues } from "./id-map.mjs";

const CUSTOM_ID_START = 10000;

/**
 * Convert an ER species const (e.g. `SPECIES_CRABRUISER_REDUX`) into the
 * enum-key form used in `er-species-id.ts` (e.g. `CRABRUISER_REDUX`). Strips
 * the `SPECIES_` prefix; throws on a const that doesn't start with that
 * prefix so we surface upstream data drift loudly.
 *
 * @param {string} speciesConst
 * @returns {string}
 */
export function speciesConstToEnumKey(speciesConst) {
  if (typeof speciesConst !== "string") {
    throw new TypeError(`speciesConst must be a string, got ${typeof speciesConst}`);
  }
  if (!speciesConst.startsWith("SPECIES_")) {
    throw new Error(`speciesConst missing "SPECIES_" prefix: ${speciesConst}`);
  }
  return speciesConst.slice("SPECIES_".length);
}

/**
 * Builds the `er-species-id.ts` enum body. Mirrors the id-assignment logic
 * from `scripts/elite-redux/builders/id-map.mjs` (`buildIdMapForCategory`) so
 * the values here align with `ER_ID_MAP.species[*]` for the same entries.
 *
 * @type {import("../lib/builder-types.mjs").BuildFn}
 */
export async function build({ dump, outDir, flags }) {
  const speciesEnum = await loadEnumValues("species-id.ts", 1000);
  const speciesRaws = /** @type {Array<{id: number, NAME?: string, name?: string}>} */ (dump.species ?? []);

  // Mirror id-map.mjs's name-stripping rule (drop the "SPECIES_" prefix
  // before normalization) so vanilla matches resolve identically.
  const speciesForLookup = speciesRaws.map(s => ({
    id: s.id,
    name: (s.NAME ?? s.name ?? "").replace(/^SPECIES_/, ""),
  }));

  const { map } = buildIdMapForCategory(speciesForLookup, speciesEnum, CUSTOM_ID_START);

  /** @type {Array<[string, number]>} */
  const customEntries = [];
  for (const raw of speciesRaws) {
    const assigned = map[raw.id];
    if (assigned === undefined) {
      continue; // shouldn't happen — buildIdMapForCategory covers every input
    }
    if (assigned < CUSTOM_ID_START) {
      continue; // vanilla — lives in src/enums/species-id.ts already
    }
    const enumKey = speciesConstToEnumKey(raw.NAME ?? raw.name ?? "");
    customEntries.push([enumKey, assigned]);
  }

  // Drift guard: duplicate enum keys would silently flatten the map. Throw
  // loudly so a name collision in the upstream dump never gets shipped.
  const seen = new Set();
  for (const [key] of customEntries) {
    if (seen.has(key)) {
      throw new Error(`[er:erSpeciesIdEnum] duplicate enum key: ${key}`);
    }
    seen.add(key);
  }

  const objectBody = customEntries.map(([key, value]) => `  ${key}: ${value}`).join(",\n");
  const body = `// ER-custom species IDs. Values ≥ ${CUSTOM_ID_START} to avoid colliding with pokerogue's
// vanilla SpeciesId enum (which uses values ≤ ~9999). Vanilla species are
// NOT included here — they live in src/enums/species-id.ts and gain ER
// content via initEliteReduxSpecies() in init/init.ts (see B1a).

export const ErSpeciesId = {
${objectBody},
} as const;

export type ErSpeciesIdKey = keyof typeof ErSpeciesId;
export type ErSpeciesIdValue = (typeof ErSpeciesId)[ErSpeciesIdKey];
`;

  if (flags.dryRun) {
    console.log(`[er:erSpeciesIdEnum] would emit ${customEntries.length} custom species IDs`);
    return;
  }

  // This enum lives in src/enums/, not src/data/elite-redux/.
  const enumPath = resolve(outDir, "../../enums/er-species-id.ts");
  await emitModule(enumPath, body);
  console.log(`[er:erSpeciesIdEnum] emitted ${customEntries.length} custom species IDs`);
}
