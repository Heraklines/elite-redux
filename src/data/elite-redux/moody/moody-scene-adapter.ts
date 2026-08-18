import { globalScene } from "#app/global-scene";
import {
  absorbMoodyCoordinatorBarrier,
  consumeMoodyCoordinatorMovePower,
  getMoodyCoordinatorEffectState,
  getMoodyCoordinatorSpectralPower,
  grantMoodySetCollectorBarrier,
  updateMoodyCoordinatorEffectValues,
} from "#data/elite-redux/moody/moody-coordinator-combat-state";
import { getMoodyEffectFlyoutCue, shouldShowMoodyEffectFlyout } from "#data/elite-redux/moody/moody-effect-flyout";
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
import {
  applyMoodyFormationDamage,
  getMoodyFormationAction,
  getMoodyFormationExperienceMultiplier,
  getMoodyFormationLearnedResistanceTypes,
  getMoodyFormationMaxHpMultiplier,
  getMoodyFormationSpeedMultiplier,
} from "#data/elite-redux/moody/moody-formation-game-adapter";
import { decodeMoodyActiveItemSets } from "#data/elite-redux/moody/moody-item-sets";
import type { MoodyRuntimeFieldState } from "#data/elite-redux/moody/moody-runtime-field";
import {
  deserializeMoodyRuntimeFieldState,
  serializeMoodyRuntimeFieldState,
} from "#data/elite-redux/moody/moody-runtime-field-adapter";
import {
  applyMoodyRuntimeBeforeDamage,
  canMoodyRuntimeActWhileAsleep,
  getMoodyRuntimeEnemyStatMultiplier,
  getMoodyRuntimePriorityDelta,
  getMoodyRuntimeSpeedMultiplier,
  prepareMoodyRuntimeMoveResolution,
  recordMoodyRuntimeActionTriggers,
} from "#data/elite-redux/moody/moody-runtime-field-engine";
import {
  getMoodyCoordinatorEnemyStatMultiplier,
  getMoodyCoordinatorNegativeSpaceModifiers,
  getMoodyCoordinatorPairDamageMultiplier,
  getMoodyCoordinatorPartyModifiers,
  getMoodyCoordinatorPhaseShiftDamageMultiplier,
  getMoodyCoordinatorPocketPriorityDelta,
  getMoodyCoordinatorTemporaryDamageMultiplier,
} from "#data/elite-redux/moody/moody-runtime-game-adapter";
import { getMoodyModeState, setMoodyRuntimeFieldSaveData } from "#data/elite-redux/moody/moody-state";
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
let enemyCueBattleId = "";
const emittedEnemyCues = new Set<string>();

function sideOf(pokemon: Pokemon): "player" | "enemy" {
  return pokemon.isPlayer() ? "player" : "enemy";
}

function rawMaxHp(pokemon: Pokemon): number {
  return Math.max(1, pokemon.summonData.stats[Stat.HP] || pokemon.stats[Stat.HP] || 1);
}

function itemSetBonuses() {
  return decodeMoodyActiveItemSets(getMoodyCoordinatorEffectState("set-collector")?.values?.activeItemSets);
}

function itemSetProduct(
  key: "statMultiplier" | "healingMultiplier" | "accuracyMultiplier" | "damageMultiplier",
): number {
  return itemSetBonuses().reduce((value, set) => value * set[key], 1);
}

function hasFirstMoveFlag(pokemon: Pokemon): boolean {
  return pokemon.getMoveHistory().every(record => record.move === MoveId.NONE);
}

