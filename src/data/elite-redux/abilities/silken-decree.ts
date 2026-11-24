/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PostTurnAbAttr } from "#abilities/ab-attrs";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import type { Pokemon } from "#field/pokemon";

export const ER_SILKEN_DECREE_ABILITY_ID = 5900;

function usableMoveCount(pokemon: Pokemon): number {
  return new Set(
    pokemon
      .getMoveset()
      .filter(move => move.moveId !== MoveId.NONE && !move.isOutOfPp())
      .map(move => move.moveId),
  ).size;
}

/** Turns the seal lasts (1 = the foe's next move selection only). */
export const SILKEN_DECREE_TURNS = 1;

export function applySilkenDecreeToOpponents(pokemon: Pokemon, turns: number = SILKEN_DECREE_TURNS): boolean {
  let applied = false;
  for (const opponent of pokemon.getOpponents()) {
    if (!opponent || opponent.isFainted() || usableMoveCount(opponent) <= 1) {
      continue;
    }
    applied = opponent.addTag(BattlerTagType.ER_SILKEN_DECREE, turns, undefined, pokemon.id) || applied;
  }
  return applied;
}

export class SilkenDecreeAbAttr extends PostTurnAbAttr {
  /** Turns the seal lasts (ability studio param; the default is the original 1). */
  public readonly turns: number;

  constructor(turns: number = SILKEN_DECREE_TURNS) {
    super(true);
    this.turns = turns;
  }

  override canApply({ pokemon }: { pokemon: Pokemon }): boolean {
    return pokemon
      .getOpponents()
      .some(opponent => !!opponent && !opponent.isFainted() && usableMoveCount(opponent) > 1);
  }

  override apply({ pokemon, simulated }: { pokemon: Pokemon; simulated?: boolean }): void {
    if (!simulated) {
      applySilkenDecreeToOpponents(pokemon, this.turns);
    }
  }
}
