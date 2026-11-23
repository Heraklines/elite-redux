/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `power-boost-on-ally-faint` archetype.
//
// "Avenger boosts the power of ALL of the holder's moves by 50% for one turn
// after any party Pokemon faints."
//
// Implemented as three cooperating attrs sharing a per-holder Symbol timer:
//   1. AllyFaintPowerBoostTriggerAbAttr (PostKnockOut, ally-only) arms the
//      timer (TURNS = 2) when a teammate is KO'd.
//   2. AllyFaintPowerBoostAbAttr (MovePowerBoost) multiplies move power by the
//      factor while the timer is active.
//   3. AllyFaintPowerBoostExpireAbAttr (PostTurn) decrements the timer each
//      turn end, so the boost survives exactly through the turn following the
//      faint.
//
// Engine note: PostKnockOut only fires for on-field holders, so (like every
// "ally faint" ER ability) this is reliable in doubles and for the
// faint-while-holder-is-out case; a benched teammate fainting can't be observed
// by the engine.
//
// Wires:
//   - 292 Avenger — "If a party Pokemon fainted last turn, next move gets 1.5x."
// =============================================================================

import {
  type AbAttrBaseParams,
  MovePowerBoostAbAttr,
  PostKnockOutAbAttr,
  type PostKnockOutAbAttrParams,
  PostTurnAbAttr,
} from "#abilities/ab-attrs";
import { gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import type { Pokemon } from "#field/pokemon";
import type { PokemonAttackCondition } from "#types/ability-types";

const TURNS = Symbol("PowerBoostOnAllyFaint.turns");

const isActive = (pokemon: Pokemon): boolean => ((pokemon as unknown as Record<symbol, number>)[TURNS] ?? 0) > 0;

export class AllyFaintPowerBoostTriggerAbAttr extends PostKnockOutAbAttr {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostKnockOutAbAttrParams) => boolean) | undefined;

  /**
   * @param turns - How many turn ticks the boost lasts once armed. The default (2: this turn's remainder plus the
   *   full following turn) is what `new AllyFaintPowerBoostTriggerAbAttr()` has always done; the ability studio sets it.
   */
  public readonly turns: number;

  constructor(turns = 2) {
    super();
    this.turns = turns;
  }

  /** Tier B split (ability studio spec 3.1): the whole rule is the gate, nothing stays behind as a residual. */
  override canApply(params: PostKnockOutAbAttrParams): boolean {
    return gatedCanApply<PostKnockOutAbAttrParams>(this, params);
  }

  /** The replaceable condition: the Pokemon that fainted is a teammate of the holder (not the holder itself). */
  public gate({ pokemon, victim }: PostKnockOutAbAttrParams): boolean {
    return victim.id !== pokemon.id && victim.isPlayer() === pokemon.isPlayer();
  }

  override apply({ pokemon, simulated }: PostKnockOutAbAttrParams): void {
    if (simulated) {
      return;
    }
    // Default 2 ticks: this turn's remainder + the full following turn.
    (pokemon as unknown as Record<symbol, number>)[TURNS] = this.turns;
  }
}

export class AllyFaintPowerBoostAbAttr extends MovePowerBoostAbAttr {
  /**
   * @param factor - the power multiplier while the boost is armed
   * @param condition - When the boost applies. The default is "the one-turn boost is armed for the attacker", so
   *   `new AllyFaintPowerBoostAbAttr(1.5)` behaves exactly as before; the ability studio hands in a replacement.
   */
  constructor(factor = 1.5, condition: PokemonAttackCondition = user => isActive(user)) {
    super(condition, factor, true);
  }
}

export class AllyFaintPowerBoostExpireAbAttr extends PostTurnAbAttr {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: AbAttrBaseParams) => boolean) | undefined;

  /** Tier B split (ability studio spec 3.1): the whole rule is the gate, nothing stays behind as a residual. */
  override canApply(params: AbAttrBaseParams): boolean {
    return gatedCanApply<AbAttrBaseParams>(this, params);
  }

  /** The replaceable condition: the holder's one-turn boost is armed. */
  public gate({ pokemon }: AbAttrBaseParams): boolean {
    return isActive(pokemon);
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const store = pokemon as unknown as Record<symbol, number>;
    store[TURNS] = Math.max(0, (store[TURNS] ?? 0) - 1);
  }

  /** Test helper: remaining boosted turns for this holder. */
  public turnsRemaining(pokemon: Pokemon): number {
    return (pokemon as unknown as Record<symbol, number>)[TURNS] ?? 0;
  }
}

/** Test helper: whether the one-turn boost is currently active for a holder. */
export const isAvengerBoostActive = isActive;
