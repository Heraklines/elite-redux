/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — charge-stacking trio (Batch 3, items 9-11).
//
// GENERAL abilities (work on ANY holder). They reuse the CHARGE STACK primitive
// (`charge-stack.ts`) — a generalization of vanilla CHARGED (the one-use
// 2x-Electric TypeBoostTag) into a counter this holder alone stacks to 4.
//
//   9. Capacitor Bank — charge stacks to 4. GAINS (locked defaults): +1 when the
//      holder lands an attack, +1 when the holder is hit by a damaging move, and
//      the holder ABSORBS Electric moves (immune, no damage) for +1 while also
//      REDIRECTING ally-targeted Electric moves to itself (Lightning-Rod style)
//      in doubles. Multi-hit moves grant only one stack per move. Electric moves
//      the holder USES consume ONE stack each (see the move-effect-phase hook).
//  10. Fault Current — at the end of every SECOND full turn the holder stays
//      active (counter resets on switch-out) it discharges ALL stacks as a
//      spread Electric attack on every opponent, 15 BP per consumed stack
//      (0 stacks = no discharge).
//  11. Overloaded — while at EXACTLY 4 stacks: the holder's Electric moves gain
//      +25% power and +1 priority; the holder cannot voluntarily switch out; and
//      if it ENDS a turn still at 4 stacks it loses 1/8 max HP.
//
// Locked per maintainer discussion; the CHARGED reuse + the specific gain/spend
// rules are documented in the batch report.
// =============================================================================

import {
  ChangeMovePriorityAbAttr,
  PostDefendAbAttr,
  type PostMoveInteractionAbAttrParams,
  PostTurnAbAttr,
  TypeImmunityAbAttr,
  VariableMovePowerAbAttr,
} from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { scriptedPokemonMove } from "#data/elite-redux/archetypes/scripted-move-util";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import type {
  AbAttrBaseParams,
  PreAttackModifyPowerAbAttrParams,
  TypeMultiplierAbAttrParams,
} from "#types/ability-types";
import type { DamageResult } from "#types/damage-result";
import {
  addCharge,
  CHARGE_STACK_MAX,
  clearCharge,
  consumeCharge,
  getCharge,
  incrementActiveTurns,
} from "./charge-stack";

export const ER_CAPACITOR_BANK_ABILITY_ID = 5925;
export const ER_FAULT_CURRENT_ABILITY_ID = 5926;
export const ER_OVERLOADED_ABILITY_ID = 5927;

/** BP granted per consumed stack by the Fault Current discharge. */
export const FAULT_CURRENT_BP_PER_STACK = 15;
/** Fault Current discharges once every this many active turns. */
export const FAULT_CURRENT_PERIOD = 2;
/** Overloaded's electric power multiplier / priority bump / end-of-turn chip. */
export const OVERLOADED_POWER_MULTIPLIER = 1.25;
export const OVERLOADED_PRIORITY_BONUS = 1;
export const OVERLOADED_CHIP_FRACTION = 1 / 8;

/** Whether `pokemon` carries an unsuppressed ability whose attr constructor name is `name`. */
function carriesAttr(pokemon: Pokemon, name: string): boolean {
  return pokemon.getAllActiveAbilityAttrs().some(a => a?.constructor?.name === name);
}

/** Whether `pokemon` is a Capacitor Bank holder (its charge stacks). */
function isCapacitorHolder(pokemon: Pokemon): boolean {
  return carriesAttr(pokemon, "CapacitorBankGainAbAttr");
}

/** Once-per-move guards, keyed by holder → last-handled move token. */
const LAST_ATTACK_TOKEN = new WeakMap<Pokemon, string>();
const LAST_DEFEND_TOKEN = new WeakMap<Pokemon, string>();

function turnStamp(): string {
  const b = globalScene.currentBattle;
  return `${b?.waveIndex ?? 0}:${b?.turn ?? 0}`;
}

// --- 9. Capacitor Bank -------------------------------------------------------

/**
 * Gains a charge stack when the holder LANDS a damaging attack (once per move,
 * so a multi-hit move grants one). Also the marker used for holder detection.
 */
export class CapacitorBankGainAbAttr extends PostDefendAbAttr {
  // Reuse PostDefend's shape but drive it from the ATTACK side via a dedicated
  // apply hook is awkward; instead this class is the DEFEND-side gain (holder is
  // hit) and the marker. The ATTACK-side gain is `erCapacitorBankOnAttack`,
  // called from the batch3 dispatcher path.
  override canApply({ pokemon, opponent, move, damage, hitResult }: PostMoveInteractionAbAttrParams): boolean {
    if (move.category === MoveCategory.STATUS || damage <= 0) {
      return false;
    }
    if (hitResult === HitResult.NO_EFFECT || hitResult === HitResult.IMMUNE) {
      return false;
    }
    if (getCharge(pokemon) >= CHARGE_STACK_MAX) {
      return false;
    }
    // Once per incoming move (dedupe multi-hit from the same attacker's move).
    return LAST_DEFEND_TOKEN.get(pokemon) !== defendToken(opponent, move);
  }

  override apply({ pokemon, opponent, move, simulated }: PostMoveInteractionAbAttrParams): void {
    if (simulated) {
      return;
    }
    LAST_DEFEND_TOKEN.set(pokemon, defendToken(opponent, move));
    addCharge(pokemon);
  }
}

