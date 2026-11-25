/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `type-filtered-effect-chance` primitive.
//
// A Serene-Grace-style secondary-effect-chance multiplier, but restricted to
// moves of a single type. Wires Corrupted Mind 774's "all secondary effects of
// Psychic moves have their activation chance increased by 40%" (×1.4 on PSYCHIC
// moves only).
//
// Extends pokerogue's `MoveEffectChanceMultiplierAbAttr` (which rides the
// effect-chance hook and clamps to 100); we narrow `canApply` to also require
// the move's resolved type to match.
// =============================================================================

import type { ModifyMoveEffectChanceAbAttrParams } from "#abilities/ab-attrs";
import { MoveEffectChanceMultiplierAbAttr } from "#abilities/ab-attrs";
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import type { PokemonType } from "#enums/pokemon-type";

export class TypeFilteredEffectChanceMultiplierAbAttr
  extends MoveEffectChanceMultiplierAbAttr
  implements GatedAttr<ModifyMoveEffectChanceAbAttrParams>
{
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: ModifyMoveEffectChanceAbAttrParams) => boolean) | undefined;
  private readonly moveType: PokemonType;

  constructor(moveType: PokemonType, chanceMultiplier: number) {
    super(chanceMultiplier);
    this.moveType = moveType;
  }

  override canApply(params: ModifyMoveEffectChanceAbAttrParams): boolean {
    return gatedCanApply<ModifyMoveEffectChanceAbAttrParams>(this, params);
  }

  /**
   * Tier B (ability studio spec 3.1), the old `canApply` in its old order. `guards` is `super.canApply`: the move has an extra effect
   * (chance above 0) and is not Order Up or Electro Shot, which the parent has always refused.
   */
  public guards(params: ModifyMoveEffectChanceAbAttrParams): boolean {
    return super.canApply(params);
  }

  /** The replaceable condition: the move's type after other abilities changed it is the configured type. */
  public gate(params: ModifyMoveEffectChanceAbAttrParams): boolean {
    return params.pokemon.getMoveType(params.move) === this.moveType;
  }

  /** Read-only accessor for the configured move type. */
  public getMoveType(): PokemonType {
    return this.moveType;
  }
}
