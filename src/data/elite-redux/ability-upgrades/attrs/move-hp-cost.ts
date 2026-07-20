/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { AbAttr } from "#abilities/ab-attrs";
import type { MoveId } from "#enums/move-id";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";

export class MoveHpCostModifierAbAttr extends AbAttr {
  private readonly moveIds: ReadonlySet<MoveId>;

  constructor(
    moveIds: readonly MoveId[],
    private readonly replacementFraction: number,
  ) {
    super(false);
    this.moveIds = new Set(moveIds);
  }

  public appliesTo(move: Move): boolean {
    return this.moveIds.has(move.id);
  }

  public getReplacementFraction(): number {
    return this.replacementFraction;
  }
}

export function getMoveHpCostFraction(pokemon: Pokemon, move: Move, baseFraction: number): number {
  let fraction = baseFraction;
  for (const attr of pokemon.getAllActiveAbilityAttrs()) {
    if (attr instanceof MoveHpCostModifierAbAttr && attr.appliesTo(move)) {
      fraction = attr.getReplacementFraction();
    }
  }
  return fraction;
}
