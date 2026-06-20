/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PostAttackAbAttr, type PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import { BattlerTagType } from "#enums/battler-tag-type";
import type { NumberHolder } from "#utils/common";

export class AbsorbantAbAttr extends PostAttackAbAttr {
  constructor() {
    super((_user, _target, move) => move.hasAttr("HitHealAttr"), false);
  }

  public fire(multiplier: NumberHolder): void {
    multiplier.value *= 1.5;
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return (
      super.canApply(params)
      && !params.opponent.hasAbilityWithAttr("IgnoreMoveEffectsAbAttr")
      && params.opponent.canAddTag(BattlerTagType.SEEDED)
    );
  }

  override apply({ pokemon, opponent, simulated }: PostMoveInteractionAbAttrParams): void {
    if (!simulated) {
      opponent.addTag(BattlerTagType.SEEDED, 0, undefined, pokemon.id);
    }
  }
}
