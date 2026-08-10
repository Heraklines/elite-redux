import { globalScene } from "#app/global-scene";
import {
  type MoodyPassiveEffectResult,
  type MoodyPassiveFlags,
  type MoodyPassivePartyContext,
  type MoodyPassivePokemonContext,
  type MoodyPassiveQueryContext,
  type MoodyPassiveState,
  queryMoodyPassiveEffects,
} from "#data/elite-redux/moody/moody-effects";
import { getMoodyEnemyBoonLoadout } from "#data/elite-redux/moody/moody-enemy";
import { getMoodyModeState } from "#data/elite-redux/moody/moody-state";
import type { MoodyBoonInstance } from "#data/elite-redux/moody/moody-types";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import type { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import type { PokemonMove } from "#moves/pokemon-move";

const EMPTY_STATE: MoodyPassiveState = Object.freeze({ boons: [], curses: [] });

function sideOf(pokemon: Pokemon): "player" | "enemy" {
  return pokemon.isPlayer() ? "player" : "enemy";
}

function rawMaxHp(pokemon: Pokemon): number {
  return Math.max(1, pokemon.summonData.stats[Stat.HP] || pokemon.stats[Stat.HP] || 1);
}

function statusOf(pokemon: Pokemon): MoodyPassivePokemonContext["status"] {
  switch (pokemon.status?.effect) {
    case StatusEffect.BURN:
      return "burn";
    case StatusEffect.POISON:
      return "poison";
    case StatusEffect.TOXIC:
      return "toxic";
    case StatusEffect.PARALYSIS:
      return "paralysis";
    case StatusEffect.SLEEP:
      return "sleep";
    default:
      return;
  }
}

export function toMoodyPokemonContext(pokemon: Pokemon, partySlot?: number): MoodyPassivePokemonContext {
  const party: readonly Pokemon[] = pokemon.isPlayer() ? globalScene.getPlayerParty() : globalScene.getEnemyParty();
  const status = statusOf(pokemon);
  return {
    id: pokemon.id,
    partySlot: partySlot ?? Math.max(0, party.indexOf(pokemon)),
    types: pokemon.getTypes(false, false),
    level: pokemon.level,
    currentHp: pokemon.hp,
    maxHp: rawMaxHp(pokemon),
    fainted: pokemon.isFainted(true),
    fullyEvolved: pokemon.getEvolution() == null,
    ...(status == null ? {} : { status }),
  };
}

function toMoodyPartyContext(pokemon: Pokemon): MoodyPassivePartyContext {
  const party = pokemon.isPlayer() ? globalScene.getPlayerParty() : globalScene.getEnemyParty();
  const slots = party.map((member, index) => toMoodyPokemonContext(member, index));
  const typeCounts = new Map<PokemonType, number>();
  for (const member of slots) {
    for (const type of member.types) {
      typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    }
  }
  const levelSorted = slots.toSorted((left, right) => left.level - right.level || left.id - right.id);
  return {
    slots,
    averageLevel: slots.length === 0 ? 0 : slots.reduce((sum, member) => sum + member.level, 0) / slots.length,
    uniqueTypeCount: typeCounts.size,
    ...(levelSorted[0] == null ? {} : { lowestEligiblePokemonId: levelSorted[0].id }),
    ...(levelSorted[1] == null ? {} : { secondLowestEligiblePokemonId: levelSorted[1].id }),
  };
}

function toMoodyMoveContext(user: Pokemon, move: Move): MoodyPassiveQueryContext["move"] {
  const pokemonMove = user.getMoveset().find(candidate => candidate.moveId === move.id);
  const maxPp = pokemonMove?.getMovePp() ?? move.pp;
  const history = user.getMoveHistory().filter(record => record.move !== MoveId.NONE);
  let consecutiveUses = 1;
  for (let index = history.length - 1; index >= 0 && history[index]?.move === move.id; index--) {
    consecutiveUses++;
  }
  return {
    id: move.id as MoveId,
    type: user.getMoveType(move),
    category: move.category,
    priority: move.priority,
    currentPp: maxPp < 0 ? maxPp : Math.max(0, maxPp - (pokemonMove?.ppUsed ?? 0)),
    maxPp,
    useNumber: Math.max(1, (pokemonMove?.ppUsed ?? 0) + 1),
    consecutiveUses,
    isStab: user.getTypes(false, false).includes(user.getMoveType(move)),
    isDamaging: move.category !== MoveCategory.STATUS && move.power > 0,
  };
}

function enemyState(): MoodyPassiveState {
  const loadout = getMoodyEnemyBoonLoadout();
  return loadout == null ? EMPTY_STATE : { boons: loadout.boons, curses: [] };
}

function mergeEffects(results: readonly MoodyPassiveEffectResult[]): MoodyPassiveEffectResult {
  return {
    outgoingDamageMultiplier: results.reduce((value, result) => value * result.outgoingDamageMultiplier, 1),
    incomingDamageMultiplier: results.reduce((value, result) => value * result.incomingDamageMultiplier, 1),
    incomingDamageCapMaxHpFraction:
      results
        .map(result => result.incomingDamageCapMaxHpFraction)
        .filter((value): value is number => value != null)
        .sort((left, right) => left - right)[0] ?? null,
    immediateDamageFraction: results.reduce((value, result) => Math.min(value, result.immediateDamageFraction), 1),
    deferredDamageFraction: results.reduce((value, result) => Math.max(value, result.deferredDamageFraction), 0),
    maxHpMultiplier: results.reduce((value, result) => value * result.maxHpMultiplier, 1),
    nonHpStatMultiplier: results.reduce((value, result) => value * result.nonHpStatMultiplier, 1),
    speedMultiplier: results.reduce((value, result) => value * result.speedMultiplier, 1),
    healingMultiplier: results.reduce((value, result) => value * result.healingMultiplier, 1),
    priorityDelta: results.reduce((value, result) => value + result.priorityDelta, 0),
    accuracyMultiplier: results.reduce((value, result) => value * result.accuracyMultiplier, 1),
    alwaysHits: results.some(result => result.alwaysHits),
    canActWhileAsleep: results.some(result => result.canActWhileAsleep),
    ppCostMultiplier: results.reduce((value, result) => value * result.ppCostMultiplier, 1),
    ppCostFlatDelta: results.reduce((value, result) => value + result.ppCostFlatDelta, 0),
    maxPpFlatDelta: results.reduce((value, result) => value + result.maxPpFlatDelta, 0),
    experienceMultiplier: results.reduce((value, result) => value * result.experienceMultiplier, 1),
    moneyGainMultiplier: results.reduce((value, result) => value * result.moneyGainMultiplier, 1),
    shopPriceMultiplier: results.reduce((value, result) => value * result.shopPriceMultiplier, 1),
    captureMultiplier: results.reduce((value, result) => value * result.captureMultiplier, 1),
    rewardRarityOffset: results.reduce((value, result) => value + result.rewardRarityOffset, 0),
    rewardQuantityMultiplier: results.reduce((value, result) => value * result.rewardQuantityMultiplier, 1),
    applications: results.flatMap(result => result.applications),
  };
}

export interface MoodySceneQueryOptions {
  actor?: Pokemon;
  target?: Pokemon;
  move?: Move;
  flags?: MoodyPassiveFlags;
  sameSequenceHitIndex?: number;
  economy?: MoodyPassiveQueryContext["economy"];
  reward?: MoodyPassiveQueryContext["reward"];
}

export function queryMoodySceneEffects(options: MoodySceneQueryOptions): MoodyPassiveEffectResult | null {
  const state = getMoodyModeState();
  if (state == null || globalScene.currentBattle == null) {
    return null;
  }
  const actorSide = options.actor == null ? "player" : sideOf(options.actor);
  const targetSide = options.target == null ? actorSide : sideOf(options.target);
  const actor = options.actor == null ? null : toMoodyPokemonContext(options.actor);
  const target = options.target == null ? null : toMoodyPokemonContext(options.target);
  const move = options.move == null || options.actor == null ? null : toMoodyMoveContext(options.actor, options.move);
  const party = options.actor == null ? null : toMoodyPartyContext(options.actor);
  const common: Omit<MoodyPassiveQueryContext, "effectOwnerSide"> = {
    actorSide,
    targetSide,
    ...(actor == null ? {} : { actor }),
    ...(target == null ? {} : { target }),
    ...(move == null ? {} : { move }),
    ...(party == null ? {} : { party }),
    ...(options.flags == null ? {} : { flags: options.flags }),
    ...(options.economy == null ? {} : { economy: options.economy }),
    ...(options.reward == null ? {} : { reward: options.reward }),
    battle: {
      waveIndex: globalScene.currentBattle.waveIndex,
      turn: globalScene.currentBattle.turn,
      isBoss: globalScene.getEnemyParty().some(pokemon => pokemon.isBoss()),
      ...(options.sameSequenceHitIndex == null ? {} : { sameSequenceHitIndex: options.sameSequenceHitIndex }),
    },
  };
  return mergeEffects([
    queryMoodyPassiveEffects(state, { ...common, effectOwnerSide: "player" }),
    queryMoodyPassiveEffects(enemyState(), { ...common, effectOwnerSide: "enemy" }),
  ]);
}

interface DeferredDamageDebt {
  amount: number;
  dueTurn: number;
}

const deferredDamageByPokemon = new Map<number, DeferredDamageDebt>();

export function applyMoodyDamageCalculation(
  source: Pokemon,
  target: Pokemon,
  move: Move,
  damage: number,
  simulated: boolean,
): number {
  const moveHistory = source.getMoveHistory();
  const effects = queryMoodySceneEffects({
    actor: source,
    target,
    move,
    flags: {
      firstDamagingMove: moveHistory.every(record => record.move === MoveId.NONE),
      firstDirectHitReceived: target.turnData.attacksReceived.length === 0,
      firstMoveAfterEntry: moveHistory.length === 0,
    },
    sameSequenceHitIndex: Math.max(1, source.turnData.hitCount - source.turnData.hitsLeft + 1),
  });
  if (effects == null) {
    return damage;
  }
  let resolved = Math.max(1, Math.floor(damage * effects.outgoingDamageMultiplier * effects.incomingDamageMultiplier));
  if (effects.incomingDamageCapMaxHpFraction != null) {
    resolved = Math.min(resolved, Math.max(1, Math.floor(rawMaxHp(target) * effects.incomingDamageCapMaxHpFraction)));
  }
  if (effects.deferredDamageFraction > 0) {
    const deferred = Math.max(0, Math.floor(resolved * effects.deferredDamageFraction));
    resolved = Math.max(1, resolved - deferred);
    if (!simulated && deferred > 0) {
      const previous = deferredDamageByPokemon.get(target.id);
      deferredDamageByPokemon.set(target.id, {
        amount: Math.min(Math.floor(rawMaxHp(target) * 0.5), (previous?.amount ?? 0) + deferred),
        dueTurn: Math.max(previous?.dueTurn ?? 0, globalScene.currentBattle.turn + 1),
      });
    }
  }
  return resolved;
}

export function consumeMoodyDeferredDamage(pokemon: Pokemon): number {
  const debt = deferredDamageByPokemon.get(pokemon.id);
  if (debt == null || debt.dueTurn > globalScene.currentBattle.turn) {
    return 0;
  }
  deferredDamageByPokemon.delete(pokemon.id);
  return debt.amount;
}

export function reduceMoodyDeferredDamage(pokemon: Pokemon, healed: number): void {
  const debt = deferredDamageByPokemon.get(pokemon.id);
  if (debt == null || healed <= 0) {
    return;
  }
  debt.amount = Math.max(0, debt.amount - healed);
  if (debt.amount === 0) {
    deferredDamageByPokemon.delete(pokemon.id);
  }
}

export function clearMoodyDeferredDamage(): void {
  deferredDamageByPokemon.clear();
}

export function getMoodyStatMultiplier(pokemon: Pokemon, stat: Stat): number {
  const effects = queryMoodySceneEffects({ actor: pokemon, target: pokemon });
  if (effects == null) {
    return 1;
  }
  if (stat === Stat.HP) {
    return effects.maxHpMultiplier;
  }
  return effects.nonHpStatMultiplier * (stat === Stat.SPD ? effects.speedMultiplier : 1);
}

export function getMoodyMovePriorityDelta(user: Pokemon, move: Move): number {
  return queryMoodySceneEffects({ actor: user, target: user, move })?.priorityDelta ?? 0;
}

export function getMoodyPpCost(user: Pokemon, move: PokemonMove, baseCost: number): number {
  const effects = queryMoodySceneEffects({ actor: user, target: user, move: move.getMove() });
  return effects == null
    ? baseCost
    : Math.max(0, Math.floor(baseCost * effects.ppCostMultiplier + effects.ppCostFlatDelta));
}

export function getMoodyHealingMultiplier(pokemon: Pokemon): number {
  return queryMoodySceneEffects({ actor: pokemon, target: pokemon })?.healingMultiplier ?? 1;
}

export function getMoodyAccuracyMultiplier(user: Pokemon, target: Pokemon, move: Move): number {
  const effects = queryMoodySceneEffects({ actor: user, target, move });
  if (effects == null) {
    return 1;
  }
  return effects.alwaysHits ? Number.MAX_SAFE_INTEGER : effects.accuracyMultiplier;
}

export function canMoodyActWhileAsleep(user: Pokemon, move: Move): boolean {
  return queryMoodySceneEffects({ actor: user, target: user, move })?.canActWhileAsleep === true;
}

export function getMoodyExperienceMultiplier(pokemon: Pokemon): number {
  return queryMoodySceneEffects({ actor: pokemon, target: pokemon })?.experienceMultiplier ?? 1;
}

export function getMoodyBossMoneyGainMultiplier(): number {
  if (!globalScene.getEnemyParty().some(pokemon => pokemon.isBoss())) {
    return 1;
  }
  return queryMoodySceneEffects({ economy: { event: "boss-interest" } })?.moneyGainMultiplier ?? 1;
}

export function getMoodyCaptureMultiplier(target: Pokemon): number {
  return queryMoodySceneEffects({ target })?.captureMultiplier ?? 1;
}

export function getMoodyPlayerBoons(): readonly MoodyBoonInstance[] {
  return getMoodyModeState()?.boons ?? [];
}
