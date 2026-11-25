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
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";
import type { PokemonType } from "#enums/pokemon-type";

const USED_FLAG = Symbol("OneShotTypeBoost.used");

export interface OneShotTypeBoostOptions {
  readonly type: PokemonType;
  readonly factor: number;
}

/**
 * Power boost for the first move of `type` per battle.
 *
 * Tier B split (ability studio spec 3.1): `canApply` is `guards` (this Pokemon has not spent its one-time flag yet) and then `gate`
 * (the move's effective type is the chosen type), in the order the old `apply` tested them. The old `apply` did both tests itself
 * and the parent's `canApply` was always true, so moving them in front of `apply` changes nothing the game can see.
 */
export class OneShotTypeBoostAbAttr
  extends MovePowerBoostAbAttr
  implements GatedAttr<Parameters<MovePowerBoostAbAttr["apply"]>[0]>
{
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: Parameters<MovePowerBoostAbAttr["apply"]>[0]) => boolean) | undefined;

  constructor(private readonly opts: OneShotTypeBoostOptions) {
    super(() => true, opts.factor);
  }

  override canApply(params: Parameters<MovePowerBoostAbAttr["apply"]>[0]): boolean {
    return gatedCanApply<Parameters<MovePowerBoostAbAttr["apply"]>[0]>(this, params);
  }

  /** Rule that stays in the class: the one-time flag is not spent yet (the flag is written by the follow-up half). */
  public guards({ pokemon }: Parameters<MovePowerBoostAbAttr["apply"]>[0]): boolean {
    return !(pokemon as unknown as Record<symbol, boolean>)[USED_FLAG];
  }

  /** The replaceable condition: the move's type (after ability changes) is the chosen type. */
  public gate({ pokemon, move }: Parameters<MovePowerBoostAbAttr["apply"]>[0]): boolean {
    return pokemon.getMoveType(move) === this.opts.type;
  }

  override apply(params: Parameters<MovePowerBoostAbAttr["apply"]>[0]): void {
    params.power.value *= this.opts.factor;
  }
}

/**
 * PostAttack hook that flips the one-shot flag and removes the type.
 *
 * Tier B split: `canApply` is `guards` (flag not spent) and then `gate` (the move's effective type is the chosen type), the same
 * two tests in the same order as before; there is no `prepare` and no `residual`.
 */
export class OneShotTypeBoostFollowupAbAttr
  extends PostAttackAbAttr
  implements GatedAttr<PostMoveInteractionAbAttrParams>
{
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  constructor(private readonly opts: OneShotTypeBoostOptions) {
    super(undefined, false);
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  /** Rule that stays in the class: the one-time flag is not spent yet. */
  public guards({ pokemon }: PostMoveInteractionAbAttrParams): boolean {
    return !(pokemon as unknown as Record<symbol, boolean>)[USED_FLAG];
  }

  /** The replaceable condition: the move's type (after ability changes) is the chosen type. */
  public gate({ move, pokemon }: PostMoveInteractionAbAttrParams): boolean {
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
