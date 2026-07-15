/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — bespoke ability `Crosscut` (Mega Scam).
//
// "Eligible single-hit SLICING and LAUNCHER (pulse/aura) attacks strike TWICE —
// one blade physical, one special. Each hit lands at 70% power. Multi-hit moves
// are ineligible."
//
// Eligibility: a damaging move flagged SLICING or PULSE that is still a single
// hit and passes `canBeMultiStrikeEnhanced` (so OHKO / charge / multi-hit /
// spread moves are excluded, matching Parental Bond's own filter).
//
// DEFAULTS (documented in the batch report):
//   - Category per strike: the FIRST strike keeps the move's NATIVE category;
//     the SECOND strike uses the OPPOSITE category, each computed with the
//     corresponding offense/defense stats (the category flip drives the whole
//     damage formula via getAttackDamage's category resolution).
//   - Power: BOTH strikes deal 70% power (a `VariableMovePowerAbAttr`).
//   - Secondaries / contact: NOT suppressed — each strike follows the move's own
//     flags (least-surprise; the same move, twice), so an added effect can proc
//     per strike and contact is whatever the move itself has.
//
// Wiring:
//   - `CrosscutSecondStrikeAbAttr` extends `AddSecondStrikeAbAttr` so the
//     existing `applyAbAttrs("AddSecondStrikeAbAttr")` hook in move-effect-phase
//     adds the extra strike (instanceof match). It also exposes
//     `resolveSecondStrikeCategory`, scanned by name in `getAttackDamage` for
//     the per-strike category flip.
//   - `CrosscutPowerAbAttr` extends `VariableMovePowerAbAttr` for the 70% power.
// =============================================================================

import { AddSecondStrikeAbAttr, type AddSecondStrikeAbAttrParams, VariableMovePowerAbAttr } from "#abilities/ab-attrs";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import type { PreAttackModifyPowerAbAttrParams } from "#types/ability-types";

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_CROSSCUT_ABILITY_ID = 5908;

/** Power multiplier applied to EACH of the two Crosscut strikes. */
export const CROSSCUT_POWER_MULTIPLIER = 0.7;

/** Whether a move is a damaging slicing OR pulse/aura move (ignoring hit-count). */
function isCrosscutTypedMove(move: Move): boolean {
  return (
    move.category !== MoveCategory.STATUS
    && (move.hasFlag(MoveFlags.SLICING_MOVE) || move.hasFlag(MoveFlags.PULSE_MOVE))
  );
}

/**
 * Whether Crosscut should split this move into two strikes for `pokemon` against
 * `opponent`: it must be a slicing/pulse move AND still a legal single-hit
 * multi-strike target (excludes OHKO / charge / native multi-hit / spread).
 */
function isCrosscutActive(move: Move, pokemon: Pokemon, opponent: Pokemon | undefined): boolean {
  return isCrosscutTypedMove(move) && move.canBeMultiStrikeEnhanced(pokemon, true, opponent ?? undefined);
}

export class CrosscutSecondStrikeAbAttr extends AddSecondStrikeAbAttr {
  override canApply(params: AddSecondStrikeAbAttrParams): boolean {
    const { pokemon, opponent, move, hitCount } = params;
    return hitCount.value === 1 && isCrosscutActive(move, pokemon, opponent);
  }

  override apply({ hitCount }: AddSecondStrikeAbAttrParams): void {
    hitCount.value += 1;
  }

  /**
   * The category the CURRENT strike should use, or `null` to leave it as-is.
   * Strike 0 (first) keeps the native category; strike 1 (second) flips to the
   * opposite category. Scanned by name in `getAttackDamage`.
   *
   * @param move   - the move being used
   * @param source - the Crosscut holder (attacker)
   * @param target - the defender being hit
   */
  public resolveSecondStrikeCategory(move: Move, source: Pokemon, target: Pokemon): MoveCategory | null {
    if (!isCrosscutActive(move, source, target)) {
      return null;
    }
    // 0-based strike index within this turn's multi-strike (see Multi-Headed).
    const strikeIndex = source.turnData.hitCount - source.turnData.hitsLeft;
    if (strikeIndex !== 1) {
      return null;
    }
    return move.category === MoveCategory.PHYSICAL ? MoveCategory.SPECIAL : MoveCategory.PHYSICAL;
  }
}

export class CrosscutPowerAbAttr extends VariableMovePowerAbAttr {
  override canApply(params: PreAttackModifyPowerAbAttrParams): boolean {
    return isCrosscutActive(params.move, params.pokemon, params.opponent);
  }

  override apply({ power }: PreAttackModifyPowerAbAttrParams): void {
    power.value *= CROSSCUT_POWER_MULTIPLIER;
  }
}
