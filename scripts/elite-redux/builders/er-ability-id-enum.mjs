/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { resolve } from "node:path";
import { emitModule } from "../lib/emit.mjs";
import { buildIdMapForCategory, loadEnumValues } from "./id-map.mjs";

const CUSTOM_ID_START = 5000;

/**
 * Convert an ER ability display name (e.g. `Scrapyard`, `Cold Hearted`) into
 * the enum-key form used in `er-ability-id.ts` (e.g. `SCRAPYARD`,
 * `COLD_HEARTED`). Uppercases and replaces runs of non-alphanumeric chars
 * with single underscores; trims leading/trailing underscores.
 *
 * Throws on empty input — surfaces upstream data drift loudly.
 *
 * @param {string} abilityName
 * @returns {string}
 */
export function abilityNameToEnumKey(abilityName) {
  if (typeof abilityName !== "string") {
    throw new TypeError(`abilityName must be a string, got ${typeof abilityName}`);
  }
  const key = abilityName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!key) {
    throw new Error(`abilityName did not produce a non-empty enum key: "${abilityName}"`);
  }
  return key;
}

/**
 * Collect a `baseKey → count` map of how many times each enum-key collides
 * across the ER-custom subset of `abilityRaws`. Used to decide whether a
 * given entry needs disambiguation via id-suffix.
 *
 * @param {Array<{id: number, name?: string}>} abilityRaws
 * @param {Record<number, number>} map - ER id → pokerogue id
 * @returns {Map<string, number>}
 */
function countCustomKeyOccurrences(abilityRaws, map) {
  const counts = new Map();
  for (const raw of abilityRaws) {
    const assigned = map[raw.id];
    if (assigned === undefined || assigned < CUSTOM_ID_START) {
      continue;
    }
    const baseKey = abilityNameToEnumKey(raw.name ?? "");
    counts.set(baseKey, (counts.get(baseKey) ?? 0) + 1);
  }
  return counts;
}

/**
 * Emit one [enumKey, value] tuple per ER-custom ability, suffixing the key
 * with `_<erId>` when the base key collides with another entry. Disambiguation
 * is deterministic across rebuilds since ER ids are stable.
 *
 * @param {Array<{id: number, name?: string}>} abilityRaws
 * @param {Record<number, number>} map - ER id → pokerogue id
 * @param {Map<string, number>} keyOccurrences
 * @returns {Array<[string, number]>}
 */
function buildCustomEntries(abilityRaws, map, keyOccurrences) {
  /** @type {Array<[string, number]>} */
  const customEntries = [];
  for (const raw of abilityRaws) {
    const assigned = map[raw.id];
    if (assigned === undefined || assigned < CUSTOM_ID_START) {
      continue;
    }
    const baseKey = abilityNameToEnumKey(raw.name ?? "");
    const enumKey = (keyOccurrences.get(baseKey) ?? 0) > 1 ? `${baseKey}_${raw.id}` : baseKey;
    customEntries.push([enumKey, assigned]);
  }
  // Drift guard: duplicate enum keys would silently flatten the map. Throw
  // loudly if disambiguation failed (shouldn't happen — ER ids are unique).
  const seen = new Set();
  for (const [key] of customEntries) {
    if (seen.has(key)) {
      throw new Error(`[er:erAbilityIdEnum] duplicate enum key after disambiguation: ${key}`);
    }
    seen.add(key);
  }
  return customEntries;
}

/**
 * Builds the `er-ability-id.ts` enum body. Mirrors the id-assignment logic
 * from `scripts/elite-redux/builders/id-map.mjs` (`buildIdMapForCategory`) so
 * the values here align with `ER_ID_MAP.abilities[*]` for the same entries.
 *
 * @type {import("../lib/builder-types.mjs").BuildFn}
 */
export async function build({ dump, outDir, flags }) {
  const abilitiesEnum = await loadEnumValues("ability-id.ts", 200);
  const abilityRaws = /** @type {Array<{id: number, name?: string}>} */ (dump.abilities ?? []);

  // id-map.mjs uses the raw human-readable `name` field directly (abilities
  // have no `NAME` constant prefix to strip). Mirror that here.
  const abilityEntries = abilityRaws.map(a => ({ id: a.id, name: a.name ?? "" }));
  const { map } = buildIdMapForCategory(abilityEntries, abilitiesEnum, CUSTOM_ID_START);

  // Two-pass: count collisions (ER ships e.g. two "As One" entries; the 4
  // "Embody Aspect"s), then emit with id-suffix disambiguation when needed.
  const keyOccurrences = countCustomKeyOccurrences(abilityRaws, map);
  const customEntries = buildCustomEntries(abilityRaws, map, keyOccurrences);

  const objectBody = customEntries.map(([key, value]) => `  ${key}: ${value}`).join(",\n");
  const body = `// ER-custom ability IDs. Values ≥ ${CUSTOM_ID_START} to avoid colliding with pokerogue's
// vanilla AbilityId enum (which uses values ≤ ~310). Vanilla abilities are
// NOT included here — they live in src/enums/ability-id.ts and gain ER
// content via B3 vanilla-rebalance work; the values below are the ER customs
// registered by initEliteReduxCustomAbilities() (see B2).

export const ErAbilityId = {
${objectBody},
} as const;

export type ErAbilityIdKey = keyof typeof ErAbilityId;
export type ErAbilityIdValue = (typeof ErAbilityId)[ErAbilityIdKey];
`;

  if (flags.dryRun) {
    console.log(`[er:erAbilityIdEnum] would emit ${customEntries.length} custom ability IDs`);
    return;
  }

  // This enum lives in src/enums/, not src/data/elite-redux/.
  const enumPath = resolve(outDir, "../../enums/er-ability-id.ts");
  await emitModule(enumPath, body);
  console.log(`[er:erAbilityIdEnum] emitted ${customEntries.length} custom ability IDs`);
}
