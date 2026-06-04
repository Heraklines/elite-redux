/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `nullify-first-n-hits` archetype.
//
// "Negates the first two instances of damage received. Moves still connect and
// secondary effects apply, but damage becomes 0." Implemented as a PreDefend
// damage modifier: the first N damage instances the holder would take are set
// to 0; a per-holder Symbol counts how many have been consumed.
//
// Wires:
//   - 427 Cheating Death — "Gets no damage for the first two hits." (n = 2)
// =============================================================================

import { type PreDefendModifyDamageAbAttrParams, ReceivedMoveDamageMultiplierAbAttr } from "#abilities/ab-attrs";
import type { Pokemon } from "#field/pokemon";

const USED = Symbol("NullifyFirstNHits.used");

export class NullifyFirstNHitsAbAttr extends ReceivedMoveDamageMultiplierAbAttr {
  private readonly n: number;

  constructor(n = 2) {
    // Multiplier is unused (apply is overridden); condition always passes.
    super(() => true, 0);
    this.n = n;
  }

  override canApply({ pokemon, damage }: PreDefendModifyDamageAbAttrParams): boolean {
    return damage.value > 0 && this.used(pokemon) < this.n;
  }

  override apply({ pokemon, damage, simulated }: PreDefendModifyDamageAbAttrParams): void {
    if (simulated) {
      // Still report 0 damage for previews, but don't consume a charge.
      damage.value = 0;
      return;
    }
    (pokemon as unknown as Record<symbol, number>)[USED] = this.used(pokemon) + 1;
    damage.value = 0;
  }

  /** Test helper: number of negated hits consumed so far. */
  public used(pokemon: Pokemon): number {
    return (pokemon as unknown as Record<symbol, number>)[USED] ?? 0;
  }

  /** Test helper: how many incoming damage instances this negates. */
  public getN(): number {
    return this.n;
  }
}
