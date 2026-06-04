/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `one-shot-type-boost-then-lose-type` archetype.
//
// MovePowerBoost on the first move of the configured type the holder uses
// per battle: 2x power. Then on PostAttack, REMOVE that type from the
// holder's type-list. One-shot per battle, tracked via tempSummonData.
//
// Wires:
//   - 1005 Power Outage — "Boosts first Electric attack by 2x then loses
//     Electric type." (type: ELECTRIC, factor: 2.)
// =============================================================================

import { MovePowerBoostAbAttr, PostAttackAbAttr } from "#abilities/ab-attrs";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";
import type { PokemonType } from "#enums/pokemon-type";

const USED_FLAG = Symbol("OneShotTypeBoost.used");

export interface OneShotTypeBoostOptions {
  readonly type: PokemonType;
  readonly factor: number;
}

/** Power boost for the first move of `type` per battle. */
export class OneShotTypeBoostAbAttr extends MovePowerBoostAbAttr {
  constructor(private readonly opts: OneShotTypeBoostOptions) {
    super(() => true, opts.factor);
  }

  override apply(params: Parameters<MovePowerBoostAbAttr["apply"]>[0]): void {
    const { pokemon, move, power } = params;
    if ((pokemon as unknown as Record<symbol, boolean>)[USED_FLAG]) {
      return;
    }
    if (pokemon.getMoveType(move) !== this.opts.type) {
      return;
    }
    power.value *= this.opts.factor;
  }
}

/** PostAttack hook that flips the one-shot flag and removes the type. */
export class OneShotTypeBoostFollowupAbAttr extends PostAttackAbAttr {
  constructor(private readonly opts: OneShotTypeBoostOptions) {
    super(undefined, false);
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { move, pokemon } = params;
    if ((pokemon as unknown as Record<symbol, boolean>)[USED_FLAG]) {
      return false;
    }
    return pokemon.getMoveType(move) === this.opts.type;
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    const { pokemon, simulated } = params;
    if (simulated) {
      return;
    }
    (pokemon as unknown as Record<symbol, boolean>)[USED_FLAG] = true;
    const types = pokemon.getTypes(true).filter(t => t !== this.opts.type);
    pokemon.summonData.types = types.length > 0 ? types : pokemon.getTypes(true);
    pokemon.updateInfo();
  }
}
