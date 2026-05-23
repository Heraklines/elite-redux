/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `stab-suppress-aura` archetype.
//
// Field-wide STAB suppressor: any pokemon on the field other than the
// holder receives 1/1.5 ≈ 0.667x damage on STAB moves to neutralize the
// 1.5x boost. Hook via MovePowerBoost on attacker side with negative
// condition: "attacker is not the holder AND move type ∈ attacker.types".
//
// Wires:
//   - 866 Relic Stone — "Other battlers don't benefit from STAB."
// =============================================================================

import { MovePowerBoostAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";

export class StabSuppressAuraAbAttr extends MovePowerBoostAbAttr {
  constructor() {
    super(() => true, 1);
  }

  override apply(params: Parameters<MovePowerBoostAbAttr["apply"]>[0]): void {
    const { pokemon, move, power } = params;
    // Find the holder (any pokemon on field with this ability instance).
    // Cheap heuristic: scan all on-field pokemon; if one of them is NOT this
    // attacker AND has the ability marker, we apply the suppression.
    const field = globalScene.getField().filter(p => p && !p.isFainted());
    const holderPresent = field.some(p => p !== pokemon
      && (p.hasAbility(pokemon.getAbility().id) || p.getPassiveAbility().id === pokemon.getAbility().id));
    if (!holderPresent) {
      return;
    }
    const userTypes = pokemon.getTypes(true);
    const moveType = pokemon.getMoveType(move);
    if (userTypes.includes(moveType)) {
      power.value *= 1 / 1.5;
    }
  }
}
