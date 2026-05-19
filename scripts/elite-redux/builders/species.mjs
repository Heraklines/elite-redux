/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { resolve } from "node:path";
import { emitModule } from "../lib/emit.mjs";

const ABILITY_NONE_ID = 0;

/**
 * @typedef {Object} ErSpeciesRaw
 * @property {number} id
 * @property {string} NAME
 * @property {string} name
 * @property {Object} stats
 * @property {number[]} stats.base
 * @property {number[]} stats.types
 * @property {number[]} stats.abis
 * @property {number[]} stats.inns
 * @property {number} stats.catchR
 * @property {number} stats.exp
 * @property {number[]} stats.EVY
 * @property {number} stats.gender
 * @property {number} stats.eggC
 * @property {number} stats.fren
 * @property {number} stats.grow
 * @property {number[]} stats.eggG
 * @property {number} stats.col
 * @property {boolean} stats.noFlip
 * @property {string} stats.flags
 * @property {Array<{kd: number, rs: string, in: number}>} evolutions
 * @property {number[]} eggMoves
 * @property {Array<{id: number, lv: number}>} levelUpMoves
 * @property {number[]} TMHMMoves
 * @property {number[]} tutor
 * @property {unknown[]} forms
 */

/**
 * Pad an array of numeric IDs to exactly length 3 with ABILITY_NONE_ID.
 * @param {number[] | undefined | null} arr
 * @returns {[number, number, number]}
 */
function padToThree(arr) {
  const safe = arr ?? [];
  const a = safe[0] ?? ABILITY_NONE_ID;
  const b = safe[1] ?? ABILITY_NONE_ID;
  const c = safe[2] ?? ABILITY_NONE_ID;
  return [a, b, c];
}

/**
 * Normalize the type tuple. Mono-type ER mons have `types.length === 1`; some
 * have `[t, t]` duplicated. Either way the canonical shape is `[primary, null]`.
 * @param {number[]} types
 * @returns {[number, number | null]}
 */
function normalizeTypes(types) {
  if (!Array.isArray(types) || types.length === 0) {
    throw new Error("species.stats.types is empty or not an array");
  }
  const primary = types[0];
  const secondary = types[1] ?? null;
  return [primary, secondary === primary ? null : secondary];
}

/**
 * Transform one ER raw species entry into the draft shape that gets emitted
 * to `src/data/elite-redux/er-species.ts`. Numeric IDs are kept as-is; cross-
 * referencing to pokerogue enums happens later in Tasks A6/A9.
 * @param {ErSpeciesRaw} raw
 */
export function buildSpeciesEntry(raw) {
  const st = raw.stats;
  if (!Array.isArray(st?.base) || st.base.length !== 6) {
    throw new Error(`species ${raw.NAME}: stats.base length != 6 (got ${st?.base?.length})`);
  }
  return {
    id: raw.id,
    speciesConst: raw.NAME,
    name: raw.name,
    baseStats: /** @type {[number,number,number,number,number,number]} */ ([...st.base]),
    types: normalizeTypes(st.types),
    abilities: padToThree(st.abis),
    innates: padToThree(st.inns),
    evolutions: (raw.evolutions ?? []).map(e => ({ kind: e.kd, requirement: e.rs, into: e.in })),
    eggMoves: raw.eggMoves ?? [],
    levelUpMoves: (raw.levelUpMoves ?? []).map(m => ({ id: m.id, level: m.lv })),
    tmhmMoves: raw.TMHMMoves ?? [],
    tutorMoves: raw.tutor ?? [],
    forms: raw.forms ?? [],
    catchRate: st.catchR,
    baseExp: st.exp,
    evYield: /** @type {[number,number,number,number,number,number]} */ ([...st.EVY]),
    genderRatio: st.gender,
    eggCycles: st.eggC,
    friendship: st.fren,
    growthRate: st.grow,
    eggGroups: st.eggG ?? [],
    color: st.col,
    noFlip: !!st.noFlip,
    flags: st.flags ?? "",
  };
}

/** @type {import("../lib/builder-types.mjs").BuildFn} */
export async function build({ dump, outDir, flags }) {
  const raws = /** @type {ErSpeciesRaw[]} */ (dump.species ?? []);
  const entries = raws.map(buildSpeciesEntry);
  const body = `export interface ErEvolutionDraft {
  readonly kind: number;
  readonly requirement: string;
  readonly into: number;
}

export interface ErLevelUpMove {
  readonly id: number;
  readonly level: number;
}

export interface ErSpeciesDraft {
  readonly id: number;
  readonly speciesConst: string;
  readonly name: string;
  readonly baseStats: readonly [number, number, number, number, number, number];
  readonly types: readonly [number, number | null];
  readonly abilities: readonly [number, number, number];
  readonly innates: readonly [number, number, number];
  readonly evolutions: readonly ErEvolutionDraft[];
  readonly eggMoves: readonly number[];
  readonly levelUpMoves: readonly ErLevelUpMove[];
  readonly tmhmMoves: readonly number[];
  readonly tutorMoves: readonly number[];
  readonly forms: readonly unknown[];
  readonly catchRate: number;
  readonly baseExp: number;
  readonly evYield: readonly [number, number, number, number, number, number];
  readonly genderRatio: number;
  readonly eggCycles: number;
  readonly friendship: number;
  readonly growthRate: number;
  readonly eggGroups: readonly number[];
  readonly color: number;
  readonly noFlip: boolean;
  readonly flags: string;
}

export const ER_SPECIES: readonly ErSpeciesDraft[] = ${JSON.stringify(entries, null, 2)} as const;
`;
  if (flags.dryRun) {
    console.log(`[er:species] would emit ${entries.length} species`);
    return;
  }
  await emitModule(resolve(outDir, "er-species.ts"), body);
  console.log(`[er:species] emitted ${entries.length} species`);
}
