/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `se-priority-bonus` archetype.
//
// PriorityModifier hook: adds +N priority to attacks that would be super-
// effective against the current target.
//
// Pokerogue's priority pipeline allows AbAttrs to alter priority via
// `MoveModifyPriorityAbAttr` / `ChangeMovePriorityAbAttr`. We mimic Gale
// Wings' shape but condition on effectiveness instead of type+HP.
//
// Wires:
//   - 828 Overzealous — "User's super-effective moves have +1 priority."
// =============================================================================

import { ChangeMovePriorityAbAttr } from "#abilities/ab-attrs";

export interface SePriorityBonusOptions {
  readonly priority: number;
}

export class SePriorityBonusAbAttr extends ChangeMovePriorityAbAttr {
  constructor(options: SePriorityBonusOptions) {
    super((user, move) => {
      // We need a target to evaluate effectiveness. Pokerogue's priority
      // change condition doesn't natively pass a target; we approximate by
      // evaluating against the first opponent and returning true if SE.
      const opp = user.getOpponents()?.[0];
      if (!opp || !move) {
        return false;
      }
      try {
        return opp.getMoveEffectiveness(user, move) >= 2;
      } catch {
        return false;
      }
    }, options.priority);
  }
}
