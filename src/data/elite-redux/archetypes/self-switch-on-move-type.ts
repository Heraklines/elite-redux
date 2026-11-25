/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `self-switch-on-move-type` archetype.
//
// After the holder lands a damaging move of a configured type, it switches out
// (U-turn-style), via the vanilla ForceSwitchOutHelper.
//
// Wires:
//   - 979 Hollow Ice Zone — "Ice-type moves apply Ice Statue and then make the
//     user switch." (paired with the ER_FROSTBITE-on-attack tag)
// =============================================================================

import { ForceSwitchOutHelper, PostAttackAbAttr, type PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import { gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { HitResult } from "#enums/hit-result";
import type { PokemonType } from "#enums/pokemon-type";
import { SwitchType } from "#enums/switch-type";

export class SelfSwitchOnMoveTypeAbAttr extends PostAttackAbAttr {
  private readonly moveType: PokemonType;
  private readonly helper = new ForceSwitchOutHelper(SwitchType.SWITCH);

  constructor(moveType: PokemonType) {
    super();
    this.moveType = moveType;
  }

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  /**
   * Tier B split (ability studio spec 3.1) in the ORIGINAL clause order:
   * `guards` (not a preview), then `gate` (a damaging move of the configured type), then `residual` (the hit connected and
   * this was the final hit).
   */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  /** Stays in front of the gate: nothing happens in a preview. */
  public guards(params: PostMoveInteractionAbAttrParams): boolean {
    return !params.simulated;
  }

  /** The replaceable conditions: the move is a damaging move (the parent test) and it is of the configured type. */
  public gate(params: PostMoveInteractionAbAttrParams): boolean {
    const { pokemon, move } = params;
    return super.canApply(params) && pokemon.getMoveType(move) === this.moveType;
  }

  /**
   * Stays in the class (feasibility): only after a hit that actually connected, and only on the final hit of a multi-hit
   * move.
   */
  public residual(params: PostMoveInteractionAbAttrParams): boolean {
    const { pokemon, hitResult } = params;
    return hitResult < HitResult.NO_EFFECT && pokemon.turnData.hitsLeft <= 1;
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    this.helper.switchOutLogic(params.pokemon);
  }
}
