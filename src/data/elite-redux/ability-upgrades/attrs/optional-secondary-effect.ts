/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  IgnoreMoveEffectsAbAttr,
  type ModifyMoveEffectChanceAbAttrParams,
  UserFieldIgnoreMoveEffectsAbAttr,
} from "#abilities/ab-attrs";

function isOptionalEffectChance(chance: number): boolean {
  return chance > 0 && chance < 100;
}

export class IgnoreOptionalMoveEffectsAbAttr extends IgnoreMoveEffectsAbAttr {
  override canApply({ chance }: ModifyMoveEffectChanceAbAttrParams): boolean {
    return isOptionalEffectChance(chance.value);
  }
}

export class UserFieldIgnoreOptionalMoveEffectsAbAttr extends UserFieldIgnoreMoveEffectsAbAttr {
  override canApply({ chance }: ModifyMoveEffectChanceAbAttrParams): boolean {
    return isOptionalEffectChance(chance.value);
  }
}
