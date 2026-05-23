/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `super-effective-multiplier-boost` archetype.
//
// Hooks the attacker side of the type-multiplier computation: when the
// holder is attacking AND the move would already be super-effective
// (typeMultiplier >= 2), multiply the multiplier further by `factor`.
//
// Wires:
//   - 586 Winged King — "Ups super-effective by 33%" (factor = 1.33)
//   - 588 Iron Serpent — same shape (factor = 1.33)
//
// Pokerogue evaluates PreDefend TypeMultiplier on the DEFENDER side; for
// attacker-side modulation we subclass PostAttackAbAttr / DamageBoost path
// instead. We attach to the standard MovePowerBoost path with a condition
// that checks the type effectiveness AT POWER COMPUTATION TIME.
//
// Pokerogue's `MovePowerBoostAbAttr` provides this hook — the condition
// receives (user, target, move) and can compute effectiveness.
// =============================================================================

import { MovePowerBoostAbAttr } from "#abilities/ab-attrs";

export interface SuperEffectiveMultiplierBoostOptions {
  /** Multiplier applied to power when the move is SE (typeMultiplier >= 2). */
  readonly factor: number;
}

/**
 * Boosts move power by `factor` when the move would be super-effective
 * (effective type multiplier >= 2 against the target).
 */
export class SuperEffectiveMultiplierBoostAbAttr extends MovePowerBoostAbAttr {
  constructor(options: SuperEffectiveMultiplierBoostOptions) {
    super(
      (_user, target, move) => {
        if (!target || !move) {
          return false;
        }
        try {
          const eff = target.getMoveEffectiveness(_user, move);
          return eff >= 2;
        } catch {
          return false;
        }
      },
      options.factor,
    );
  }
}
