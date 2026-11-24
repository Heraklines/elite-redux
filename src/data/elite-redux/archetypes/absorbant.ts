/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PostAttackAbAttr, type PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { BattlerTagType } from "#enums/battler-tag-type";
import type { NumberHolder } from "#utils/common";

export class AbsorbantAbAttr extends PostAttackAbAttr implements GatedAttr<PostMoveInteractionAbAttrParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  constructor() {
    super((_user, _target, move) => move.hasAttr("HitHealAttr"), false);
  }

  public fire(multiplier: NumberHolder): void {
    multiplier.value *= 1.5;
  }

  /** Tier B split (ability studio spec 3.1), in the original clause order: `gate`, then `residual`. */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  /** The replaceable condition: the move drains (the parent's fixed attackCondition) and the target is not shielded from added effects. */
  public gate(params: PostMoveInteractionAbAttrParams): boolean {
    return super.canApply(params) && !params.opponent.hasAbilityWithAttr("IgnoreMoveEffectsAbAttr");
  }

  /** Feasibility that stays in the class: the target can actually receive Leech Seed. */
  public residual(params: PostMoveInteractionAbAttrParams): boolean {
    return params.opponent.canAddTag(BattlerTagType.SEEDED);
  }

  override apply({ pokemon, opponent, simulated }: PostMoveInteractionAbAttrParams): void {
    if (!simulated) {
      opponent.addTag(BattlerTagType.SEEDED, 0, undefined, pokemon.id);
    }
  }
}
