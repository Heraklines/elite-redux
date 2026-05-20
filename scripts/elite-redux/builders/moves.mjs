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
 * @typedef {Object} ErMoveRaw
 * @property {number} id
 * @property {string} NAME
 * @property {string} name
 * @property {string} sName
 * @property {number} eff
 * @property {number} pwr
 * @property {number[]} types
 * @property {number} acc
 * @property {number} pp
 * @property {number} chance
 * @property {number} target
 * @property {number} prio
 * @property {number} split
 * @property {number[]} flags
 * @property {string} arg
 * @property {string} desc
 * @property {string} lDesc
 * @property {boolean} usesHpType
 */

/**
 * Strip the MOVE_ prefix from an UPPER_SNAKE_CASE move const.
 * @param {string} constName
 * @returns {string}
 */
export function moveKeyFromConst(constName) {
  return (constName ?? "").replace(/^MOVE_/, "");
}

/**
 * Read pokerogue's MoveId enum keys from src/enums/move-id.ts.
 * @returns {Promise<Set<string>>}
 */
export async function loadVanillaMoveNames() {
  const enumPath = resolve(import.meta.dirname, "../../../src/enums/move-id.ts");
  const src = await readFile(enumPath, "utf8");
  const out = new Set();
  // Match enum-key lines: leading whitespace, identifier, `=` or `,`/end. The
  // src/enums/move-id.ts file is a plain `enum` with `KEY,` or `KEY = number,` lines.
  const re = /^\s*([A-Z][A-Z0-9_]*)\s*[=,]/gm;
  for (const match of src.matchAll(re)) {
    out.add(match[1]);
  }
  // Sanity floor — pokerogue ships ~920 moves. If parsing yields a small set
  // the enum file format may have changed (split file, const enum, generated, etc.)
  // and we'd silently flip every ER move to "unknown".
  if (out.size < 400) {
    throw new Error(
      `loadVanillaMoveNames: parsed only ${out.size} keys from ${enumPath} — file format may have changed`,
    );
  }
  return out;
}

/**
 * Classify an ER move's archetype by matching its MOVE_* const against
 * pokerogue's MoveId enum keys. Empty key (e.g., a hypothetical bare "MOVE_"
 * placeholder) is always "unknown".
 * @param {string} moveConst
 * @param {Set<string>} vanillaNames
 * @returns {"vanilla" | "unknown"}
 */
function classifyMoveArchetype(moveConst, vanillaNames) {
  const key = moveKeyFromConst(moveConst);
  return key && vanillaNames.has(key) ? "vanilla" : "unknown";
}

/**
 * Snapshot the array-shaped fields. ER occasionally ships odd shapes (missing
 * keys for malformed rows); guard with Array.isArray and fall back to [].
 * @param {ErMoveRaw} raw
 */
function snapshotArrays(raw) {
  return {
    types: Array.isArray(raw.types) ? [...raw.types] : [],
    flags: Array.isArray(raw.flags) ? [...raw.flags] : [],
  };
}

/**
 * Transform one ER raw move entry into the draft shape.
 * @param {ErMoveRaw} raw
 * @param {Set<string>} vanillaNames
 */
export function buildMoveEntry(raw, vanillaNames) {
  if (typeof raw?.NAME !== "string") {
    throw new Error(`move id=${raw?.id}: missing NAME field`);
  }
  const { types, flags } = snapshotArrays(raw);
  return {
    id: raw.id,
    moveConst: raw.NAME,
    name: raw.name ?? "",
    shortName: raw.sName ?? "",
    description: raw.desc ?? "",
    longDescription: raw.lDesc ?? "",
    types,
    power: raw.pwr ?? 0,
    accuracy: raw.acc ?? 0,
    pp: raw.pp ?? 0,
    priority: raw.prio ?? 0,
    split: raw.split ?? 0,
    target: raw.target ?? 0,
    effect: raw.eff ?? 0,
    effectChance: raw.chance ?? 0,
    flags,
    arg: raw.arg ?? "",
    usesHpType: !!raw.usesHpType,
    archetype: classifyMoveArchetype(raw.NAME, vanillaNames),
  };
}

/** @type {import("../lib/builder-types.mjs").BuildFn} */
export async function build({ dump, outDir, flags }) {
  const vanillaNames = await loadVanillaMoveNames();
  const raws = /** @type {ErMoveRaw[]} */ (dump.moves ?? []);
  const entries = raws.map(m => buildMoveEntry(m, vanillaNames));
  const vanillaCount = entries.filter(e => e.archetype === "vanilla").length;
  const unknownCount = entries.length - vanillaCount;

  // Detect duplicate-NAME groups (like A6 did for abilities — ER occasionally
  // ships identically-named distinct moves). A9 will hand-resolve.
  const nameCounts = new Map();
  for (const e of entries) {
    if (!e.moveConst) {
      continue;
    }
    nameCounts.set(e.moveConst, (nameCounts.get(e.moveConst) ?? 0) + 1);
  }
  const dupGroups = [...nameCounts.entries()].filter(([, c]) => c > 1);
  if (dupGroups.length > 0) {
    const summary = dupGroups.map(([n, c]) => `${n} x${c}`).join(", ");
    console.log(`[er:moves] note: ${dupGroups.length} duplicate-NAME groups (${summary})`);
  }

  const body = `export interface ErMoveDraft {
  readonly id: number;
  readonly moveConst: string;
  readonly name: string;
  readonly shortName: string;
  readonly description: string;
  readonly longDescription: string;
  readonly types: readonly number[];
  readonly power: number;
  readonly accuracy: number;
  readonly pp: number;
  readonly priority: number;
  readonly split: number;
  readonly target: number;
  readonly effect: number;
  readonly effectChance: number;
  readonly flags: readonly number[];
  readonly arg: string;
  readonly usesHpType: boolean;
  readonly archetype: "vanilla" | "unknown";
}

export const ER_MOVES: readonly ErMoveDraft[] = ${JSON.stringify(entries, null, 2)} as const;
`;
  if (flags.dryRun) {
    console.log(`[er:moves] would emit ${entries.length} (${vanillaCount} vanilla, ${unknownCount} unknown)`);
    return;
  }
  await emitModule(resolve(outDir, "er-moves.ts"), body);
  console.log(`[er:moves] emitted ${entries.length} moves (${vanillaCount} vanilla, ${unknownCount} unknown)`);
}
