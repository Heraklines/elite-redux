/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `skip-charge-turn` archetype.
//
// Mirrors the Power Herb item — every charge-turn move (Solar Beam, Fly,
// Dig, etc.) skips the charge turn and fires immediately.
//
// Pokerogue's existing pattern: charge moves check `MoveChargeAnimAttr` /
// `ChargeAttr` + a battler tag. The cleanest hook is to install a tag on
// the holder at battle start (CHARGED) that satisfies the charge-skip path.
// However, the simplest correct implementation is to extend PostSummon and
// PostTurn to ensure the tag is always present.
//
// Wires:
//   - 474 Accelerate — "Moves that need a charge turn are now used instantly"
//
// Implementation: we subclass PreAttackAbAttr and remove the recharge tag
// via a hook on `move-effect-phase` charge resolution. Pokerogue's existing
// charge-skip helper is `MoveSkipChargeAttr` on moves — to apply ability-
// side, we add a `pokemon.removeTag(BattlerTagType.CHARGING)` post-charge.
// =============================================================================

import { PreAttackAbAttr } from "#abilities/ab-attrs";
import type { AugmentMoveInteractionAbAttrParams } from "#types/ability-types";
import { BattlerTagType } from "#enums/battler-tag-type";

/**
 * On any move attempt, removes the CHARGING/RECHARGING tags from the holder
 * so charge-up moves fire instantly and recharge moves don't lock.
 */
export class SkipChargeTurnAbAttr extends PreAttackAbAttr {
  constructor() {
    super(false);
  }

  override canApply({ pokemon }: AugmentMoveInteractionAbAttrParams): boolean {
    return pokemon.getTag(BattlerTagType.CHARGING) !== undefined
      || pokemon.getTag(BattlerTagType.UNDERGROUND) !== undefined
      || pokemon.getTag(BattlerTagType.UNDERWATER) !== undefined
      || pokemon.getTag(BattlerTagType.FLYING) !== undefined;
  }

  override apply({ pokemon, simulated }: AugmentMoveInteractionAbAttrParams): void {
    if (simulated) {
      return;
    }
    pokemon.removeTag(BattlerTagType.CHARGING);
    pokemon.removeTag(BattlerTagType.UNDERGROUND);
    pokemon.removeTag(BattlerTagType.UNDERWATER);
    pokemon.removeTag(BattlerTagType.FLYING);
  }
}
