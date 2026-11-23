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
import type { BattleStat, EffectiveStat } from "#enums/stat";
import { Stat } from "#enums/stat";
import type { Move } from "#moves/move";
import type { PokemonAttackCondition } from "#types/ability-types";

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
  /**
   * When `true`, REPLACE the offensive stat with the (fractional) source stat
   * instead of ADDING to it. Used by the "uses Speed INSTEAD OF Attack/SpAtk"
   * abilities (Impulse, Momentum) — with `speedFraction: 1` the attacking stat
   * becomes exactly the Speed value. Defaults to `false` (add mode, for the
   * "+X% of Speed" abilities like Slipstream).
   */
  readonly replace?: boolean;
}

/** The move test of a {@linkcode SpeedBonusFilter}: true when the move passes (an empty filter passes every move). */
function speedBonusFilterPasses(filter: SpeedBonusFilter, move: Move): boolean {
  if (filter.category === "physical" && !move.is("AttackMove")) {
    return false;
  }
  if (filter.category === "special" && !move.is("AttackMove")) {
    return false;
  }
  if (filter.contact === "only" && !move.hasFlag(1 /* MoveFlags.MAKES_CONTACT */)) {
    return false;
  }
  if (filter.contact === "non" && move.hasFlag(1 /* MoveFlags.MAKES_CONTACT */)) {
    return false;
  }
  return true;
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
  private readonly sourceStat: EffectiveStat;
  private readonly replace: boolean;
  /**
   * Which moves the bonus applies to, called as (holder, null, move); read by the ability studio. Always set: it is the
   * constructor argument, or the move test of `options.filter` (see the constructor).
   */
  public readonly moveCondition: PokemonAttackCondition;

  /**
   * @param options - the stat, the share, the source stat, the mode and the move filter of the default condition
   * @param condition - Which moves the bonus applies to. The default is the test of `options.filter` (no filter = every
   *   move), so `new SpeedBonusToStatAbAttr({ ... })` behaves exactly as before; the ability studio hands in a replacement.
   */
  constructor(options: SpeedBonusToStatOptions, condition?: PokemonAttackCondition) {
    // Pass multiplier=1 to the parent so the base stat is unchanged; we add
    // the speed bonus in apply() instead.
    super(options.stat, 1);
    if (!(options.speedFraction > 0)) {
      throw new Error(`[SpeedBonusToStatAbAttr] speedFraction must be > 0; got ${options.speedFraction}`);
    }
    this.bonusStat = options.stat;
    this.speedFraction = options.speedFraction;
    this.sourceStat = options.sourceStat ?? Stat.SPD;
    this.replace = options.replace ?? false;
    const filter = options.filter ?? {};
    this.moveCondition = condition ?? ((_user, _target, move) => speedBonusFilterPasses(filter, move));
  }

  override canApply(params: StatMultiplierAbAttrParams): boolean {
    const { stat, move } = params;
    if (stat !== this.bonusStat) {
      return false;
    }
    if (!move) {
      return true;
    }
    // The move test (a condition the ability studio can replace), in its ORIGINAL position.
    return this.moveCondition(params.pokemon, null, move);
  }

  override apply(params: StatMultiplierAbAttrParams): void {
    const { pokemon, statVal } = params;
    const bonus = Math.floor(pokemon.getStat(this.sourceStat, false) * this.speedFraction);
    // Replace mode ("uses Speed INSTEAD OF Atk/SpAtk") overwrites the offensive
    // stat; add mode ("+X% of Speed") stacks on top of it.
    statVal.value = this.replace ? bonus : statVal.value + bonus;
  }
}
