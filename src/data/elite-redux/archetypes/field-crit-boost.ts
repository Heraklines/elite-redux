/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `field-crit-boost` archetype.
//
// A marker ability: while any holder is on the field, EVERY battler (allies and
// opponents alike) gets `bonus` crit stages. Read by `Pokemon.getCritStage`
// via a by-name field scan (registration-free), taking the max bonus present
// so multiple holders don't stack.
//
// Wires:
//   - 637 Battle Aura — "Boosts each battler's crit rate by +2." (bonus 2)
// =============================================================================

import { AbAttr } from "#abilities/ab-attrs";

export class FieldCritBoostAbAttr extends AbAttr {
  public readonly bonus: number;

  constructor(bonus: number) {
    super(false);
    this.bonus = bonus;
  }
}
