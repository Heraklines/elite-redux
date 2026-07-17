/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — EDITOR-CREATED custom mons (er-custom-mons.json).
//
// The team balancing editor's "Add a Mon" tab writes one entry per mon:
//
//   "SPECIES_EDITOR_EMBERCAT": {
//     "id": 60001,                      // stable, assigned at creation, NEVER reused
//     "name": "Embercat",
//     "slug": "editor-embercat",        // er-assets images/pokemon/elite-redux/<slug>/
//     "types": ["FIRE", null],
//     "baseStats": [70, 95, 60, 80, 60, 105],
//     "abilities": ["Blaze", "", ""],   // up to 3 ACTIVE abilities, by display name
//     "innates": ["", "", ""],          // up to 3 innate passives, by display name
//     "catchRate": 45,
//     "eggTier": 1,                     // 0 Common / 1 Rare / 2 Epic / 3 Legendary
//     "cost": 4,                        // starter point cost
//     "levelUpMoves": [{ "level": 1, "move": "SCRATCH" }, { "level": 7, "move": "EMBER" }],
//     "eggMoves": ["FLARE_BLITZ"]
//   }
//
// Ids live in the RESERVED 60000-69999 band (far above the ER dump customs at
// 10000-10880), are stored in the JSON and never renumbered — saves reference
// them, so the editor only ever assigns max+1. Every entry is validated here;
// an invalid entry is SKIPPED with a warning (it can never break a build).
// Sprites load through the same ErCustomSpecies slug pipeline as every other
// ER custom (lazy, 404-tolerant), so a missing sprite shows an empty texture,
// not a crash. Applies AFTER the egg-move init so all target tables exist.
// =============================================================================

import { speciesEggMoves } from "#balance/moves/egg-moves";
import { pokemonSpeciesLevelMoves } from "#balance/pokemon-level-moves";
import { speciesEggTiers } from "#balance/species-egg-tiers";
import { speciesStarterCosts } from "#balance/starters";
import { allAbilities } from "#data/data-lists";
import { enAbilityName } from "#data/elite-redux/er-canonical-names";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_MOVES } from "#data/elite-redux/er-moves";
import { registerErEditorMon } from "#data/elite-redux/init-elite-redux-custom-species";
import { AbilityId } from "#enums/ability-id";
import type { EggTier } from "#enums/egg-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import customMonsJson from "./er-custom-mons.json";

export interface ErCustomMonEntry {
  id: number;
  name: string;
  slug: string;
  /** [primary, secondary|null] — kept loose: the JSON is editor-written. */
  types: readonly (string | null)[];
  baseStats: readonly number[];
  abilities?: readonly string[];
  innates?: readonly string[];
  catchRate?: number;
  eggTier?: number;
  cost?: number;
  levelUpMoves?: ReadonlyArray<{ level: number; move: string }>;
  eggMoves?: readonly string[];
}

export type ErCustomMons = Record<string, ErCustomMonEntry>;

export interface InitEliteReduxCustomMonsResult {
  registered: number;
  skippedInvalid: number;
  alreadyPresent: number;
}

/** Reserved id band for editor-created mons. */
export const ER_EDITOR_MON_ID_MIN = 60000;
export const ER_EDITOR_MON_ID_MAX = 69999;

function abilityIdByName(): Map<string, number> {
  const map = new Map<string, number>();
  for (const ability of allAbilities) {
    if (ability && ability.id !== AbilityId.NONE) {
      const key = enAbilityName(ability).trim().toLowerCase();
      if (!key) {
        continue;
      }
      if (!map.has(key)) {
        map.set(key, ability.id);
      }
    }
  }
  return map;
}

function moveIdByName(): Map<string, number> {
  const map = new Map<string, number>();
  for (const [key, value] of Object.entries(MoveId)) {
    if (typeof value === "number") {
      map.set(key, value);
    }
  }
  for (const draft of ER_MOVES) {
    const pkrgId = ER_ID_MAP.moves[draft.id];
    if (pkrgId === undefined) {
      continue;
    }
    const key = draft.name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (key && !map.has(key)) {
      map.set(key, pkrgId);
    }
  }
  return map;
}

function validEntry(speciesConst: string, entry: ErCustomMonEntry): string | null {
  if (!/^SPECIES_[A-Z0-9_]+$/.test(speciesConst)) {
    return "bad species const";
  }
  if (!Number.isInteger(entry.id) || entry.id < ER_EDITOR_MON_ID_MIN || entry.id > ER_EDITOR_MON_ID_MAX) {
    return `id must be ${ER_EDITOR_MON_ID_MIN}-${ER_EDITOR_MON_ID_MAX}`;
  }
  if (typeof entry.name !== "string" || entry.name.trim().length === 0 || entry.name.length > 30) {
    return "bad name";
  }
  if (typeof entry.slug !== "string" || !/^[a-z0-9-]{2,40}$/.test(entry.slug)) {
    return "bad slug";
  }
  if (
    !Array.isArray(entry.baseStats)
    || entry.baseStats.length !== 6
    || entry.baseStats.some(v => !Number.isInteger(v) || v < 1 || v > 255)
  ) {
    return "baseStats must be 6 integers 1-255";
  }
  if (!Array.isArray(entry.types) || entry.types.length === 0 || typeof entry.types[0] !== "string") {
    return "types must be [primary, secondary|null]";
  }
  return null;
}

