/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { allAbilities, allMoves, allSpecies } from "#data/data-lists";
import {
  ER_OMNIFORM_COMPOSITE_PART_ID,
  MANUAL_COMPOSITE_PARTS,
} from "#data/elite-redux/abilities/composite-newcomers";
import type { PokemonSpecies } from "#data/pokemon-species";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { WeatherType } from "#enums/weather-type";
import type { LevelMoves } from "#types/pokemon-level-moves";
import { randSeedInt, randSeedItem } from "#utils/common";

export interface FunModeConfig {
  difficulty: "youngster" | "hell";
  randomizePokemon: boolean;
  randomizeTypes: boolean;
  randomizeAbilities: boolean;
  randomizeLevelUpMoves: boolean;
  megaMode: boolean;
  megaMixMode: boolean;
  shuffleStats: boolean;
  shuffleEvolutions: boolean;
  itemChaos: boolean;
  weatherRoulette: boolean;
  scrambleMoves: boolean;
  abilityAvalanche: boolean;
  moodyMode: boolean;
  abilityRerollSeed: number;
}

export const DEFAULT_FUN_MODE_CONFIG: Readonly<FunModeConfig> = Object.freeze({
  difficulty: "youngster",
  randomizePokemon: false,
  randomizeTypes: false,
  randomizeAbilities: false,
  randomizeLevelUpMoves: false,
  megaMode: false,
  megaMixMode: false,
  shuffleStats: false,
  shuffleEvolutions: false,
  itemChaos: false,
  weatherRoulette: false,
  scrambleMoves: false,
  abilityAvalanche: false,
  moodyMode: false,
  abilityRerollSeed: 0,
});

let currentConfig: FunModeConfig = { ...DEFAULT_FUN_MODE_CONFIG };
let cachedAbilityPool: AbilityId[] | null = null;
const ENDLESS_AVALANCHE_CACHE_LIMIT = 4096;
const funAvalancheCache = new Map<string, readonly AbilityId[]>();
const endlessAvalancheCache = new Map<string, readonly AbilityId[]>();
let cachedMovePool: MoveId[] | null = null;

export function getFunModeConfig(): Readonly<FunModeConfig> {
  return currentConfig;
}

/**
 * Whether a directly caught wild Pokemon should grant permanent collection
 * progress while Fun Mode is active.
 *
 * Random Pokemon catches are rental-like: they may join the current party and
 * still award candy, but cannot unlock their species, forms, abilities, natures,
 * or shiny tiers in starter select. Item Chaos applies the same restriction only
 * to shiny catches so it cannot be used as a permanent shiny-farming modifier.
 */
export function shouldGrantFunCaptureProgress(isShiny: boolean): boolean {
  return !currentConfig.randomizePokemon && !(currentConfig.itemChaos && isShiny);
}

export function setFunModeConfig(config: FunModeConfig): void {
  currentConfig = {
    difficulty: config.difficulty === "hell" ? "hell" : "youngster",
    randomizePokemon: config.randomizePokemon === true,
    randomizeTypes: config.randomizeTypes === true,
    randomizeAbilities: config.randomizeAbilities === true,
    randomizeLevelUpMoves: config.randomizeLevelUpMoves === true,
    megaMode: config.megaMode === true,
    megaMixMode: config.megaMode === true && config.megaMixMode === true,
    shuffleStats: config.shuffleStats === true,
    shuffleEvolutions: config.shuffleEvolutions === true,
    itemChaos: config.itemChaos === true,
    weatherRoulette: config.weatherRoulette === true,
    scrambleMoves: config.scrambleMoves === true,
    abilityAvalanche: config.abilityAvalanche === true,
    moodyMode: config.moodyMode === true,
    abilityRerollSeed: Number.isFinite(config.abilityRerollSeed) ? Math.max(0, Math.floor(config.abilityRerollSeed)) : 0,
  };
}

export function resetFunModeConfig(): void {
  currentConfig = { ...DEFAULT_FUN_MODE_CONFIG };
}

export function rerollFunAbilities(): void {
  currentConfig.abilityRerollSeed = (currentConfig.abilityRerollSeed + 1) >>> 0;
}

