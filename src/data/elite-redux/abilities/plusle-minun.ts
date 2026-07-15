/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Plus/Minus paralysis suite (Batch 3, items 5-8).
//
// GENERAL abilities (work on ANY holder). Alignment is ABILITY-based, never
// species-based (see `isPlusMinusAligned`): a Pokemon counts as Plus/Minus-
// aligned when its active ability set includes vanilla Plus or Minus, OR any of
// the four abilities in this suite (documented DEFAULT).
//
//   5. Synchronized Current  — (a) if the holder AND an aligned ally both deal
//      DIRECT damage to the same target in one turn, that target is paralyzed after
//      both hits resolve (normal paralysis immunities apply). Plus, alignment-
//      UNRELATED (any ally): (b) if the holder AND its ally both attack in a turn,
//      each attack gains 25% power; (c) if NEITHER attacks (both status moves),
//      both restore 1/4 max HP at end of turn.
//   6. Positive Feedback     — when the holder damages a PARALYZED target, it
//      consumes the paralysis, the attack gets +25% power, and the target's
//      HIGHER defensive stat drops one stage after damage.
//   7. Negative Feedback     — when the holder damages a PARALYZED target, it
//      consumes the paralysis, the holder gains +1 Speed, ONE of the target's held
//      items is suppressed until end of the following turn (seeded pick), and the
//      HOLDER's own next physical move is primed to become Electric/Fairy dual-
//      type (self-buff — the maintainer-final reading of the ambiguous "its").
//   8. Closed Circuit        — if the holder and an ally target the same opponent
//      in one turn, BOTH launch an extra 25 BP Electric/Fairy special attack at
//      that opponent after both primary moves resolve; if the target faints a
//      remaining extra carries over to another opponent (ErClosedCircuitBurstPhase,
//      DEFAULT special, no secondary effects, cannot crit).
//
// Same-turn coordination (Sync Current, Closed Circuit) is resolved through the
// shared turn-attack ledger; the second-actor triggers fire from the batch3
// on-hit dispatcher (`batch3-on-hit.ts`). Singles: no ally, so every coordinated
// innate is inert by design.
// =============================================================================

