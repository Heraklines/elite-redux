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
import type { PokemonAttackCondition } from "#types/ability-types";

export interface SePriorityBonusOptions {
  readonly priority: number;
}

/** The default condition: the move is super effective against the target it is judged against. */
const superEffectiveAgainstTarget: PokemonAttackCondition = (user, target, move) =>
  target != null && move != null && target.getMoveEffectiveness(user, move) >= 2;

export class SePriorityBonusAbAttr extends ChangeMovePriorityAbAttr {
  /** The condition, judged against the FIRST opposing Pokemon (see the constructor); read by the ability studio. */
  public readonly condition: PokemonAttackCondition;

  /**
   * @param options - the priority change
   * @param condition - When the bonus applies, called with the holder, the first opposing Pokemon and the move.
   *   The default is "the move is super effective against that Pokemon", so `new SePriorityBonusAbAttr({ priority })`
   *   behaves exactly as before; the ability studio hands in a replacement.
   */
  constructor(options: SePriorityBonusOptions, condition: PokemonAttackCondition = superEffectiveAgainstTarget) {
    super((user, move) => {
      // We need a target to evaluate effectiveness. Pokerogue's priority
      // change condition doesn't natively pass a target; we approximate by
      // evaluating against the first opponent and returning true if SE.
      const opp = user.getOpponents()?.[0];
      if (!opp || !move) {
        return false;
      }
      try {
        return condition(user, opp, move);
      } catch {
        return false;
      }
    }, options.priority);
    this.condition = condition;
  }
}