function mix32(value: number): number {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

function deterministicIndex(pokemonId: number, salt: number, length: number): number {
  return length > 0 ? mix32((pokemonId ^ Math.imul(salt, 0x9e3779b1)) >>> 0) % length : 0;
}

/**
 * Omniform is tied to the Partner Eevee form chain and is not safe on an
 * arbitrary species. Keep both the standalone ability and every manual
 * composite that contains it out of Fun Mode random assignment.
 *
 * The recursive walk also protects future nested composites added through the
 * ER editor instead of relying on a brittle list of today's Partner abilities.
 */
export function isFunRandomAbilityEligible(abilityId: AbilityId): boolean {
  const containsOmniform = (candidate: number, visiting: Set<number>): boolean => {
    if (candidate === ER_OMNIFORM_COMPOSITE_PART_ID) {
      return true;
    }
    if (visiting.has(candidate)) {
      return false;
    }
    const composite = MANUAL_COMPOSITE_PARTS[candidate];
    if (!composite) {
      return false;
    }
    visiting.add(candidate);
    const result = composite.constituents.some(constituent => containsOmniform(constituent, visiting));
    visiting.delete(candidate);
    return result;
  };

  return !containsOmniform(abilityId, new Set());
}

function abilityPool(): AbilityId[] {
  cachedAbilityPool ??= allAbilities
    .filter(
      ability =>
        ability != null
        && ability.id !== AbilityId.NONE
        && !ability.unimplemented
        && isFunRandomAbilityEligible(ability.id),
    )
    .map(ability => ability.id);
  return cachedAbilityPool;
}

export function getFunRandomAbilityId(pokemonId: number, slot: number): AbilityId | null {
  if (!currentConfig.randomizeAbilities) {
    return null;
  }
  const pool = [...abilityPool()];
  const rerolledId = mix32(pokemonId ^ Math.imul(currentConfig.abilityRerollSeed + 1, 0x85ebca6b));
  if (pool.length === 0) {
    return null;
  }
  const normalizedSlot = Math.max(0, Math.floor(slot));
  let selected = pool[0];
  for (let index = 0; index <= normalizedSlot; index++) {
    const poolIndex = deterministicIndex(rerolledId, 0x41 + index, pool.length);
    selected = pool.splice(poolIndex, 1)[0];
    if (pool.length === 0) {
      break;
    }
  }
  return selected;
}

export function getFunAbilityAvalancheCount(waveIndex: number): number {
  const normalizedWave = Math.max(0, Math.floor(waveIndex));
  return normalizedWave < 60 ? 0 : Math.floor((normalizedWave - 60) / 20) + 1;
}

export function getFunAbilityAvalancheIds(
  pokemonId: number,
  waveIndex: number,
  excludedIds: readonly AbilityId[] = [],
): AbilityId[] {
  if (!currentConfig.abilityAvalanche) {
    return [];
  }
  const count = getFunAbilityAvalancheCount(waveIndex);
  if (count === 0) {
    return [];
  }
  const excluded = new Set(excludedIds);
  const cacheKey = `${pokemonId}:${count}:${[...excluded].sort((a, b) => a - b).join(",")}`;
  const cached = funAvalancheCache.get(cacheKey);
  if (cached != null) {
    return [...cached];
  }
  const available = abilityPool().filter(abilityId => !excluded.has(abilityId));
  const selected: AbilityId[] = [];
  for (let slot = 0; slot < count && available.length > 0; slot++) {
    const index = deterministicIndex(pokemonId, 0xa51 + slot, available.length);
    selected.push(available.splice(index, 1)[0]);
  }
  if (funAvalancheCache.size >= ENDLESS_AVALANCHE_CACHE_LIMIT) {
    funAvalancheCache.clear();
  }
  funAvalancheCache.set(cacheKey, selected);
  return selected;
}

/** Deterministic safe ability additions for post-clear Endless Avalanche. */
export function getEndlessAbilityAvalancheIds(
  pokemonId: number,
  count: number,
  excludedIds: readonly AbilityId[] = [],
  battleSalt = 0,
): AbilityId[] {
  const normalizedCount = Math.max(0, Math.floor(count));
  if (normalizedCount === 0) {
    return [];
  }
  const excluded = new Set(excludedIds);
  const cacheKey = `${pokemonId}:${normalizedCount}:${battleSalt}:${[...excluded].sort((a, b) => a - b).join(",")}`;
  const cached = endlessAvalancheCache.get(cacheKey);
  if (cached != null) {
    return [...cached];
  }
  const available = abilityPool().filter(abilityId => !excluded.has(abilityId));
  const selected: AbilityId[] = [];
  for (let slot = 0; slot < normalizedCount && available.length > 0; slot++) {
    const index = deterministicIndex(pokemonId ^ battleSalt, 0xe11d + slot, available.length);
    selected.push(available.splice(index, 1)[0]);
  }
  if (endlessAvalancheCache.size >= ENDLESS_AVALANCHE_CACHE_LIMIT) {
    endlessAvalancheCache.clear();
  }
  endlessAvalancheCache.set(cacheKey, selected);
  return [...selected];
}

/**
 * Extend a Pokemon's saved Endless Avalanche sequence without changing any
 * ability it earned on an earlier wave. Battle-only exclusions affect only new
 * slots; they never become part of the identity of an existing roll.
 */
export function extendEndlessAbilityAvalancheIds(
  pokemonId: number,
  count: number,
  existingIds: readonly AbilityId[],
  excludedIds: readonly AbilityId[] = [],
  newSlotSalt = 0,
): AbilityId[] {
  const normalizedCount = Math.max(0, Math.floor(count));
  const eligible = new Set(abilityPool());
  const selected = existingIds.filter(
    (abilityId, index) => eligible.has(abilityId) && existingIds.indexOf(abilityId) === index,
  );
  if (selected.length >= normalizedCount) {
    return selected;
  }
  const excluded = new Set([...excludedIds, ...selected]);
  const available = abilityPool().filter(abilityId => !excluded.has(abilityId));
  for (let slot = selected.length; slot < normalizedCount && available.length > 0; slot++) {
    const index = deterministicIndex(pokemonId ^ newSlotSalt, 0xe11d + slot, available.length);
    const abilityId = available.splice(index, 1)[0];
    selected.push(abilityId);
    excluded.add(abilityId);
  }
  return selected;
}

const FUN_TYPES: readonly PokemonType[] = [
  PokemonType.NORMAL,
  PokemonType.FIGHTING,
  PokemonType.FLYING,
  PokemonType.POISON,
  PokemonType.GROUND,
  PokemonType.ROCK,
  PokemonType.BUG,
  PokemonType.GHOST,
  PokemonType.STEEL,
  PokemonType.FIRE,
  PokemonType.WATER,
  PokemonType.GRASS,
  PokemonType.ELECTRIC,
  PokemonType.PSYCHIC,
  PokemonType.ICE,
  PokemonType.DRAGON,
  PokemonType.DARK,
  PokemonType.FAIRY,
];

export function getFunRandomTypes(pokemonId: number, originalTypes: readonly PokemonType[]): PokemonType[] {
  if (!currentConfig.randomizeTypes) {
    return [...originalTypes];
  }
  const nativeCount = Math.max(
    1,
    Math.min(FUN_TYPES.length, new Set(originalTypes.filter(type => type !== PokemonType.UNKNOWN)).size),
  );
  const available = [...FUN_TYPES];
  const result: PokemonType[] = [];
  for (let slot = 0; slot < nativeCount; slot++) {
    const index = deterministicIndex(pokemonId, 0x91 + slot, available.length);
    result.push(available.splice(index, 1)[0]);
  }
  return result;
}

function movePool(): MoveId[] {
  cachedMovePool ??= allMoves
    .filter(
      move =>
        move != null
        && move.id !== MoveId.NONE
        && move.id !== MoveId.STRUGGLE
        && move.pp > 0
        && !move.isUnimplemented,
    )
    .map(move => move.id);
  return cachedMovePool;
}

export function getFunRandomLevelMoves(pokemonId: number, levelMoves: LevelMoves): LevelMoves {
  if (!currentConfig.randomizeLevelUpMoves || levelMoves.length === 0) {
    return levelMoves;
  }
  const pool = movePool();
  if (pool.length === 0) {
    return levelMoves;
  }
  const used = new Set<MoveId>();
  return levelMoves.map<[number, MoveId]>(([level, originalMove], occurrence) => {
    let index = deterministicIndex(
      pokemonId,
      Math.imul(level + 2, 131) ^ Math.imul(originalMove + 1, 17) ^ occurrence,
      pool.length,
    );
    while (used.has(pool[index]) && used.size < pool.length) {
      index = (index + 1) % pool.length;
    }
    const move = pool[index];
    used.add(move);
    return [level, move];
  });
}

export function getFunScrambledMoveId(
  pokemonId: number,
  usedMoveId: MoveId,
  waveIndex: number,
  turn: number,
  currentMoveIds: readonly MoveId[],
): MoveId | null {
  if (!currentConfig.scrambleMoves) {
    return null;
  }
  const excluded = new Set<MoveId>([...currentMoveIds, MoveId.NONE, MoveId.STRUGGLE]);
  const usedCategory = allMoves[usedMoveId].category;
  const pool = movePool().filter(moveId => {
    if (excluded.has(moveId)) {
      return false;
    }
    const candidateCategory = allMoves[moveId].category;
    return usedCategory === MoveCategory.STATUS
      ? candidateCategory === MoveCategory.STATUS
      : candidateCategory !== MoveCategory.STATUS;
  });
  if (pool.length === 0) {
    return null;
  }
  const salt = Math.imul(usedMoveId + 1, 131) ^ Math.imul(waveIndex + 1, 17) ^ Math.imul(turn + 1, 0x41);
  return pool[deterministicIndex(pokemonId, salt, pool.length)];
}

const FUN_WEATHERS: readonly WeatherType[] = [
  WeatherType.NONE,
  WeatherType.SUNNY,
  WeatherType.RAIN,
  WeatherType.SANDSTORM,
  WeatherType.HAIL,
  WeatherType.SNOW,
  WeatherType.FOG,
  WeatherType.TEMPEST_STORM,
  WeatherType.SNOWY_WRATH,
  WeatherType.EERIE_FOG,
];

export function rollFunWeather(): WeatherType | null {
  return currentConfig.weatherRoulette ? randSeedItem(FUN_WEATHERS) : null;
}

const FUN_TERRAINS: readonly TerrainType[] = [
  TerrainType.NONE,
  TerrainType.MISTY,
  TerrainType.ELECTRIC,
  TerrainType.GRASSY,
  TerrainType.PSYCHIC,
  TerrainType.TOXIC,
];

export function rollFunTerrain(): TerrainType | null {
  return currentConfig.weatherRoulette ? randSeedItem(FUN_TERRAINS) : null;
}

export interface FunRandomSpeciesChoice {
  species: PokemonSpecies;
  formIndex: number;
}

export function getFunEvolutionTarget(
  pokemonId: number,
  currentSpeciesId: number,
  occurrence: number,
): FunRandomSpeciesChoice | null {
  if (!currentConfig.shuffleEvolutions) {
    return null;
  }
  const pool = allSpecies.filter(
    species => species != null && species.speciesId > 0 && species.speciesId !== currentSpeciesId && species.forms.length > 0,
  );
  if (pool.length === 0) {
    return null;
  }
  const species = pool[deterministicIndex(pokemonId, currentSpeciesId ^ Math.imul(occurrence + 1, 0x71), pool.length)];
  const formIndices = species.forms
    .map((form, index) => ({ form, index }))
    .filter(({ form, index }) => index === 0 || form.isStarterSelectable)
    .map(({ index }) => index);
  const formIndex = formIndices.length > 0
    ? formIndices[deterministicIndex(pokemonId, currentSpeciesId ^ Math.imul(occurrence + 1, 0x97), formIndices.length)]
    : 0;
  return { species, formIndex };
}

export function rollFunRandomSpecies(): FunRandomSpeciesChoice | null {
  if (!currentConfig.randomizePokemon) {
    return null;
  }
  const pool = allSpecies.filter(species => species != null && species.speciesId > 0 && species.forms.length > 0);
  if (pool.length === 0) {
    return null;
  }
  const species = randSeedItem(pool);
  const formIndices = species.forms
    .map((form, index) => ({ form, index }))
    .filter(({ form, index }) => index === 0 || form.isStarterSelectable)
    .map(({ index }) => index);
  return {
    species,
    formIndex: formIndices.length > 0 ? formIndices[randSeedInt(formIndices.length)] : 0,
  };
}
