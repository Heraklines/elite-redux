/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `reflect-damage-on-defend` archetype.
//
// When the holder takes a direct hit, the attacker takes the SAME amount of
// damage back. The offensive counterpart ("user also takes the damage it
// deals") is the existing SelfDamageOnAttackAbAttr with basis "damageDealt"
// and fraction 1.0.
//
// Wires:
//   - 332 Soul Linker — "Enemies take all the damage they deal; same for this
//     Pokemon." (paired with SelfDamageOnAttack damageDealt 1.0)
// =============================================================================

import { PostDefendAbAttr, type PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import { HitResult } from "#enums/hit-result";

export class ReflectDamageOnDefendAbAttr extends PostDefendAbAttr {
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { simulated, damage, opponent: attacker, pokemon } = params;
    // Only on a direct damaging hit from a distinct attacker.
    return !simulated && damage > 0 && attacker != null && attacker !== pokemon && !attacker.isFainted();
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    const { damage, opponent: attacker } = params;
    attacker.damageAndUpdate(damage, { result: HitResult.INDIRECT, ignoreSegments: true });
  }
}
