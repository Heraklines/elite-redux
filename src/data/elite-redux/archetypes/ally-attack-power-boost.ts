/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `ally-attack-power-boost` archetype.
//
// An ally-damage aura: boosts the power of the HOLDER'S ALLY'S damaging moves.
// Mirrors the vanilla Power Spot / Battery mechanic — `move.ts` queries the
// move source's ally for `AllyMoveCategoryPowerBoostAbAttr` and applies it to
// the source's move power — but allows a different multiplier for recoil moves.
//
// Wires:
//   - 672 Mosh Pit — "Ally's attacks get a 1.25x boost. 1.5x if the attack
//     causes recoil." (base 1.25, recoil 1.5)
// =============================================================================

import { AllyMoveCategoryPowerBoostAbAttr } from "#abilities/ab-attrs";
import { MoveCategory } from "#enums/move-category";

export interface AllyAttackPowerBoostOptions {
  /** Multiplier applied to an ally's damaging moves by default. */
  readonly baseMultiplier: number;
  /** Multiplier applied instead when the ally's move deals recoil. */
  readonly recoilMultiplier: number;
}

/**
 * Boosts an ally's physical/special move power. The boost is applied through
 * the same `move.ts` path as Power Spot (`applyAbAttrs("AllyMoveCategoryPower\
 * BoostAbAttr", { pokemon: ally })`), so this subclass is matched by that
 * dispatch string via `instanceof` and needs no separate registration.
 */
export class AllyAttackPowerBoostAbAttr extends AllyMoveCategoryPowerBoostAbAttr {
  private readonly baseMultiplier: number;
  private readonly recoilMultiplier: number;

  constructor(options: AllyAttackPowerBoostOptions) {
    // The parent stores a category gate ([PHYSICAL, SPECIAL]); the multiplier
    // it stores is unused because we override `apply` to pick per-move.
    super([MoveCategory.PHYSICAL, MoveCategory.SPECIAL], options.baseMultiplier);
    this.baseMultiplier = options.baseMultiplier;
    this.recoilMultiplier = options.recoilMultiplier;
  }

  override apply(params: Parameters<AllyMoveCategoryPowerBoostAbAttr["apply"]>[0]): void {
    const { move, power } = params;
    // Status moves have no power to scale; only boost the ally's attacks.
    if (move.category === MoveCategory.STATUS) {
      return;
    }
    power.value *= move.hasAttr("RecoilAttr") ? this.recoilMultiplier : this.baseMultiplier;
  }
}
