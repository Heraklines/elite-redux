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

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { pokemon, move, simulated, hitResult } = params;
    // Only after a damaging move of the configured type actually connected,
    // and only on the final hit of a multi-hit move.
    return (
      !simulated
      && super.canApply(params)
      && pokemon.getMoveType(move) === this.moveType
      && hitResult < HitResult.NO_EFFECT
      && pokemon.turnData.hitsLeft <= 1
    );
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    this.helper.switchOutLogic(params.pokemon);
  }
}
