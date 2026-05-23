/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `damage-cap-on-resist` archetype.
//
// PreDefend hook: when an incoming attack would faint the holder AND the
// attack is not-very-effective (typeMultiplier < 1), cap the damage at
// `currentHp - 1` so the holder survives at 1 HP. Mirrors Sturdy's
// "survive at 1 HP" but gated on NVE instead of full HP.
//
// Wires:
//   - 1000 Survivor Bias — "Not very effective moves can't cause fainting."
// =============================================================================

import { ReceivedMoveDamageMultiplierAbAttr } from "#abilities/ab-attrs";
import type { PreDefendModifyDamageAbAttrParams } from "#types/ability-types";

export class DamageCapOnResistAbAttr extends ReceivedMoveDamageMultiplierAbAttr {
  constructor() {
    super(() => true, 1);
  }

  override canApply(params: PreDefendModifyDamageAbAttrParams): boolean {
    const { pokemon, opponent, move, damage } = params;
    if (!move?.is("AttackMove")) {
      return false;
    }
    const eff = pokemon.getMoveEffectiveness(opponent, move);
    if (eff >= 1) {
      return false;
    }
    return damage.value >= pokemon.hp;
  }

  override apply(params: PreDefendModifyDamageAbAttrParams): void {
    const { pokemon, damage } = params;
    damage.value = Math.max(0, pokemon.hp - 1);
  }
}