import { AbAttr, PostAttackAbAttr, PostTurnAbAttr, VariableMovePowerAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { Command } from "#enums/command";
import { MoveCategory } from "#enums/move-category";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import type {
  AbAttrBaseParams,
  PostMoveInteractionAbAttrParams,
  PreAttackModifyPowerAbAttrParams,
} from "#types/ability-types";
import { toDmgValue } from "#utils/common";
import { primeDualTypeMove } from "./dual-type-move";
import { suppressRandomHeldItem } from "./item-suppression";
import { allyHitTargetThisTurn } from "./turn-attack-ledger";

/** +25% multiplier when the holder and an ally both attack in one turn. */
const SYNC_CURRENT_BOTH_ATTACK_MULTIPLIER = 1.25;
/** Fraction of max HP both restore when neither the holder nor its ally attacks. */
const SYNC_CURRENT_HEAL_FRACTION = 0.25;

/**
 * The MoveCategory of `pokemon`'s selected FIGHT command this turn, or
 * `undefined` when it isn't attacking with a move (switch / ball / run / no
 * command). Read from `turnCommands` so the boost can be applied PREDICTIVELY as
 * each attack resolves (before the slower partner has actually acted).
 */
function turnCommandCategory(pokemon: Pokemon): MoveCategory | undefined {
  const cmd = globalScene.currentBattle?.turnCommands?.[pokemon.getBattlerIndex()];
  if (!cmd || cmd.command !== Command.FIGHT || cmd.move?.move === undefined) {
    return;
  }
  return allMoves[cmd.move.move]?.category;
}

/** Whether `pokemon`'s selected move this turn is a damaging (non-status) move. */
function usesDamagingMoveThisTurn(pokemon: Pokemon): boolean {
  const category = turnCommandCategory(pokemon);
  return category !== undefined && category !== MoveCategory.STATUS;
}

/**
 * Whether `pokemon` actually EXECUTED a status move this turn. Read at turn end
 * (the neither-attack heal fires from PostTurn, by which point `incrementTurn`
 * has already cleared `turnCommands`), so it uses the persistent per-turn
 * `acted` flag + the last move in history (which, given `acted`, is this turn's).
 */
function usedStatusMoveThisTurn(pokemon: Pokemon): boolean {
  if (!pokemon.turnData.acted) {
    return false;
  }
  const last = pokemon.getLastXMoves(1)[0];
  return last !== undefined && allMoves[last.move]?.category === MoveCategory.STATUS;
}

/** An active ally of `pokemon`, or `undefined` (inert in singles). */
function activeAlly(pokemon: Pokemon): Pokemon | undefined {
  return pokemon.getAllies().find(a => a?.isActive(true));
}

export const ER_SYNCHRONIZED_CURRENT_ABILITY_ID = 5921;
export const ER_POSITIVE_FEEDBACK_ABILITY_ID = 5922;
export const ER_NEGATIVE_FEEDBACK_ABILITY_ID = 5923;
export const ER_CLOSED_CIRCUIT_ABILITY_ID = 5924;

/** Power boosts / follow-up BP. */
export const POSITIVE_FEEDBACK_POWER_MULTIPLIER = 1.25;

/** The suite's abilities, by constructor name, for ability-based alignment detection. */
const SUITE_ABATTR_NAMES = new Set([
  "SynchronizedCurrentAbAttr",
  "PositiveFeedbackAbAttr",
  "NegativeFeedbackAbAttr",
  "ClosedCircuitAbAttr",
]);

/**
 * ABILITY-based Plus/Minus alignment: vanilla Plus/Minus OR any suite ability.
 * Never keys off species id (documented DEFAULT).
 */
export function isPlusMinusAligned(pokemon: Pokemon): boolean {
  if (!pokemon.isActive(true)) {
    return false;
  }
  if (pokemon.hasAbility(AbilityId.PLUS) || pokemon.hasAbility(AbilityId.MINUS)) {
    return true;
  }
  return pokemon.getAllActiveAbilityAttrs().some(a => a && SUITE_ABATTR_NAMES.has(a.constructor?.name ?? ""));
}

/** Whether `pokemon` carries an unsuppressed ability whose attr constructor name is `name`. */
function carriesAttr(pokemon: Pokemon, name: string): boolean {
  return pokemon.getAllActiveAbilityAttrs().some(a => a?.constructor?.name === name);
}

// --- 5. Synchronized Current -------------------------------------------------

/** Marker for Synchronized Current; the paralysis is applied by `erSyncCurrentOnHit`. */
export class SynchronizedCurrentAbAttr extends AbAttr {
  constructor() {
    super(false);
  }

  override apply(_params: AbAttrBaseParams): void {}
}

/**
 * When `user` deals DIRECT damage to `target`, paralyze `target` if a
 * "Synchronized Current holder + aligned ally" pair on `user`'s side has both
 * damaged `target` this turn (this hit is the second). Respects paralysis
 * immunities via `trySetStatus`.
 */
export function erSyncCurrentOnHit(user: Pokemon, target: Pokemon, damaging: boolean): void {
  if (!damaging || target.isFainted()) {
    return;
  }
  const partner = syncCurrentPartner(user, target);
  if (!partner) {
    return;
  }
  // After both hits resolve → apply paralysis (immunities honored inside trySetStatus).
  target.trySetStatus(StatusEffect.PARALYSIS, user);
}

/**
 * An active ally that, together with `user`, forms a Sync-Current pair (one end
 * carries Synchronized Current, both are aligned) and has ALREADY damaged
 * `target` this turn. Returns that ally, or `undefined`.
 */
function syncCurrentPartner(user: Pokemon, target: Pokemon): Pokemon | undefined {
  const userHasSync = carriesAttr(user, "SynchronizedCurrentAbAttr");
  const userAligned = isPlusMinusAligned(user);
  for (const ally of user.getAllies()) {
    if (!ally?.isActive(true) || !allyHitTargetThisTurn(ally, target, true)) {
      continue;
    }
    const allyHasSync = carriesAttr(ally, "SynchronizedCurrentAbAttr");
    // Pair valid when one end has Sync Current and BOTH ends are aligned.
    if (((userHasSync && isPlusMinusAligned(ally)) || (allyHasSync && userAligned)) && isPlusMinusAligned(ally)) {
      return ally;
    }
  }
  return;
}

/**
 * Synchronized Current — BOTH-ATTACK boost (alignment-UNRELATED, any ally).
 * When the holder and an active ally BOTH use a damaging move this turn, the
 * holder's attack is boosted 25%. Applied per-attack via the standard
 * variable-power hook and evaluated from the turn's SELECTED commands, so it
 * boosts the fast partner's move even before the slow partner has acted. Both
 * mons boost independently (each carries Synchronized Current), so both attacks
 * end up boosted. The two attacks need NOT share a target. Inert in singles.
 */
export class SynchronizedCurrentBothAttackPowerAbAttr extends VariableMovePowerAbAttr {
  override canApply({ pokemon, move }: PreAttackModifyPowerAbAttrParams): boolean {
    if (move.category === MoveCategory.STATUS) {
      return false;
    }
    const ally = activeAlly(pokemon);
    return ally !== undefined && usesDamagingMoveThisTurn(ally);
  }

  override apply({ power }: PreAttackModifyPowerAbAttrParams): void {
    power.value *= SYNC_CURRENT_BOTH_ATTACK_MULTIPLIER;
  }
}

/**
 * Synchronized Current — NEITHER-ATTACK heal (alignment-UNRELATED, any ally).
 * At end of turn, if the holder AND an active ally BOTH used a status move this
 * turn (i.e. neither attacked), the holder restores 1/4 of its max HP. Both mons
 * heal independently. Inert in singles.
 */
export class SynchronizedCurrentHealAbAttr extends PostTurnAbAttr {
  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    const ally = activeAlly(pokemon);
    return ally !== undefined && usedStatusMoveThisTurn(pokemon) && usedStatusMoveThisTurn(ally);
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated || pokemon.isFullHp()) {
      return;
    }
    pokemon.heal(toDmgValue(pokemon.getMaxHp() * SYNC_CURRENT_HEAL_FRACTION, 1));
  }
}

