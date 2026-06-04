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
import { BattlerTagType } from "#enums/battler-tag-type";
import { BATTLE_STATS } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";

export class PoisonedFoePurgeAbAttr extends PostAttackAbAttr {
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
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
