import { globalScene } from "#app/global-scene";
import {
  getErEndlessBonusBoonBudget,
  getErEndlessEquivalentDepth,
  getErEndlessState,
  scaleErEndlessEncounterPressureBudget,
} from "#data/elite-redux/er-endless-continuation";
import {
  MOODY_PASSIVE_PARTIAL_BOON_IDS,
  MOODY_PASSIVE_SUPPORTED_BOON_IDS,
} from "#data/elite-redux/moody/moody-effects";
import { getMoodyRuntimeCounterWeight } from "#data/elite-redux/moody/moody-runtime-field-engine";
import { getMoodyCoordinatorCounterWeight } from "#data/elite-redux/moody/moody-runtime-game-adapter";
import { getMoodyBoonBudget, getMoodyModeState, rollMoodyBoonDefinition } from "#data/elite-redux/moody/moody-state";
import type {
  MoodyBoonDefinition,
  MoodyBoonInstance,
  MoodyBoonTarget,
  MoodyEnemyBoonLoadout,
} from "#data/elite-redux/moody/moody-types";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import { PokemonHeldItemModifier } from "#modifiers/modifier";

let currentEnemyLoadout: MoodyEnemyBoonLoadout | null = null;

export const MOODY_ENEMY_RUNTIME_BOON_IDS: ReadonlySet<string> = new Set(
  [...MOODY_PASSIVE_SUPPORTED_BOON_IDS].filter(id => !MOODY_PASSIVE_PARTIAL_BOON_IDS.has(id)),
);