/**
 * Register every valid editor-created mon: species into `allSpecies` (via the
 * shared ErCustomSpecies factory), then egg tier, starter cost, level-up moves
 * and egg moves into the live balance tables. `mons` is injectable for tests.
 */
export function applyErCustomMons(mons: ErCustomMons = customMonsJson as ErCustomMons): InitEliteReduxCustomMonsResult {
  const result: InitEliteReduxCustomMonsResult = { registered: 0, skippedInvalid: 0, alreadyPresent: 0 };
  const entries = Object.entries(mons);
  if (entries.length === 0) {
    return result;
  }

  const abilities = abilityIdByName();
  const moves = moveIdByName();
  const typeByName = PokemonType as unknown as Record<string, number | undefined>;
  const resolveAbility = (name: string | undefined): number => {
    if (!name || name.trim() === "" || name.trim().toUpperCase() === "NONE") {
      return AbilityId.NONE;
    }
    return abilities.get(name.trim().toLowerCase()) ?? AbilityId.NONE;
  };
  const abilityTriple = (names: readonly string[] | undefined): [number, number, number] => [
    resolveAbility(names?.[0]),
    resolveAbility(names?.[1]),
    resolveAbility(names?.[2]),
  ];

  for (const [speciesConst, entry] of entries) {
    const problem = validEntry(speciesConst, entry);
    if (problem !== null) {
      console.warn(`[er-custom-mons] skipping ${speciesConst}: ${problem}`);
      result.skippedInvalid++;
      continue;
    }
    const type1 = typeByName[(entry.types[0] ?? "").toUpperCase()];
    const type2Name = entry.types[1];
    const type2 = type2Name == null ? null : (typeByName[type2Name.toUpperCase()] ?? null);
    if (typeof type1 !== "number") {
      console.warn(`[er-custom-mons] skipping ${speciesConst}: unknown primary type "${entry.types[0]}"`);
      result.skippedInvalid++;
      continue;
    }

    const added = registerErEditorMon({
      speciesId: entry.id,
      name: entry.name.trim(),
      slug: entry.slug,
      type1: type1 as PokemonType,
      type2: type2 as PokemonType | null,
      baseStats: entry.baseStats as unknown as readonly [number, number, number, number, number, number],
      abilities: abilityTriple(entry.abilities),
      innates: abilityTriple(entry.innates),
      catchRate:
        Number.isInteger(entry.catchRate) && (entry.catchRate as number) >= 1 && (entry.catchRate as number) <= 255
          ? (entry.catchRate as number)
          : 45,
    });
    if (!added) {
      result.alreadyPresent++;
      continue;
    }

    // Balance tables: starter grid + egg pool + movesets.
    const eggTier =
      Number.isInteger(entry.eggTier) && (entry.eggTier as number) >= 0 && (entry.eggTier as number) <= 3
        ? (entry.eggTier as number)
        : 0;
    const cost =
      Number.isInteger(entry.cost) && (entry.cost as number) >= 1 && (entry.cost as number) <= 50
        ? (entry.cost as number)
        : 3;
    (speciesEggTiers as Record<number, EggTier>)[entry.id] = eggTier as EggTier;
    (speciesStarterCosts as Record<number, number>)[entry.id] = cost;

    const levelMoves: [number, number][] = [];
    for (const lm of entry.levelUpMoves ?? []) {
      const moveId = moves.get((lm.move ?? "").toUpperCase());
      if (moveId !== undefined && Number.isInteger(lm.level) && lm.level >= 1 && lm.level <= 100) {
        levelMoves.push([lm.level, moveId]);
      }
    }
    if (levelMoves.length === 0) {
      levelMoves.push([1, MoveId.TACKLE]); // never ship a moveless mon
    }
    levelMoves.sort((a, b) => a[0] - b[0]);
    (pokemonSpeciesLevelMoves as Record<number, [number, number][]>)[entry.id] = levelMoves;

    const eggMoveIds = (entry.eggMoves ?? [])
      .map(name => moves.get((name ?? "").toUpperCase()))
      .filter((id): id is number => id !== undefined)
      .slice(0, 4);
    if (eggMoveIds.length > 0) {
      (speciesEggMoves as Record<number, number[]>)[entry.id] = eggMoveIds;
    }

    result.registered++;
  }

  return result;
}

/** Init-chain entry point (uses the committed JSON). */
export function initEliteReduxCustomMons(): InitEliteReduxCustomMonsResult {
  return applyErCustomMons();
}
