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

export function applySilkenDecreeToOpponents(pokemon: Pokemon): boolean {
  let applied = false;
  for (const opponent of pokemon.getOpponents()) {
    if (!opponent || opponent.isFainted() || usableMoveCount(opponent) <= 1) {
      continue;
    }
    applied = opponent.addTag(BattlerTagType.ER_SILKEN_DECREE, 1, undefined, pokemon.id) || applied;
  }
  return applied;
}

export class SilkenDecreeAbAttr extends PostTurnAbAttr {
  constructor() {
    super(true);
  }

  override canApply({ pokemon }: { pokemon: Pokemon }): boolean {
    return pokemon
      .getOpponents()
      .some(opponent => !!opponent && !opponent.isFainted() && usableMoveCount(opponent) > 1);
  }

  override apply({ pokemon, simulated }: { pokemon: Pokemon; simulated?: boolean }): void {
    if (!simulated) {
      applySilkenDecreeToOpponents(pokemon);
    }
  }
}
