/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux archetype primitive: stat-blend.
//
// Adds a fraction of one stat onto another during the stat-effective
// computation. Used by Best Offense (844) — "use 20% of spdef during moves":
// the holder's offensive stat (ATK for physical, SPATK for special) gains 20%
// of its Sp. Def while attacking.
//
// Implementation: extends StatMultiplierAbAttr so it is picked up by the same
// `applyAbAttrs("StatMultiplierAbAttr", …)` call inside Pokemon.getEffectiveStat
// (no new dispatch site needed). The base multiply is a no-op (×1); we override
// apply() to ADD `fraction × sourceStat` instead.
// =============================================================================

import { StatMultiplierAbAttr, type StatMultiplierAbAttrParams } from "#abilities/ab-attrs";
import type { BattleStat } from "#enums/stat";
import { type Stat, Stat as StatEnum } from "#enums/stat";

export interface StatBlendOptions {
  /** Stats this blend applies to (e.g. [ATK, SPATK] for "during moves"). */
  readonly appliesTo: BattleStat[];
  /** The stat whose value is sampled (e.g. SPDEF). */
  readonly sourceStat: Stat;
  /** Fraction of `sourceStat` added to the effective stat (e.g. 0.2 = 20%). */
  readonly fraction: number;
}

export class StatBlendAbAttr extends StatMultiplierAbAttr {
  private readonly appliesTo: BattleStat[];
  private readonly sourceStat: Stat;
  private readonly fraction: number;

  constructor(options: StatBlendOptions) {
    // Base stat is the first applicable stat; multiplier ×1 (apply() is overridden).
    super(options.appliesTo[0] ?? StatEnum.ATK, 1);
    this.appliesTo = options.appliesTo;
    this.sourceStat = options.sourceStat;
    this.fraction = options.fraction;
    if (!(this.fraction > 0)) {
      throw new Error(`[StatBlendAbAttr] fraction must be > 0; got ${this.fraction}`);
    }
  }

  override canApply({ stat }: StatMultiplierAbAttrParams): boolean {
    return this.appliesTo.includes(stat);
  }

  override apply({ pokemon, statVal }: StatMultiplierAbAttrParams): void {
    // Sample the raw source stat (no battle-stage / ability re-application to
    // avoid recursion) and add the configured fraction.
    statVal.value += Math.floor(this.fraction * pokemon.getStat(this.sourceStat, false));
  }
}