function mix32(value: number): number {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

function seededUnit(seed: number, salt: number): number {
  return mix32(seed ^ Math.imul(salt + 1, 0x9e3779b1)) / 0x1_0000_0000;
}

function bst(pokemon: Pokemon): number {
  return pokemon.getSpeciesForm().baseStats.reduce((sum, stat) => sum + stat, 0);
}

function strongestMove(pokemon: Pokemon) {
  return [...pokemon.getMoveset()].sort((left, right) => right.getMove().power - left.getMove().power)[0];
}

function dominantMoveType(pokemon: Pokemon): PokemonType {
  const totals = new Map<PokemonType, number>();
  for (const move of pokemon.getMoveset()) {
    const resolved = move.getMove();
    totals.set(resolved.type, (totals.get(resolved.type) ?? 0) + Math.max(1, resolved.power));
  }
  return (
    [...totals.entries()].sort((left, right) => right[1] - left[1])[0]?.[0]
    ?? pokemon.getTypes()[0]
    ?? PokemonType.NORMAL
  );
}

function mechanicalSynergy(definition: MoodyBoonDefinition, pokemon: Pokemon): number {
  const moves = pokemon.getMoveset();
  if (definition.targetKind === "move") {
    return Math.min(35, (strongestMove(pokemon)?.getMove().power ?? 0) / 4);
  }
  if (definition.targetKind === "pokemon-type" || definition.targetKind === "enemy-type") {
    const types = new Set(pokemon.getTypes());
    const matchingPower = moves.reduce(
      (sum, move) => sum + (types.has(move.getMove().type) ? Math.max(1, move.getMove().power) : 0),
      0,
    );
    return Math.min(35, matchingPower / 12);
  }
  const text = definition.fullDescription.toLowerCase();
  const damagingMoves = moves.filter(move => move.getMove().power > 0);
  let score = damagingMoves.length * 3;
  if (text.includes("status") && moves.some(move => move.getMove().power === 0)) {
    score += 8;
  }
  if (text.includes("switch") && pokemon.getTypes().length > 1) {
    score += 4;
  }
  if (text.includes("boss") && pokemon.isBoss()) {
    score += 10;
  }
  return Math.min(35, score);
}

function roleScore(pokemon: Pokemon, index: number, partyLength: number): number {
  if (pokemon.isBoss()) {
    return 25;
  }
  return 8 + (17 * (index + 1)) / Math.max(1, partyLength);
}

function triggerScore(definition: MoodyBoonDefinition, pokemon: Pokemon): number {
  if (definition.targetKind === "move") {
    return pokemon.getMoveset().length > 0 ? 10 : 0;
  }
  if (definition.targetKind === "item-stack") {
    return globalScene.findModifiers(
      modifier => modifier instanceof PokemonHeldItemModifier && modifier.pokemonId === pokemon.id,
      false,
    ).length > 0
      ? 10
      : 0;
  }
  return pokemon.isFainted(true) ? 2 : 10;
}

function counterScore(definition: MoodyBoonDefinition): number {
  const topThreat = getMoodyModeState()?.recentThreat.toSorted(
    (left, right) =>
      right.damageDealt
      + right.bossSegmentDamage * 2
      + right.knockouts * 100
      - (left.damageDealt + left.bossSegmentDamage * 2 + left.knockouts * 100),
  )[0];
  if (topThreat == null) {
    return 5;
  }
  const text = definition.fullDescription.toLowerCase();
  if (topThreat.speedDependence > 0.6 && (text.includes("priority") || text.includes("speed"))) {
    return 10;
  }
  if ((topThreat.physicalBias > 0.6 || topThreat.specialBias > 0.6) && text.includes("damage reduction")) {
    return 9;
  }
  return 5;
}

function targetScore(
  definition: MoodyBoonDefinition,
  pokemon: Pokemon,
  index: number,
  party: readonly Pokemon[],
): number {
  const partyBst = party.map(bst);
  const minBst = Math.min(...partyBst);
  const maxBst = Math.max(...partyBst);
  const normalizedBst = maxBst === minBst ? 20 : ((bst(pokemon) - minBst) / (maxBst - minBst)) * 20;
  return (
    mechanicalSynergy(definition, pokemon)
    + roleScore(pokemon, index, party.length)
    + normalizedBst
    + triggerScore(definition, pokemon)
    + counterScore(definition)
  );
}

function rankedTargets(definition: MoodyBoonDefinition, party: readonly Pokemon[]): Pokemon[] {
  return party
    .map((pokemon, index) => ({ pokemon, score: targetScore(definition, pokemon, index, party) }))
    .sort((left, right) => right.score - left.score || bst(right.pokemon) - bst(left.pokemon))
    .map(entry => entry.pokemon);
}

function assignTarget(definition: MoodyBoonDefinition, party: readonly Pokemon[]): MoodyBoonTarget | undefined {
  if (
    party.length === 0
    || ["team", "field", "economy", "reward", "contract", "rule"].includes(definition.targetKind)
  ) {
    return;
  }
  const ranked = rankedTargets(definition, party);
  const primary = ranked[0];
  if (definition.targetKind === "pokemon-pair") {
    return { pokemonIds: ranked.slice(0, 2).map(pokemon => pokemon.id) };
  }
  if (definition.targetKind === "slots") {
    return { partySlots: ranked.slice(0, 2).map(pokemon => party.indexOf(pokemon)) };
  }
  if (definition.targetKind === "slot") {
    return { partySlots: [party.indexOf(primary)] };
  }
  if (definition.targetKind === "move") {
    const move = strongestMove(primary);
    return {
      pokemonIds: [primary.id],
      ...(move == null ? {} : { moveIds: [move.moveId] }),
    };
  }
  if (definition.targetKind === "pokemon-type" || definition.targetKind === "enemy-type") {
    return { pokemonIds: [primary.id], pokemonType: dominantMoveType(primary) };
  }
  if (definition.targetKind === "item-stack") {
    const item = globalScene
      .findModifiers(
        modifier => modifier instanceof PokemonHeldItemModifier && modifier.pokemonId === primary.id,
        false,
      )
      .toSorted((left, right) => right.stackCount - left.stackCount)[0];
    return { pokemonIds: [primary.id], ...(item == null ? {} : { itemTypeIds: [item.type.id] }) };
  }
  return { pokemonIds: [primary.id] };
}

export function generateMoodyEnemyBoonLoadout(
  party: readonly Pokemon[],
  waveIndex: number,
  counterWeightOverride?: number,
): MoodyEnemyBoonLoadout {
  const state = getMoodyModeState();
  const budget = getMoodyBoonBudget();
  if (state == null || budget === 0) {
    return { waveIndex, boons: [] };
  }
  return generateEnemyBoonLoadout(party, waveIndex, budget, state.seed, counterWeightOverride);
}

function generateEnemyBoonLoadout(
  party: readonly Pokemon[],
  waveIndex: number,
  budget: number,
  seedInput: number,
  counterWeightOverride?: number,
): MoodyEnemyBoonLoadout {
  const boons: MoodyBoonInstance[] = [];
  const seed = mix32(seedInput ^ Math.imul(waveIndex + 1, 0x85ebca6b));
  const fieldCounterWeight = counterWeightOverride ?? getMoodyRuntimeCounterWeight();
  const counterCandidates = Math.max(
    1,
    Math.ceil(fieldCounterWeight === 1 ? getMoodyCoordinatorCounterWeight() : fieldCounterWeight),
  );
  for (let roll = 0; roll < budget; roll++) {
    const maxed = new Set(boons.filter(boon => boon.rank === 3).map(boon => boon.boonId));
    const definition = Array.from({ length: counterCandidates }, (_, candidate) =>
      rollMoodyBoonDefinition(seed, roll * counterCandidates + candidate, maxed, MOODY_ENEMY_RUNTIME_BOON_IDS),
    )
      .filter((candidate): candidate is MoodyBoonDefinition => candidate != null)
      .toSorted((left, right) => counterScore(right) - counterScore(left))[0]!;
    const existing = boons.find(boon => boon.boonId === definition.id);
    if (existing == null) {
      const target = assignTarget(definition, party);
      boons.push({
        instanceId: `enemy:${waveIndex}:${definition.id}`,
        boonId: definition.id,
        rank: 1,
        acquiredAtWave: waveIndex,
        ...(target == null ? {} : { target }),
      });
    } else if (existing.rank === 1) {
      existing.rank = 2;
    } else if (existing.rank === 2) {
      existing.rank = 3;
      existing.evolutionId =
        definition.evolutions[Math.floor(seededUnit(seed, roll + 500) * definition.evolutions.length)].id;
    }
  }
  return { waveIndex, boons };
}

/** Endless enemies inherit the player's boon power, then gain depth-scaled power. */
export function generateEndlessEnemyBoonLoadout(
  party: readonly Pokemon[],
  waveIndex: number,
  counterBiased = false,
  nemesisRank = 0,
  bossBattle = false,
): MoodyEnemyBoonLoadout {
  const endless = getErEndlessState();
  if (endless == null) {
    return { waveIndex, boons: [] };
  }
  const depth = getErEndlessEquivalentDepth(waveIndex);
  const referencePower = Math.max(2, getMoodyBoonBudget() + 2 + Math.floor(depth / 20));
  const pressureBoonBudget = getErEndlessBonusBoonBudget(waveIndex);
  const stringSeed = [...endless.seed].reduce(
    (hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619),
    2166136261,
  );
  const multiplier = 1 + (mix32(stringSeed ^ waveIndex ^ 0x6d2b79f5) % 3) * 0.25;
  const nemesisMultiplier =
    nemesisRank >= 4 ? Math.min(2, 1.5 + (nemesisRank - 2) * 0.125) : nemesisRank >= 2 ? 1.5 : 1;
  const boonBudget = Math.max(
    1,
    Math.round(referencePower * multiplier * nemesisMultiplier) + (nemesisRank >= 1 ? 1 : 0) + pressureBoonBudget,
  );
  return generateEnemyBoonLoadout(
    party,
    waveIndex,
    scaleErEndlessEncounterPressureBudget(boonBudget, bossBattle),
    stringSeed,
    counterBiased || nemesisRank >= 1 ? (nemesisRank >= 2 ? 4 : 2) : undefined,
  );
}

export function setMoodyEnemyBoonLoadout(loadout: MoodyEnemyBoonLoadout | null): void {
  currentEnemyLoadout = loadout == null ? null : structuredClone(loadout);
}

export function getMoodyEnemyBoonLoadout(): Readonly<MoodyEnemyBoonLoadout> | null {
  return currentEnemyLoadout;
}

export function resetMoodyEnemyBoonLoadout(): void {
  currentEnemyLoadout = null;
}
