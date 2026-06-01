/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `set-target-ability-on-move` archetype.
//
// When the holder lands a configured move, the target's ability is replaced
// (Entrainment-style, via setTempAbility). Used by ER move-rewrite abilities
// whose signature effect is forcing an ability onto the target.
//
// Wires:
//   - 830 Temporal Rupture — "Roar of Time ... changes the target's Ability to
//     Slow Start." (moveId ROAR_OF_TIME → set SLOW_START)
//
// Note: the accompanying Roar-of-Time stat tweaks (100 BP / +0 priority / no
// recharge) are move-data overrides handled in the move layer; this attr
// implements the distinctive ability-setting rider.
// =============================================================================

import { PostAttackAbAttr, type PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import { allAbilities } from "#data/data-lists";
import type { AbilityId } from "#enums/ability-id";
import { HitResult } from "#enums/hit-result";
import type { MoveId } from "#enums/move-id";

export class SetTargetAbilityOnMoveAbAttr extends PostAttackAbAttr {
  private readonly moveId: MoveId;
  private readonly abilityId: AbilityId;

  constructor(moveId: MoveId, abilityId: AbilityId) {
    super();
    this.moveId = moveId;
    this.abilityId = abilityId;
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { move, opponent: target, hitResult, simulated } = params;
    return (
      !simulated
      && move.id === this.moveId
      && hitResult < HitResult.NO_EFFECT
      && !!target
      && !target.isFainted() // Don't re-apply if the target already has the ability.
      && target.getAbility().id !== this.abilityId
    );
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    params.opponent.setTempAbility(allAbilities[this.abilityId]);
  }
}
