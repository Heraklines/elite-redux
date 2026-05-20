/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { resolve } from "node:path";
import { emitModule } from "../lib/emit.mjs";

// Subset of v2.65 fields consumed by this transformer. See
// scripts/elite-redux/fixtures/README.md for the full schema.
/**
 * @typedef {Object} ErPartyMemberRaw
 * @property {number} spc
 * @property {number} abi
 * @property {number[]} ivs
 * @property {number[]} evs
 * @property {number} item
 * @property {number} nature
 * @property {number[]} moves
 * @property {number} hpType
 */

/**
 * @typedef {Object} ErTrainerRaw
 * @property {string} name
 * @property {number} tclass
 * @property {boolean} db
 * @property {number} map
 * @property {ErPartyMemberRaw[]} party
 * @property {ErPartyMemberRaw[]} insane
 * @property {ErPartyMemberRaw[]} hell
 * @property {ErPartyMemberRaw[]} rem
 */

/**
 * Transform one ER raw party member into the draft shape.
 * Renames: spc→species, abi→abilitySlot.
 * @param {ErPartyMemberRaw} raw
 * @param {string} ctxLabel  - for error messages ("trainer 42 party[3]")
 */
function buildPartyMember(raw, ctxLabel) {
  if (typeof raw?.spc !== "number") {
    throw new Error(`${ctxLabel}: missing or non-numeric species (spc)`);
  }
  if (!Array.isArray(raw.ivs) || raw.ivs.length !== 6) {
    throw new Error(`${ctxLabel}: ivs must be length 6 (got ${raw.ivs?.length})`);
  }
  if (!Array.isArray(raw.evs) || raw.evs.length !== 6) {
    throw new Error(`${ctxLabel}: evs must be length 6 (got ${raw.evs?.length})`);
  }
  return {
    species: raw.spc,
    abilitySlot: raw.abi ?? 0,
    ivs: /** @type {[number,number,number,number,number,number]} */ ([...raw.ivs]),
    evs: /** @type {[number,number,number,number,number,number]} */ ([...raw.evs]),
    item: raw.item ?? 0,
    nature: raw.nature ?? 0,
    moves: Array.isArray(raw.moves) ? [...raw.moves] : [],
    hpType: raw.hpType ?? 0,
  };
}

/**
 * Map an array of raw party members to drafts, or return null for empty arrays.
 * @param {ErPartyMemberRaw[]} arr
 * @param {string} ctxLabel
 */
function mapPartyOrNull(arr, ctxLabel) {
  if (!Array.isArray(arr) || arr.length === 0) {
    return null;
  }
  return arr.map((m, idx) => buildPartyMember(m, `${ctxLabel}[${idx}]`));
}

/**
 * Transform one ER raw trainer entry into the draft shape.
 * @param {ErTrainerRaw} raw
 * @param {number} index  - the trainer's index in dump.trainers (used as id)
 */
export function buildTrainerEntry(raw, index) {
  if (typeof raw?.name !== "string") {
    throw new Error(`trainer ${index}: missing name field`);
  }
  const party = (raw.party ?? []).map((m, idx) => buildPartyMember(m, `trainer ${index} party[${idx}]`));
  return {
    id: index,
    name: raw.name,
    trainerClass: raw.tclass ?? 0,
    isDouble: !!raw.db,
    map: raw.map ?? 0,
    party,
    insaneParty: mapPartyOrNull(raw.insane, `trainer ${index} insane`),
    hellParty: mapPartyOrNull(raw.hell, `trainer ${index} hell`),
    extras: (raw.rem ?? []).map((m, idx) => buildPartyMember(m, `trainer ${index} rem[${idx}]`)),
  };
}

/**
 * Build the body of the er-trainer-tables.ts decoder-tables module. ER ships
 * `tclassT` (trainer class display names) and `mapsT` / `MAPST` (map display
 * names + MAP_* consts) as top-level arrays — emit verbatim so downstream
 * code can decode trainer.trainerClass / trainer.map.
 * @param {object} dump
 */
function buildTablesBody(dump) {
  return `// Decoder tables for the numeric IDs in er-trainers.ts.
// All arrays are extracted verbatim from vendor/elite-redux/v2.65beta.json
// top-level keys (tclassT/mapsT/MAPST).

export const ER_TRAINER_CLASS_NAMES: readonly string[] = ${JSON.stringify(dump.tclassT ?? [], null, 2)} as const;
export const ER_MAP_NAMES: readonly string[] = ${JSON.stringify(dump.mapsT ?? [], null, 2)} as const;
export const ER_MAP_CONSTS: readonly string[] = ${JSON.stringify(dump.MAPST ?? [], null, 2)} as const;
`;
}

/** @type {import("../lib/builder-types.mjs").BuildFn} */
export async function build({ dump, outDir, flags }) {
  const trainers = /** @type {ErTrainerRaw[]} */ (dump.trainers ?? []);
  const entries = trainers.map((t, i) => buildTrainerEntry(t, i));
  const withInsane = entries.filter(e => e.insaneParty !== null).length;
  const withHell = entries.filter(e => e.hellParty !== null).length;

  const body = `export interface ErPartyMember {
  readonly species: number;
  readonly abilitySlot: number;
  readonly ivs: readonly [number, number, number, number, number, number];
  readonly evs: readonly [number, number, number, number, number, number];
  readonly item: number;
  readonly nature: number;
  readonly moves: readonly number[];
  readonly hpType: number;
}

export interface ErTrainerDraft {
  readonly id: number;
  readonly name: string;
  readonly trainerClass: number;
  readonly isDouble: boolean;
  readonly map: number;
  readonly party: readonly ErPartyMember[];
  readonly insaneParty: readonly ErPartyMember[] | null;
  readonly hellParty: readonly ErPartyMember[] | null;
  readonly extras: readonly ErPartyMember[];
}

export const ER_TRAINERS: readonly ErTrainerDraft[] = ${JSON.stringify(entries, null, 2)} as const;
`;
  if (flags.dryRun) {
    console.log(`[er:trainers] would emit ${entries.length} trainers (${withInsane} insane, ${withHell} hell)`);
    return;
  }
  await emitModule(resolve(outDir, "er-trainers.ts"), body);

  // Emit decoder tables so downstream code can decode trainer.trainerClass /
  // trainer.map without consulting the source dump. Mirrors A7's er-move-tables.ts.
  await emitModule(resolve(outDir, "er-trainer-tables.ts"), buildTablesBody(dump));
  const nClasses = (dump.tclassT ?? []).length;
  const nMaps = (dump.mapsT ?? []).length;
  console.log(`[er:trainers] decoder tables: ${nClasses} trainer classes, ${nMaps} maps`);

  console.log(`[er:trainers] emitted ${entries.length} trainers (${withInsane} insane, ${withHell} hell)`);
}
