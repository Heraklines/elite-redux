/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `time-limited-damage-reduction` archetype.
//
// PreDefend hook that resists incoming attacks for the FIRST N TURNS after
// the holder enters battle. Tracked via `pokemon.summonData.tags` —
// specifically, we rely on `tempSummonData.turnCount` (resets on switch)
// to determine "how many turns since entry."
//
// Wires:
//   - 773 Soothsayer — "Resists all attacks for three turns on first entry"
//     (factor 0.5 for first 3 turns).
// =============================================================================

import { ReceivedMoveDamageMultiplierAbAttr } from "#abilities/ab-attrs";
import type { PreDefendModifyDamageAbAttrParams } from "#types/ability-types";

export interface TimeLimitedDamageReductionOptions {
  /** Damage multiplier applied to attacks for the first `turns` turns. */
  readonly factor: number;
  /** Number of turns from entry the reduction stays active. */
  readonly turns: number;
}

export class TimeLimitedDamageReductionAbAttr extends ReceivedMoveDamageMultiplierAbAttr {
  private readonly turns: number;

  constructor(options: TimeLimitedDamageReductionOptions) {
    if (options.turns <= 0) {
      throw new Error("[TimeLimitedDamageReductionAbAttr] turns must be positive");
    }
    super((_target, _user, _move) => true, options.factor);
    this.turns = options.turns;
  }

  override canApply(params: PreDefendModifyDamageAbAttrParams): boolean {
    if (!super.canApply(params)) {
      return false;
    }
    const turnsSinceEntry = params.pokemon.tempSummonData?.turnCount ?? 0;
    return turnsSinceEntry < this.turns;
  }
}