function emitEnemyPassiveCues(source: Pokemon, target: Pokemon, effects: MoodyPassiveEffectResult): void {
  const loadout = getMoodyEnemyBoonLoadout();
  const battle = globalScene.currentBattle;
  if (loadout == null || battle == null) {
    return;
  }
  const battleId = String(battle.battleSeed);
  if (enemyCueBattleId !== battleId) {
    enemyCueBattleId = battleId;
    emittedEnemyCues.clear();
  }
  const enemyBoonIds = new Set(loadout.boons.map(boon => boon.boonId));
  const triggeredIds = new Set(
    effects.applications.map(application => application.effectId).filter(effectId => enemyBoonIds.has(effectId)),
  );
  for (const effectId of triggeredIds) {
    if (!shouldShowMoodyEffectFlyout(effectId)) {
      continue;
    }
    const key = `${battle.turn}:${source.id}:${target.id}:${effectId}`;
    if (emittedEnemyCues.has(key)) {
      continue;
    }
    emittedEnemyCues.add(key);
    const cue = getMoodyEffectFlyoutCue({ boons: loadout.boons, curses: [] }, effectId, "enemy");
    globalScene.ui.pushMoodyTrigger(cue.name, cue);
  }
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
      learnedResistanceTypes: getMoodyFormationLearnedResistanceTypes()
        .map(value => Number(value))
        .filter((value): value is PokemonType => Number.isSafeInteger(value)),
      ...(options.sameSequenceHitIndex == null ? {} : { sameSequenceHitIndex: options.sameSequenceHitIndex }),
    },
  };
  return mergeEffects([
    queryMoodyPassiveEffects(state, { ...common, effectOwnerSide: "player" }),
    queryMoodyPassiveEffects(enemyState(), { ...common, effectOwnerSide: "enemy" }),
  ]);
}

const deferredDebtKey = (pokemonId: number): string => `persistent:deferred-pain:pokemon:${pokemonId}:debt`;
const deferredDueKey = (pokemonId: number): string => `persistent:deferred-pain:pokemon:${pokemonId}:due`;

function readMoodyFieldState(): MoodyRuntimeFieldState | null {
  const save = getMoodyModeState()?.fieldRuntime;
  return save == null ? null : deserializeMoodyRuntimeFieldState(save);
}

function writeMoodyFieldState(state: MoodyRuntimeFieldState): void {
  const modeState = getMoodyModeState();
  if (modeState == null) {
    return;
  }
  const previous = modeState.fieldRuntime;
  const battle = globalScene.currentBattle;
  setMoodyRuntimeFieldSaveData(
    serializeMoodyRuntimeFieldState(state, {
      battleId: previous?.cursor.battleId ?? String(battle?.battleSeed ?? ""),
      waveIndex: battle?.waveIndex ?? previous?.cursor.waveIndex ?? 0,
      turn: battle?.turn ?? previous?.cursor.turn ?? 0,
      segmentIndex: Math.floor((battle?.waveIndex ?? previous?.cursor.waveIndex ?? 0) / 10),
      biomeId: globalScene.arena?.biomeId ?? previous?.cursor.biomeId ?? -1,
      biomeEpoch: previous?.cursor.biomeEpoch ?? 0,
    }),
  );
}

function withMoodyFieldNumbers(update: (numbers: Record<string, number>) => void): void {
  const state = readMoodyFieldState();
  if (state == null) {
    return;
  }
  const numbers = { ...state.numbers };
  update(numbers);
  writeMoodyFieldState({ ...state, numbers });
}

export function applyMoodyDamageCalculation(
  source: Pokemon,
  target: Pokemon,
  move: Move,
  damage: number,
  simulated: boolean,
): number {
  // A prior damage-stage effect may deliberately nullify the hit (Disguise,
  // Gallantry, Cheating Death, barriers, etc.). Never resurrect that explicit
  // zero through the Moody multiplier path's minimum-one clamp.
  if (damage <= 0) {
    return 0;
  }

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
  const formationDamage = applyMoodyFormationDamage(source, target, move, damage, simulated);
  if (effects == null) {
    return applyMoodyRuntimeBeforeDamage(source, target, move, formationDamage, simulated);
  }
  let resolved = Math.max(
    1,
    Math.floor(
      formationDamage
        * effects.outgoingDamageMultiplier
        * effects.incomingDamageMultiplier
        * getMoodyCoordinatorTemporaryDamageMultiplier(source)
        * getMoodyCoordinatorPairDamageMultiplier(source, simulated)
        * getMoodyCoordinatorPartyModifiers(source, move.type).outgoingDamageMultiplier
        * getMoodyCoordinatorPartyModifiers(target, move.type, true).incomingDamageMultiplier
        * getMoodyCoordinatorSpectralPower(source.id)
        * consumeMoodyCoordinatorMovePower(source.id, simulated)
        * getMoodyCoordinatorNegativeSpaceModifiers(source, move.id).outgoingDamageMultiplier
        * getMoodyCoordinatorNegativeSpaceModifiers(target).incomingDamageMultiplier
        * getMoodyCoordinatorPhaseShiftDamageMultiplier(target, simulated)
        * (source.isPlayer() ? itemSetProduct("damageMultiplier") : 1)
        * (source.isPlayer() && hasFirstMoveFlag(source)
          ? itemSetBonuses().reduce((value, set) => value * set.firstMovePowerMultiplier, 1)
          : 1),
    ),
  );
  if (effects.incomingDamageCapMaxHpFraction != null) {
    resolved = Math.min(resolved, Math.max(1, Math.floor(rawMaxHp(target) * effects.incomingDamageCapMaxHpFraction)));
  }
  if (!simulated) {
    const activeBoonIds = new Set(getMoodyModeState()?.boons.map(boon => boon.boonId) ?? []);
    recordMoodyRuntimeActionTriggers(source.id, [
      ...new Set(
        effects.applications.map(application => application.effectId).filter(effectId => activeBoonIds.has(effectId)),
      ),
    ]);
    emitEnemyPassiveCues(source, target, effects);
  }
  // Field-runtime commands own Deferred Pain's split/debt state. The passive
  // adapter still reports it for coverage/UI, but applying it here as well
  // would split the same hit twice.
  return absorbMoodyCoordinatorBarrier(
    target.id,
    applyMoodyRuntimeBeforeDamage(source, target, move, resolved, simulated),
    simulated,
  );
}