/** Stable per-incoming-move token: turn + attacker + move (dedupes multi-hit). */
function defendToken(attacker: Pokemon, move: Move): string {
  return `${turnStamp()}:${attacker.id}:${move.id}`;
}

/**
 * ATTACK-side gain: +1 stack when the Capacitor Bank `attacker` lands a damaging
 * hit (once per move). Called from the batch3 on-hit dispatcher.
 */
export function erCapacitorBankOnAttack(attacker: Pokemon, move: Move, damaging: boolean): void {
  if (!damaging || !isCapacitorHolder(attacker) || getCharge(attacker) >= CHARGE_STACK_MAX) {
    return;
  }
  const token = `${turnStamp()}:${move.id}`;
  if (LAST_ATTACK_TOKEN.get(attacker) === token) {
    return;
  }
  LAST_ATTACK_TOKEN.set(attacker, token);
  addCharge(attacker);
}

/**
 * Absorb an incoming Electric move (immune, no damage) and gain a stack. Reuses
 * vanilla's `TypeImmunityAbAttr` (Electric) so the move-type immunity machinery
 * and the redirect (registered separately) interact exactly like Lightning Rod.
 */
export class CapacitorBankAbsorbAbAttr extends TypeImmunityAbAttr {
  constructor() {
    super(PokemonType.ELECTRIC);
  }

  override apply(params: TypeMultiplierAbAttrParams): void {
    super.apply(params); // sets typeMultiplier to 0 (immune)
    if (!params.simulated && getCharge(params.pokemon) < CHARGE_STACK_MAX) {
      addCharge(params.pokemon);
    }
  }
}

/** Consume ONE stack when the holder uses an Electric move (from move-effect-phase). */
export function erCapacitorBankConsumeOnElectricUse(user: Pokemon, move: Move): void {
  if (isCapacitorHolder(user) && user.getMoveType(move) === PokemonType.ELECTRIC && getCharge(user) > 0) {
    consumeCharge(user, 1);
  }
}

// --- 10. Fault Current -------------------------------------------------------

/** Discharge all stacks as a spread Electric attack every 2nd active turn. */
export class FaultCurrentAbAttr extends PostTurnAbAttr {
  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated || !pokemon.isActive(true)) {
      return;
    }
    const turns = incrementActiveTurns(pokemon);
    if (turns % FAULT_CURRENT_PERIOD !== 0) {
      return;
    }
    const stacks = getCharge(pokemon);
    if (stacks <= 0) {
      return;
    }
    const opponents = pokemon.getOpponents().filter(o => o?.isActive(true));
    if (opponents.length === 0) {
      return;
    }
    clearCharge(pokemon);
    // Spread Electric discharge (Discharge clone) at 15 BP per consumed stack.
    // Applied directly through the damage formula (type effectiveness included);
    // a MovePhase unshifted at end-of-turn does not execute reliably.
    const move = scriptedPokemonMove(MoveId.DISCHARGE, FAULT_CURRENT_BP_PER_STACK * stacks).getMove();
    for (const opp of opponents) {
      const { damage, result } = opp.getAttackDamage({ source: pokemon, move });
      if (damage > 0) {
        // `result` here is always a damage-dealing HitResult (guarded by damage > 0).
        opp.damageAndUpdate(damage, { source: pokemon, result: result as DamageResult });
      }
    }
  }
}

// --- 11. Overloaded ----------------------------------------------------------

/** Whether `pokemon` is an Overloaded holder currently at exactly max stacks. */
function overloadedActive(pokemon: Pokemon): boolean {
  return getCharge(pokemon) === CHARGE_STACK_MAX && carriesAttr(pokemon, "OverloadedChipAbAttr");
}

/** +25% power on the holder's Electric moves while at 4 stacks. */
export class OverloadedPowerAbAttr extends VariableMovePowerAbAttr {
  override canApply({ pokemon, move }: PreAttackModifyPowerAbAttrParams): boolean {
    return overloadedActive(pokemon) && pokemon.getMoveType(move) === PokemonType.ELECTRIC;
  }

  override apply({ power }: PreAttackModifyPowerAbAttrParams): void {
    power.value *= OVERLOADED_POWER_MULTIPLIER;
  }
}

/** +1 priority on the holder's Electric moves while at 4 stacks. */
export class OverloadedPriorityAbAttr extends ChangeMovePriorityAbAttr {
  constructor() {
    super(
      (pokemon, move) => overloadedActive(pokemon) && pokemon.getMoveType(move) === PokemonType.ELECTRIC,
      OVERLOADED_PRIORITY_BONUS,
    );
  }
}

/**
 * End-of-turn 1/8 chip while still at 4 stacks. Also the marker used by
 * `overloadedActive` / the switch-lock hook.
 */
export class OverloadedChipAbAttr extends PostTurnAbAttr {
  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated || pokemon.isFainted() || getCharge(pokemon) !== CHARGE_STACK_MAX) {
      return;
    }
    const chip = Math.max(1, Math.floor(pokemon.getMaxHp() * OVERLOADED_CHIP_FRACTION));
    pokemon.damageAndUpdate(chip, { result: HitResult.INDIRECT });
  }
}
