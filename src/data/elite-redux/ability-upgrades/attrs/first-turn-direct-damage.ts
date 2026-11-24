/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { MovePowerBoostAbAttr, type PreAttackModifyPowerAbAttrParams } from "#abilities/ab-attrs";
import { gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { MoveCategory } from "#enums/move-category";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";

/** The one test of the class: it is the holder's first turn after entering and the move is not a status move. */
function isFirstTurnDamagingMove(pokemon: Pokemon, move: Move): boolean {
  return pokemon.tempSummonData.waveTurnCount === 1 && move.category !== MoveCategory.STATUS;
}

/** Multiplies direct move damage on the holder's first turn after entering. */
export class FirstTurnDirectDamageMultiplierAbAttr extends MovePowerBoostAbAttr {
  private readonly multiplier: number;

  constructor(multiplier: number) {
    if (!(multiplier > 0)) {
      throw new Error(`[FirstTurnDirectDamageMultiplierAbAttr] multiplier must be > 0; got ${multiplier}`);
    }
    super((pokemon, _target, move) => isFirstTurnDamagingMove(pokemon, move), multiplier, false);
    this.multiplier = multiplier;
  }

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PreAttackModifyPowerAbAttrParams) => boolean) | undefined;

  /** Tier B split (ability studio spec 3.1): the whole test is the gate; there is no guard and no residual. */
  override canApply(params: PreAttackModifyPowerAbAttrParams): boolean {
    return gatedCanApply<PreAttackModifyPowerAbAttrParams>(this, params);
  }

  /** The replaceable condition. It is the same function the constructor closure calls. */
  public gate({ pokemon, move }: PreAttackModifyPowerAbAttrParams): boolean {
    return isFirstTurnDamagingMove(pokemon, move);
  }

  public override appliesToFixedDamage(): boolean {
    return true;
  }

  public getMultiplier(): number {
    return this.multiplier;
  }
}
