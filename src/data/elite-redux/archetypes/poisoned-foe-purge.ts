/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `poisoned-foe-purge` archetype.
//
// "When the user poisons a Pokemon, the poisoned target is cleared of all stat
// raises and they are unable to heal through any means."
//
// Implemented as a PostAttack hook: after the holder's move resolves, any
// opposing target that is currently poisoned (POISON or TOXIC) has all of its
// positive stat stages reset to 0 and is given HEAL_BLOCK. Re-checking on every
// attack keeps the heal-block refreshed for as long as the foe stays poisoned.
//
// Wires:
//   - 782 Hemolysis — "Poisoned foes lose all stat buffs and can't heal."
// =============================================================================

import { PostAttackAbAttr, type PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BATTLE_STATS } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";

export class PoisonedFoePurgeAbAttr extends PostAttackAbAttr implements GatedAttr<PostMoveInteractionAbAttrParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  /**
   * Tier B split (ability studio spec 3.1): the whole old `canApply` is the `gate` (the target is poisoned). There
   * is no `guards`, `prepare` or `residual`. The parent's own damaging-move test was never called here and still is not.
   */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  /** The replaceable condition: the target has regular or bad poison. Moved verbatim from `canApply`. */
  public gate(params: PostMoveInteractionAbAttrParams): boolean {
    const status = params.opponent?.status?.effect;
    return status === StatusEffect.POISON || status === StatusEffect.TOXIC;
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    const { opponent, simulated } = params;
    if (simulated || !opponent) {
      return;
    }
    // Clear all stat RAISES (positive stages only).
    for (const stat of BATTLE_STATS) {
      if (opponent.getStatStage(stat) > 0) {
        opponent.setStatStage(stat, 0);
      }
    }
    // Lock out healing.
    if (!opponent.getTag(BattlerTagType.HEAL_BLOCK)) {
      opponent.addTag(BattlerTagType.HEAL_BLOCK);
    }
  }
}
