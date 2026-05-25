/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `first-turn-stat-multiplier` primitive.
//
// Applies a multiplicative stat boost ONLY on the holder's first turn after
// switching in. Reads `summonData.moveHistory.length === 0` as "first turn"
// (mirrors ER ROM's `gDisableStructs[battlerId].isFirstTurn`).
//
// Wires (from ER C source vendor/elite-redux/source/src/battle_main.c:4892):
//   - 350 Violent Rush — first turn speed × 1.5 (separately damage × 1.2,
//     handled via a sibling FirstTurnPowerBoost wire).
// =============================================================================

import { StatMultiplierAbAttr } from "#abilities/ab-attrs";
import type { StatMultiplierAbAttrParams } from "#types/ability-types";
import type { EffectiveStat } from "#enums/stat";

export interface FirstTurnStatMultiplierOptions {
  readonly stat: EffectiveStat;
  readonly multiplier: number;
}

/**
 * Subclasses {@linkcode StatMultiplierAbAttr}. The condition is "user
 * hasn't moved yet this battle since switching in" (matches ER's
 * `isFirstTurn`). Multiplier is unconditional otherwise.
 */
export class FirstTurnStatMultiplierAbAttr extends StatMultiplierAbAttr {
  constructor(opts: FirstTurnStatMultiplierOptions) {
    super(opts.stat, opts.multiplier);
  }

  override canApply(params: StatMultiplierAbAttrParams): boolean {
    if (!super.canApply(params)) {
      return false;
    }
    // "First turn" = user hasn't recorded any move yet in summonData.
    const history = params.pokemon.summonData?.moveHistory;
    return !history || history.length === 0;
  }
}