export function consumeMoodyDeferredDamage(pokemon: Pokemon): number {
  const state = readMoodyFieldState();
  if (state == null) {
    return 0;
  }
  const amount = state.numbers[deferredDebtKey(pokemon.id)] ?? 0;
  const dueTurn = state.numbers[deferredDueKey(pokemon.id)] ?? Number.MAX_SAFE_INTEGER;
  if (amount <= 0 || dueTurn > globalScene.currentBattle.turn) {
    return 0;
  }
  withMoodyFieldNumbers(numbers => {
    numbers[deferredDebtKey(pokemon.id)] = 0;
    numbers[deferredDueKey(pokemon.id)] = 0;
  });
  return amount;
}

export function reduceMoodyDeferredDamage(pokemon: Pokemon, healed: number): void {
  if (healed <= 0) {
    return;
  }
  withMoodyFieldNumbers(numbers => {
    const debtKey = deferredDebtKey(pokemon.id);
    numbers[debtKey] = Math.max(0, (numbers[debtKey] ?? 0) - healed);
  });
}

export function clearMoodyDeferredDamage(): void {
  withMoodyFieldNumbers(numbers => {
    for (const key of Object.keys(numbers)) {
      if (key.startsWith("persistent:deferred-pain:pokemon:")) {
        delete numbers[key];
      }
    }
  });
}

export function getMoodyStatMultiplier(pokemon: Pokemon, stat: Stat): number {
  const effects = queryMoodySceneEffects({ actor: pokemon, target: pokemon });
  const formationMultiplier =
    stat === Stat.HP
      ? getMoodyFormationMaxHpMultiplier(pokemon)
      : stat === Stat.SPD
        ? getMoodyFormationSpeedMultiplier(pokemon)
        : 1;
  const fieldEnemyMultiplier = getMoodyRuntimeEnemyStatMultiplier(pokemon);
  const enemyMultiplier =
    pokemon.isEnemy() && fieldEnemyMultiplier === 1 ? getMoodyCoordinatorEnemyStatMultiplier() : fieldEnemyMultiplier;
  const runtimeMultiplier = enemyMultiplier * (stat === Stat.SPD ? getMoodyRuntimeSpeedMultiplier(pokemon) : 1);
  const coordinatorSpeedMultiplier = stat === Stat.SPD ? getMoodyCoordinatorPartyModifiers(pokemon).speedMultiplier : 1;
  const collectorMultiplier = pokemon.isPlayer() ? itemSetProduct("statMultiplier") : 1;
  if (effects == null) {
    return formationMultiplier * runtimeMultiplier * coordinatorSpeedMultiplier * collectorMultiplier;
  }
  if (stat === Stat.HP) {
    return effects.maxHpMultiplier * formationMultiplier * runtimeMultiplier * collectorMultiplier;
  }
  return (
    effects.nonHpStatMultiplier
    * (stat === Stat.SPD ? effects.speedMultiplier * getMoodyRuntimeSpeedMultiplier(pokemon) : 1)
    * formationMultiplier
    * enemyMultiplier
    * coordinatorSpeedMultiplier
    * collectorMultiplier
  );
}

