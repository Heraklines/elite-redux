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
 * @typedef {Object} ErAbilityRaw
 * @property {number} id
 * @property {string} name
 * @property {string} desc
 */

/**
 * Strip non-alphanumeric characters and lowercase, for case+separator-insensitive
 * name matching between ER ("Wandering Spirit") and pokerogue's enum
 * (`WANDERING_SPIRIT`).
 * @param {string} s
 * @returns {string}
 */
export function normalizeName(s) {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Read pokerogue's AbilityId enum keys from src/enums/ability-id.ts and
 * return a Set of normalized names for O(1) lookup.
 * @returns {Promise<Set<string>>}
 */
export async function loadVanillaAbilityNames() {
  const enumPath = resolve(import.meta.dirname, "../../../src/enums/ability-id.ts");
  const src = await readFile(enumPath, "utf8");
  const out = new Set();
  // Match enum-key lines: leading whitespace, identifier, `=` or `,`/end. The
  // src/enums/ability-id.ts file is a plain `enum` with `KEY = number,` lines.
  const re = /^\s*([A-Z][A-Z0-9_]*)\s*[=,]/gm;
  for (const match of src.matchAll(re)) {
    out.add(normalizeName(match[1]));
  }
  // Sanity: if the enum file format changes (split, const enum, generated, etc.)
  // we'd silently get a small/empty set, flipping every ER ability to "unknown".
  // 200 is a generous floor — pokerogue ships ~310 enum keys today.
  if (out.size < 200) {
    throw new Error(
      `loadVanillaAbilityNames: parsed only ${out.size} keys from ${enumPath} — file format may have changed`,
    );
  }
  return out;
}

/**
 * Transform one ER raw ability entry into the draft shape.
 * @param {ErAbilityRaw} raw
 * @param {Set<string>} vanillaNames
 */
export function buildAbilityEntry(raw, vanillaNames) {
  if (typeof raw?.name !== "string") {
    throw new Error(`ability id=${raw?.id}: missing name field`);
  }
  const normalized = normalizeName(raw.name);
  // Empty normalization (e.g., "-------" placeholder) is always unknown.
  const archetype = normalized && vanillaNames.has(normalized) ? "vanilla" : "unknown";
  return {
    id: raw.id,
    name: raw.name,
    description: raw.desc ?? "",
    archetype,
  };
}

/** @type {import("../lib/builder-types.mjs").BuildFn} */
export async function build({ dump, outDir, flags }) {
  const vanillaNames = await loadVanillaAbilityNames();
  const raws = /** @type {ErAbilityRaw[]} */ (dump.abilities ?? []);
  const entries = raws.map(a => buildAbilityEntry(a, vanillaNames));
  // Detect duplicate-name groups — ER stores Glastrier/Spectrier "As One" as
  // two id-distinct rows with identical names; same for the 4 "Embody Aspect"
  // variants. A9 (id-map hand-resolution) needs this surface for cross-ref.
  const nameCounts = new Map();
  for (const e of entries) {
    const norm = normalizeName(e.name);
    if (!norm) {
      continue;
    }
    nameCounts.set(norm, (nameCounts.get(norm) ?? 0) + 1);
  }
  const dupGroups = [...nameCounts.entries()].filter(([, count]) => count > 1);
  if (dupGroups.length > 0) {
    const summary = dupGroups
      .map(([norm, count]) => {
        const example = entries.find(e => normalizeName(e.name) === norm)?.name ?? "?";
        return `${example} x${count}`;
      })
      .join(", ");
    console.log(`[er:abilities] note: ${dupGroups.length} duplicate-name groups (${summary})`);
  }
  const vanillaCount = entries.filter(e => e.archetype === "vanilla").length;
  const unknownCount = entries.length - vanillaCount;
  const body = `export interface ErAbilityDraft {
  readonly id: number;
  readonly name: string;
  readonly description: string;
  readonly archetype: "vanilla" | "unknown";
}

export const ER_ABILITIES: readonly ErAbilityDraft[] = ${JSON.stringify(entries, null, 2)} as const;
`;
  if (flags.dryRun) {
    console.log(`[er:abilities] would emit ${entries.length} (${vanillaCount} vanilla, ${unknownCount} unknown)`);
    return;
  }
  await emitModule(resolve(outDir, "er-abilities.ts"), body);
  console.log(`[er:abilities] emitted ${entries.length} abilities (${vanillaCount} vanilla, ${unknownCount} unknown)`);
}
