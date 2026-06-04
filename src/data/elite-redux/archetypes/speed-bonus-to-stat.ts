/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `speed-bonus-to-stat` archetype.
//
// ER cluster of abilities that add a fraction of the holder's Speed onto
// their offensive (or defensive) stat during damage calculation. Wires:
//
//   - Slipstream (695)        — +20% Speed to attack on all moves
//   - Terminal Velocity (552) — +20% Speed to SpAtk on special moves
//   - Speed Force (355)       — +20% Speed to attack on contact moves
//   - Momentum (372)          — +100% Speed (replace ATK) on contact moves
//   - Impulse (551)           — +100% Speed (replace ATK) on non-contact moves
//   - Sleek Scales (1030)     — +15% Speed to defense when receiving
//
// Implementation: subclasses pokerogue's StatMultiplierAbAttr. Instead of
// multiplying the stat itself, we add a fraction of the holder's current
// Speed stat onto the value the parent would otherwise emit. The category
// filter (physical/special/contact-only/non-contact-only) gates when the
// bonus applies.
// =============================================================================

import { StatMultiplierAbAttr, type StatMultiplierAbAttrParams } from "#abilities/ab-attrs";
import type { EffectiveStat, BattleStat } from "#enums/stat";
import { Stat } from "#enums/stat";

/** Filter shape — which moves trigger the speed bonus. */
export interface SpeedBonusFilter {
  /** When set, restrict to physical / special moves only. */
  readonly category?: "physical" | "special";
  /** When set, restrict to contact-only or non-contact-only moves. */
  readonly contact?: "only" | "non";
}

/** Construction options for {@linkcode SpeedBonusToStatAbAttr}. */
export interface SpeedBonusToStatOptions {
  /** Which battler stat receives the bonus (typically ATK / SPATK / DEF / SPDEF). */
  readonly stat: BattleStat;
  /**
   * Fraction of the holder's current Speed to add. `1` = full speed value
   * added (e.g. Momentum / Impulse, which effectively replace the stat).
   * `0.2` = 20% (Slipstream / Terminal Velocity / Speed Force).
   */
  readonly speedFraction: number;
  /** Optional gate on the move being used. */
  readonly filter?: SpeedBonusFilter;
  /**
   * Optional override for the source stat. Defaults to {@linkcode Stat.SPD}
   * (matching the original primitive purpose). Set to e.g. {@linkcode Stat.DEF}
   * to wire abilities like Power Core ("+20% Def during moves"). Must be an
   * EffectiveStat (HP/ATK/DEF/SPATK/SPDEF/SPD) — accuracy/evasion are not
   * meaningful "source" stats.
   */
  readonly sourceStat?: EffectiveStat;
}

/**
 * Parameterized AbAttr implementing the `speed-bonus-to-stat` archetype.
 *
 * Extends pokerogue's StatMultiplierAbAttr but overrides apply to ADD a
 * fraction of the holder's Speed onto statVal.value rather than multiplying.
 */
export class SpeedBonusToStatAbAttr extends StatMultiplierAbAttr {
  private readonly bonusStat: BattleStat;
  private readonly speedFraction: number;
  private readonly bonusFilter: SpeedBonusFilter;
  private readonly sourceStat: EffectiveStat;

  constructor(options: SpeedBonusToStatOptions) {
    // Pass multiplier=1 to the parent so the base stat is unchanged; we add
    // the speed bonus in apply() instead.
    super(options.stat, 1);
    if (!(options.speedFraction > 0)) {
      throw new Error(`[SpeedBonusToStatAbAttr] speedFraction must be > 0; got ${options.speedFraction}`);
    }
    this.bonusStat = options.stat;
    this.speedFraction = options.speedFraction;
    this.bonusFilter = options.filter ?? {};
    this.sourceStat = options.sourceStat ?? Stat.SPD;
  }

  override canApply(params: StatMultiplierAbAttrParams): boolean {
    const { stat, move } = params;
    if (stat !== this.bonusStat) {
      return false;
    }
    if (!move) {
      return true;
    }
    if (this.bonusFilter.category === "physical" && !move.is("AttackMove")) {
      return false;
    }
    if (this.bonusFilter.category === "special" && !move.is("AttackMove")) {
      return false;
    }
    if (this.bonusFilter.contact === "only" && !move.hasFlag(1 /* MoveFlags.MAKES_CONTACT */)) {
      return false;
    }
    if (this.bonusFilter.contact === "non" && move.hasFlag(1 /* MoveFlags.MAKES_CONTACT */)) {
      return false;
    }
    return true;
  }

  override apply(params: StatMultiplierAbAttrParams): void {
    const { pokemon, statVal } = params;
    const sourceValue = pokemon.getStat(this.sourceStat, false);
    statVal.value += Math.floor(sourceValue * this.speedFraction);
  }
}