export function getMoodyMovePriorityDelta(user: Pokemon, move: Move): number {
  prepareMoodyRuntimeMoveResolution(user);
  return (
    (queryMoodySceneEffects({ actor: user, target: user, move })?.priorityDelta ?? 0)
    + getMoodyRuntimePriorityDelta(user)
    + getMoodyFormationAction(user.id).reduce((value, command) => value + (command.priorityDelta ?? 0), 0)
    + getMoodyCoordinatorPocketPriorityDelta(user)
    + getMoodyCoordinatorNegativeSpaceModifiers(user, move.id).priorityDelta
    + getMoodyCoordinatorPartyModifiers(user, move.type).priorityDelta
    + (user.isPlayer() && hasFirstMoveFlag(user)
      ? itemSetBonuses().reduce((value, set) => value + set.firstMovePriorityDelta, 0)
      : 0)
  );
}

export function getMoodyPpCost(user: Pokemon, move: PokemonMove, baseCost: number): number {
  const effects = queryMoodySceneEffects({ actor: user, target: user, move: move.getMove() });
  const passiveCost =
    effects == null ? baseCost : Math.max(0, Math.floor(baseCost * effects.ppCostMultiplier + effects.ppCostFlatDelta));
  return getMoodyFormationAction(user.id).reduce(
    (value, command) => (command.ppCost == null ? value : Math.max(0, command.ppCost)),
    passiveCost,
  );
}

export function getMoodyHealingMultiplier(pokemon: Pokemon): number {
  return (
    (queryMoodySceneEffects({ actor: pokemon, target: pokemon })?.healingMultiplier ?? 1)
    * (pokemon.isPlayer() ? itemSetProduct("healingMultiplier") : 1)
  );
}

export function grantMoodyItemSetHealingBarrier(pokemon: Pokemon, healed: number): number {
  if (!pokemon.isPlayer() || healed <= 0) {
    return 0;
  }
  const fraction = itemSetBonuses().reduce((value, set) => Math.max(value, set.firstHealBarrierFraction), 0);
  const used = getMoodyCoordinatorEffectState("set-collector")?.values?.firstHealBarrierBattleId;
  const battleId = String(globalScene.currentBattle?.battleSeed ?? "");
  if (fraction <= 0 || used === battleId) {
    return 0;
  }
  const amount = Math.max(1, Math.floor(pokemon.getMaxHp() * fraction));
  grantMoodySetCollectorBarrier(pokemon.id, amount);
  updateMoodyCoordinatorEffectValues("set-collector", values => ({ ...values, firstHealBarrierBattleId: battleId }));
  return amount;
}

export function getMoodySelfStatusDamageMultiplier(pokemon: Pokemon): number {
  return pokemon.isPlayer() ? itemSetBonuses().reduce((value, set) => value * set.selfStatusDamageMultiplier, 1) : 1;
}

export function getMoodyAccuracyMultiplier(user: Pokemon, target: Pokemon, move: Move): number {
  const effects = queryMoodySceneEffects({ actor: user, target, move });
  const actions = getMoodyFormationAction(user.id);
  if (effects?.alwaysHits || actions.some(command => command.alwaysHits)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return (
    (effects?.accuracyMultiplier ?? 1)
    * actions.reduce((value, command) => value * (command.accuracyMultiplier ?? 1), 1)
    * (user.isPlayer() ? itemSetProduct("accuracyMultiplier") : 1)
  );
}

export function canMoodyActWhileAsleep(user: Pokemon, move: Move): boolean {
  return (
    queryMoodySceneEffects({ actor: user, target: user, move })?.canActWhileAsleep === true
    || canMoodyRuntimeActWhileAsleep(user)
  );
}

export function getMoodyExperienceMultiplier(pokemon: Pokemon): number {
  return (
    (queryMoodySceneEffects({ actor: pokemon, target: pokemon })?.experienceMultiplier ?? 1)
    * getMoodyFormationExperienceMultiplier(pokemon)
  );
}

export function getMoodyBossMoneyGainMultiplier(): number {
  return 1;
}

export function getMoodyCaptureMultiplier(target: Pokemon): number {
  return queryMoodySceneEffects({ target })?.captureMultiplier ?? 1;
}

export function getMoodyPlayerBoons(): readonly MoodyBoonInstance[] {
  return getMoodyModeState()?.boons ?? [];
}
