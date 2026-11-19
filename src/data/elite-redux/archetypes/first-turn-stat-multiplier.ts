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
import { gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import type { EffectiveStat } from "#enums/stat";
import type { StatMultiplierAbAttrParams } from "#types/ability-types";

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

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: StatMultiplierAbAttrParams) => boolean) | undefined;

  /** Tier B split (ability studio spec 3.1): `guards` (the parent test), then `gate`, in the original clause order. */
  override canApply(params: StatMultiplierAbAttrParams): boolean {
    return gatedCanApply<StatMultiplierAbAttrParams>(this, params);
  }

  /** The stat the game is asking about is the boosted one (the parent's own test). Moved verbatim from `canApply`. */
  public guards(params: StatMultiplierAbAttrParams): boolean {
    return super.canApply(params);
  }

  /** The replaceable condition. "First turn" = user hasn't recorded any move yet in summonData. */
  public gate(params: StatMultiplierAbAttrParams): boolean {
    const history = params.pokemon.summonData?.moveHistory;
    return !history || history.length === 0;
  }
}
