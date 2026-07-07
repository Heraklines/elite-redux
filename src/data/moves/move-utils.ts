import { globalScene } from "#app/global-scene";
import type { BattlerId } from "#data/battle-format";
import { allMoves } from "#data/data-lists";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory, type MoveDamageCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import type { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import { PokemonType } from "#enums/pokemon-type";
import type { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { applyMoveAttrs } from "#moves/apply-attrs";
import type { Move, UserMoveConditionFunc } from "#moves/move";
import type { MoveTargetSet } from "#types/move-target-set";
import { areAllies } from "#utils/pokemon-utils";
import { ValueHolder } from "#utils/value-holder";

/**
 * Return whether the move targets the field
 *
 * Examples include
 * - Hazard moves like spikes
 * - Weather moves like rain dance
 * - User side moves like reflect and safeguard
 */
export function isFieldTargeted(move: Move): boolean {
  switch (move.moveTarget) {
    case MoveTarget.BOTH_SIDES:
    case MoveTarget.USER_SIDE:
    case MoveTarget.ENEMY_SIDE:
      return true;
  }
  return false;
}

/**
 * Determine whether a move is a spread move.
 *
 * @param move - The {@linkcode Move} to check
 * @returns Whether {@linkcode move} is spread-targeted.
 * @remarks
 * Examples include:
 * - Moves targeting all adjacent Pokemon (like Surf)
 * - Moves targeting all adjacent enemies (like Air Cutter)
 */

export function isSpreadMove(move: Move): boolean {
  switch (move.moveTarget) {
    case MoveTarget.ALL_ENEMIES:
    case MoveTarget.ALL_NEAR_ENEMIES:
    case MoveTarget.ALL_OTHERS:
    case MoveTarget.ALL_NEAR_OTHERS:
      return true;
  }
  return false;
}

/**
 * Elite Redux — abilities (Artillery / Amplifier / Sweeping Edge) that grant the
 * user's single-target enemy moves SPREAD targeting ("hit both opposing
 * Pokemon") when the move carries the matching flag. Returns true when the
 * user's active ability/innates include a {@link SpreadTargetByFlagAbAttr} whose
 * flag is set on the move. Per ER spec, multihit moves never spread.
 */
function userGrantsSpreadTargeting(user: Pokemon, move: Move): boolean {
  if (move.hasAttr("MultiHitAttr") || !user.hasAbilityWithAttr("SpreadTargetByFlagAbAttr")) {
    return false;
  }
  return user.getAbilityAttrs("SpreadTargetByFlagAbAttr").some(a => move.hasFlag(a.flag));
}

export function getMoveTargets(user: Pokemon, move: MoveId, replaceTarget?: MoveTarget): MoveTargetSet {
  const variableTarget = new ValueHolder(replaceTarget ?? allMoves[move].moveTarget);
  user.getOpponents(false).forEach(p => applyMoveAttrs("VariableTargetAttr", user, p, allMoves[move], variableTarget));

  let moveTarget: MoveTarget = variableTarget.value;
  // Elite Redux: promote a single-target enemy move to a both-foes spread move
  // when the user's ability grants spread targeting for the move's flag. Most
  // single-target damaging moves default to NEAR_OTHER (can pick an ally in
  // doubles); a few are NEAR_ENEMY. Both become ALL_NEAR_ENEMIES per the ER
  // spec ("hit both opposing Pokemon").
  if (
    (moveTarget === MoveTarget.NEAR_OTHER || moveTarget === MoveTarget.NEAR_ENEMY)
    && userGrantsSpreadTargeting(user, allMoves[move])
  ) {
    moveTarget = MoveTarget.ALL_NEAR_ENEMIES;
  }
  const opponents = user.getOpponents(false);

  let set: Pokemon[] = [];
  let multiple = false;
  // Multi-format: a side can have more than one ally (triple centre). Binary -> 0/1, so
  // [user, ...allies] is byte-identical to the legacy [user, ally].
  const allies: Pokemon[] = user.getAllies();
  switch (moveTarget) {
    case MoveTarget.USER:
    case MoveTarget.PARTY:
      set = [user];
      break;

    // biome-ignore lint/suspicious/noFallthroughSwitchClause: intentional
    case MoveTarget.CURSE:
      // Non ghost-type Curse targets exclusively the user; ghost-type Curse targets any enemy
      // TODO: check if the user is about to Terastallize to/from Ghost type
      if (!user.isOfType(PokemonType.GHOST, true, true)) {
        set = [user];
        break;
      }
    case MoveTarget.NEAR_OTHER:
    case MoveTarget.OTHER:
    case MoveTarget.ALL_NEAR_OTHERS:
    case MoveTarget.ALL_OTHERS:
      set = opponents.concat(allies);
      multiple = moveTarget === MoveTarget.ALL_NEAR_OTHERS || moveTarget === MoveTarget.ALL_OTHERS;
      break;
    case MoveTarget.NEAR_ENEMY:
    case MoveTarget.ALL_NEAR_ENEMIES:
    case MoveTarget.ALL_ENEMIES:
    case MoveTarget.ENEMY_SIDE:
      set = opponents;
      multiple = moveTarget !== MoveTarget.NEAR_ENEMY;
      break;
    case MoveTarget.RANDOM_NEAR_ENEMY:
      set = [opponents[user.randBattleSeedInt(opponents.length)]];
      break;
    case MoveTarget.ATTACKER:
      // TODO: Remove MoveTarget.ATTACKER and BattlerIndex.ATTACKER
      return { targets: [BattlerIndex.ATTACKER], multiple: false };
    case MoveTarget.NEAR_ALLY:
    case MoveTarget.ALLY:
      set = allies;
      break;
    case MoveTarget.USER_OR_NEAR_ALLY:
    case MoveTarget.USER_AND_ALLIES:
    case MoveTarget.USER_SIDE:
      set = [user, ...allies];
      multiple = moveTarget !== MoveTarget.USER_OR_NEAR_ALLY;
      break;
    case MoveTarget.ALL:
    case MoveTarget.BOTH_SIDES:
      set = [user, ...allies].concat(opponents);
      multiple = true;
      break;
  }

  set = applyTripleAdjacency(user, allMoves[move], moveTarget, set);

  let alive = set.filter(p => p?.isActive(true));
  // Triple: a SINGLE-target "other" move (foe OR ally selectable) must not fall back to an ALLY
  // when every REACHABLE foe has fainted but the wave continues via a non-adjacent foe. A triple
  // wing whose two adjacent foes both died would otherwise auto-target the adjacent ally (its only
  // remaining valid target). With no live foe in reach the move targets foes (all dead) and FAILS,
  // matching mainline - it never auto-hits your own side. While any reachable foe is alive the ally
  // stays selectable (the normal manual pick), and a SPREAD ALL_OTHERS move (Earthquake) still hits
  // allies, so only the single-target NEAR_OTHER/OTHER categories are pruned.
  if (
    (moveTarget === MoveTarget.NEAR_OTHER || moveTarget === MoveTarget.OTHER)
    && !alive.some(p => opponents.includes(p))
  ) {
    alive = alive.filter(p => opponents.includes(p));
  }

  return {
    targets: alive.map(p => p.getBattlerIndex()).filter(t => t !== undefined),
    multiple,
  };
}

/**
 * MoveTargets whose reach is restricted by POSITIONAL ADJACENCY in triples (the "near"
 * categories). In a triple a wing only reaches the foe opposite it + the centre, NOT the
 * far diagonal; the centre reaches everything. Non-`NEAR_` categories (ALL_ENEMIES, the
 * whole-own-side buffs, etc.) ignore adjacency.
 */
const NEAR_TARGETS: ReadonlySet<MoveTarget> = new Set([
  MoveTarget.NEAR_OTHER,
  MoveTarget.ALL_NEAR_OTHERS,
  MoveTarget.NEAR_ENEMY,
  MoveTarget.ALL_NEAR_ENEMIES,
  MoveTarget.NEAR_ALLY,
  MoveTarget.USER_OR_NEAR_ALLY,
]);

/**
 * Filter a `NEAR_*` move's candidate set down to the battlers the user can actually REACH
 * given the format's adjacency, unless the move bypasses adjacency. Two bypass classes
 * (matching the mainline triple rules): FLYING-type attacks and PULSE moves (Dark/Water/
 * Dragon Pulse, Aura Sphere) can hit anyone on the field. The user itself is always kept.
 *
 * Binary battles are unaffected: every pair is mutually adjacent, so nothing is removed.
 */
function applyTripleAdjacency(user: Pokemon, move: Move, moveTarget: MoveTarget, set: Pokemon[]): Pokemon[] {
  const arrangement = globalScene.currentBattle?.arrangement;
  if (!arrangement || !NEAR_TARGETS.has(moveTarget)) {
    return set;
  }
  // Bypass: flying-type + pulse moves reach the whole field regardless of position.
  if (move.type === PokemonType.FLYING || move.hasFlag(MoveFlags.PULSE_MOVE)) {
    return set;
  }
  const userId = effectiveBattlerId(user);
  return set.filter(p => p === user || arrangement.isAdjacent(userId, effectiveBattlerId(p)));
}

/**
 * The battler's position for ADJACENCY purposes. A mon that is the ONLY active mon left
 * on its side has been visually recentered (the faint-phase / summon recenter), so
 * adjacency must treat it as the CENTER slot too - otherwise a triple that collapses to
 * lone-vs-lone in opposite wings can never end: neither side can target the other (the
 * "one pokemon left and you can't hit it" report). Everyone else keeps their slot id.
 */
export function effectiveBattlerId(pokemon: Pokemon): BattlerId {
  const arrangement = globalScene.currentBattle.arrangement;
  const id = arrangement.locate(pokemon.getBattlerIndex());
  if (id.side < 0) {
    return id;
  }
  const sideField = pokemon.isPlayer() ? globalScene.getPlayerField() : globalScene.getEnemyField();
  const active = sideField.filter(p => p.isActive(true));
  if (active.length === 1 && active[0] === pokemon) {
    return { side: id.side, position: Math.floor((arrangement.capacityOf(id.side) - 1) / 2) };
  }
  return id;
}

export const frenzyMissFunc: UserMoveConditionFunc = (user: Pokemon, move: Move) => {
  while (user.getMoveQueue().length > 0 && user.getMoveQueue()[0].move === move.id) {
    user.getMoveQueue().shift();
  }
  user.removeTag(BattlerTagType.FRENZY); // FRENZY tag should be disrupted on miss/no effect

  return true;
};

/**
 * Determine the target for the `user`'s counter-attack move
 * @param user - The pokemon using the counter-like move
 * @param damageCategory - The category of move to counter (physical or special), or `undefined` to counter both
 * @returns - The battler index of the most recent, non-ally attacker using a move that matches the specified category, or `null` if no such attacker exists
 */
export function getCounterAttackTarget(user: Pokemon, damageCategory?: MoveDamageCategory): BattlerIndex | null {
  for (const attackRecord of user.turnData.attacksReceived) {
    // check if the attacker was an ally
    const moveCategory = allMoves[attackRecord.move].category;
    const sourceBattlerIndex = attackRecord.sourceBattlerIndex;
    if (
      moveCategory !== MoveCategory.STATUS
      && !areAllies(sourceBattlerIndex, user.getBattlerIndex())
      && (damageCategory === undefined || moveCategory === damageCategory)
    ) {
      return sourceBattlerIndex;
    }
  }
  return null;
}

/**
 * Determine whether the move's {@linkcode Move#moveTarget | target} can target an opponent
 * @param move - The move to check
 * @returns Whether the move can target an opponent
 */
export function mayTargetOpponent(move: Move): boolean {
  switch (move.moveTarget) {
    case MoveTarget.NEAR_ENEMY:
    case MoveTarget.ALL_NEAR_ENEMIES:
    case MoveTarget.ALL_ENEMIES:
    case MoveTarget.ENEMY_SIDE:
    case MoveTarget.RANDOM_NEAR_ENEMY:
    case MoveTarget.ATTACKER:
      return true;
  }
  return false;
}

/**
 * @returns Whether the move is instantly charged by the given weather
 * @param move - The move to check
 * @param weather - The weather to check
 */
export function isWeatherInstantCharge(move: Move, weather: WeatherType): boolean {
  return !!move.findAttr(attr => attr.is("WeatherInstantChargeAttr") && attr.weatherTypes.includes(weather));
}
