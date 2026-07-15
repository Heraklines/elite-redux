/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — bespoke ability `Pressure Vessel` (Regitube).
//
// "The holder's Defense and Special Defense scale LINEARLY with how much PP it
// has left across its whole moveset. At 100% total PP the multiplier is 1.5x; at
// 0% it is 1.0x (so exactly 1.25x at 50%). Recomputed live every damage calc."
//
// PP fraction = (sum of current PP over the moveset) / (sum of max PP). Moves
// with unlimited PP (`getMovePp() === -1`) and unresolved id-map drift entries
// are skipped from both sums so they neither inflate nor deflate the fraction.
//
// Implementation: subclasses pokerogue's `StatMultiplierAbAttr` (like
// {@linkcode HpScalingStatMultiplierAbAttr}) and computes the factor at call
// time from the holder's live PP, applying only to DEF / SPDEF. Self-contained —
// wired via `applyAbAttrs("StatMultiplierAbAttr", …)` in `getEffectiveStat`;
// no engine hook needed.
// =============================================================================

import { StatMultiplierAbAttr, type StatMultiplierAbAttrParams } from "#abilities/ab-attrs";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_PRESSURE_VESSEL_ABILITY_ID = 5914;

/** Multiplier at 0% total PP (no boost). */
export const PRESSURE_VESSEL_MIN_MULTIPLIER = 1.0;
/** Multiplier at 100% total PP. */
export const PRESSURE_VESSEL_MAX_MULTIPLIER = 1.5;

/**
 * Compute the holder's total remaining-PP fraction across its whole moveset:
 * `Σ currentPp / Σ maxPp`. Moves with unlimited PP and unresolvable ids are
 * excluded from both sums. Returns `1` when the mon has no PP-bearing moves
 * (nothing spent → full bulk).
 */
export function pressureVesselPpFraction(pokemon: Pokemon): number {
  let currentTotal = 0;
  let maxTotal = 0;
  for (const move of pokemon.getMoveset()) {
    if (!move?.getMove()) {
      continue;
    }
    const maxPp = move.getMovePp();
    if (maxPp <= 0) {
      // -1 = unlimited PP (e.g. Struggle); skip so it can't skew the ratio.
      continue;
    }
    maxTotal += maxPp;
    currentTotal += maxPp - move.ppUsed;
  }
  if (maxTotal <= 0) {
    return 1;
  }
  return Math.max(0, Math.min(1, currentTotal / maxTotal));
}

/**
 * `StatMultiplierAbAttr` whose factor scales linearly with the holder's total
 * remaining PP fraction. Applies only to DEF and SPDEF.
 */
export class PressureVesselAbAttr extends StatMultiplierAbAttr {
  constructor() {
    // multiplier=1 is ignored; the real factor is computed in apply().
    super(Stat.DEF, 1);
  }

  override canApply({ stat }: StatMultiplierAbAttrParams): boolean {
    return stat === Stat.DEF || stat === Stat.SPDEF;
  }

  override apply(params: StatMultiplierAbAttrParams): void {
    params.statVal.value *= this.multiplierFor(params.pokemon);
  }

  /**
   * The Def/SpDef multiplier for the holder's current PP fraction. Exposed for
   * tests so the gradient can be verified without a full battle.
   */
  public multiplierFor(pokemon: Pokemon): number {
    const fraction = pressureVesselPpFraction(pokemon);
    return (
      PRESSURE_VESSEL_MIN_MULTIPLIER + (PRESSURE_VESSEL_MAX_MULTIPLIER - PRESSURE_VESSEL_MIN_MULTIPLIER) * fraction
    );
  }
}
