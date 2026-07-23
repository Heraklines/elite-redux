/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { MovePowerBoostAbAttr } from "#abilities/ab-attrs";
import { MoveCategory } from "#enums/move-category";

/** Multiplies direct move damage on the holder's first turn after entering. */
export class FirstTurnDirectDamageMultiplierAbAttr extends MovePowerBoostAbAttr {
  private readonly multiplier: number;

  constructor(multiplier: number) {
    if (!(multiplier > 0)) {
      throw new Error(`[FirstTurnDirectDamageMultiplierAbAttr] multiplier must be > 0; got ${multiplier}`);
    }
    super(
      (pokemon, _target, move) => pokemon.tempSummonData.waveTurnCount === 1 && move.category !== MoveCategory.STATUS,
      multiplier,
      false,
    );
    this.multiplier = multiplier;
  }

  public override appliesToFixedDamage(): boolean {
    return true;
  }

  public getMultiplier(): number {
    return this.multiplier;
  }
}
