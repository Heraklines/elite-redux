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
import { gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";

function isOptionalEffectChance(chance: number): boolean {
  return chance > 0 && chance < 100;
}

export class IgnoreOptionalMoveEffectsAbAttr extends IgnoreMoveEffectsAbAttr {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: ModifyMoveEffectChanceAbAttrParams) => boolean) | undefined;

  /** Tier B split (ability studio spec 3.1): the whole original `canApply` is the replaceable gate; no guards, no residual. */
  override canApply(params: ModifyMoveEffectChanceAbAttrParams): boolean {
    return gatedCanApply<ModifyMoveEffectChanceAbAttrParams>(this, params);
  }

  /** The replaceable condition: the move's effect chance is above 0 and below 100. Moved verbatim from the old `canApply`. */
  public gate({ chance }: ModifyMoveEffectChanceAbAttrParams): boolean {
    return isOptionalEffectChance(chance.value);
  }
}

export class UserFieldIgnoreOptionalMoveEffectsAbAttr extends UserFieldIgnoreMoveEffectsAbAttr {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: ModifyMoveEffectChanceAbAttrParams) => boolean) | undefined;

  /** Tier B split (ability studio spec 3.1): the whole original `canApply` is the replaceable gate; no guards, no residual. */
  override canApply(params: ModifyMoveEffectChanceAbAttrParams): boolean {
    return gatedCanApply<ModifyMoveEffectChanceAbAttrParams>(this, params);
  }

  /** The replaceable condition: the move's effect chance is above 0 and below 100. Moved verbatim from the old `canApply`. */
  public gate({ chance }: ModifyMoveEffectChanceAbAttrParams): boolean {
    return isOptionalEffectChance(chance.value);
  }
}