// --- 6. Positive Feedback ----------------------------------------------------

/** +25% power when the holder's move targets a PARALYZED foe. */
export class PositiveFeedbackPowerAbAttr extends VariableMovePowerAbAttr {
  override canApply({ opponent }: PreAttackModifyPowerAbAttrParams): boolean {
    return opponent?.status?.effect === StatusEffect.PARALYSIS;
  }

  override apply({ power }: PreAttackModifyPowerAbAttrParams): void {
    power.value *= POSITIVE_FEEDBACK_POWER_MULTIPLIER;
  }
}

/** Consume the target's paralysis and drop its higher defensive stat after damage. */
export class PositiveFeedbackAbAttr extends PostAttackAbAttr {
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { opponent, hitResult } = params;
    return super.canApply(params) && hitResult < 4 && opponent?.status?.effect === StatusEffect.PARALYSIS;
  }

  override apply({ opponent, simulated }: PostMoveInteractionAbAttrParams): void {
    if (simulated || !opponent) {
      return;
    }
    // Consume the paralysis (cleared immediately, not via a phase).
    opponent.resetStatus(true, false, false, false);
    // Lower the HIGHER defensive stat by one stage.
    const higherDef = opponent.getStat(Stat.DEF) >= opponent.getStat(Stat.SPDEF) ? Stat.DEF : Stat.SPDEF;
    globalScene.phaseManager.unshiftNew("StatStageChangePhase", opponent.getBattlerIndex(), false, [higherDef], -1);
  }
}

// --- 7. Negative Feedback ----------------------------------------------------

/**
 * Consume the target's paralysis; the holder gains +1 Speed, suppresses one of
 * the target's held items until end of the following turn, and primes its OWN
 * next physical move to Electric/Fairy dual-type (self-buff).
 */
export class NegativeFeedbackAbAttr extends PostAttackAbAttr {
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { opponent, hitResult } = params;
    return super.canApply(params) && hitResult < 4 && opponent?.status?.effect === StatusEffect.PARALYSIS;
  }

  override apply({ pokemon, opponent, simulated }: PostMoveInteractionAbAttrParams): void {
    if (simulated || !opponent) {
      return;
    }
    opponent.resetStatus(true, false, false, false);
    globalScene.phaseManager.unshiftNew("StatStageChangePhase", pokemon.getBattlerIndex(), true, [Stat.SPD], 1);
    // Suppress one seeded-random held item until end of the following turn.
    suppressRandomHeldItem(opponent);
    // Prime the HOLDER's own next physical move → Electric (primary) / Fairy (second).
    primeDualTypeMove(pokemon, PokemonType.ELECTRIC, PokemonType.FAIRY);
  }
}

// --- 8. Closed Circuit -------------------------------------------------------

/** Marker for Closed Circuit; the extra attack is launched by `erClosedCircuitOnHit`. */
export class ClosedCircuitAbAttr extends AbAttr {
  constructor() {
    super(false);
  }

  override apply(_params: AbAttrBaseParams): void {}
}

/** Per-turn guard so the burst fires once per pair per target per turn. */
let closedCircuitKey = "";

/**
 * When `user` completes the SECOND move of a Closed-Circuit pair aimed at
 * `target` (its partner already targeted `target` this turn), launch the extra
 * 25 BP Electric/Fairy attacks: BOTH the partner and `user` fire one, after both
 * primary moves resolve. If the shared target faints (from the primaries or the
 * first extra), the remaining extra carries over to a living opponent
 * (`ErClosedCircuitBurstPhase`). Fired from the batch3 on-hit dispatcher.
 */
export function erClosedCircuitOnHit(user: Pokemon, target: Pokemon): void {
  const partner = closedCircuitPartner(user, target);
  if (!partner) {
    return;
  }
  const battle = globalScene.currentBattle;
  const key = `${battle?.waveIndex ?? 0}:${battle?.turn ?? 0}:${Math.min(user.id, partner.id)}:${target.id}`;
  if (closedCircuitKey === key) {
    return;
  }
  closedCircuitKey = key;
  // Both mons owe an extra attack; partner (first actor) fires first, then user.
  globalScene.phaseManager.unshiftNew("ErClosedCircuitBurstPhase", [partner, user], target);
}

/**
 * An active ally forming a Closed-Circuit pair with `user` (one end carries
 * Closed Circuit) that has ALREADY targeted `target` this turn. `undefined` if
 * none — meaning `user` is not the second actor of such a pair.
 */
function closedCircuitPartner(user: Pokemon, target: Pokemon): Pokemon | undefined {
  const userHasCc = carriesAttr(user, "ClosedCircuitAbAttr");
  for (const ally of user.getAllies()) {
    if (!ally?.isActive(true) || !allyHitTargetThisTurn(ally, target)) {
      continue;
    }
    if (userHasCc || carriesAttr(ally, "ClosedCircuitAbAttr")) {
      return ally;
    }
  }
  return;
}
