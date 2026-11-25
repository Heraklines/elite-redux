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
import { gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
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

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  /**
   * Tier B split (ability studio spec 3.1) in the ORIGINAL clause order:
   * `guards` (not a preview), then `gate` (the move is the configured move), then `residual` (the hit connected, there is a
   * living target, and it does not have the ability yet).
   */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  /** Stays in front of the gate: nothing happens in a preview. */
  public guards(params: PostMoveInteractionAbAttrParams): boolean {
    return !params.simulated;
  }

  /** The replaceable condition: the move that was used is the configured move. */
  public gate(params: PostMoveInteractionAbAttrParams): boolean {
    return params.move.id === this.moveId;
  }

  /** Stays in the class (feasibility): the hit connected, a living target exists, and it does not already have the ability. */
  public residual(params: PostMoveInteractionAbAttrParams): boolean {
    const { opponent: target, hitResult } = params;
    return (
      hitResult < HitResult.NO_EFFECT
      && !!target
      && !target.isFainted() // Don't re-apply if the target already has the ability.
      && target.getAbility().id !== this.abilityId
    );
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    params.opponent.setTempAbility(allAbilities[this.abilityId]);
  }
}
