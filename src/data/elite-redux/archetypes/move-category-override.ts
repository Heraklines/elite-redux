/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `move-category-override` archetype.
//
// Ability that makes the holder's matching moves change DAMAGE CATEGORY (the
// ability-side analogue of a `VariableMoveCategoryAttr` such as Psyshock). When
// a flagged move flips PHYSICAL -> SPECIAL, the whole damage formula follows:
// the offensive stat becomes Sp.Atk, the defensive stat becomes the target's
// Sp.Def, burn's Attack halving no longer applies, and Light Screen (not
// Reflect) is the relevant screen. i.e. the move is treated FULLY special.
//
// Consumed by `Pokemon.getAttackDamage` via a by-name scan of the attacker's
// ability/passive attrs (registration-free, like AttackStatSubstituteAbAttr).
//
// Wires:
//   - 505 Mystic Blades — Keen Edge (slicing) moves become SPECIAL.
// =============================================================================

import { AbAttr } from "#abilities/ab-attrs";
import type { MoveCategory } from "#enums/move-category";
import type { MoveFlags } from "#enums/move-flags";
import type { Move } from "#moves/move";

export interface MoveCategoryOverrideOptions {
  /** Only override for moves carrying this flag (e.g. `MoveFlags.SLICING_MOVE`). */
  readonly flag: MoveFlags;
  /** The damage category to force the flagged move into. */
  readonly category: MoveCategory;
}

export class MoveCategoryOverrideAbAttr extends AbAttr {
  private readonly flag: MoveFlags;
  private readonly category: MoveCategory;

  constructor(options: MoveCategoryOverrideOptions) {
    super(false);
    this.flag = options.flag;
    this.category = options.category;
  }

  /**
   * The damage category to force for the given move, or `null` when this
   * ability does not override the move's category.
   */
  public resolveCategory(move: Move): MoveCategory | null {
    return move.hasFlag(this.flag) ? this.category : null;
  }
}
