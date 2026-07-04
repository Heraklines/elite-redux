/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `hp-scaling-stat-multiplier` archetype.
//
// Models ER abilities whose stat multiplier scales LINEARLY with the holder's
// missing HP, rather than a flat threshold tier. Wires:
//
//   - 634 Last Stand — "Defense and Special Defense increase linearly as HP
//     decreases. Multiplier scales from 1.0x at full HP to 1.6x at 0% HP. At
//     50% HP provides 1.3x boost, at 25% HP provides 1.45x boost."
//
// The multiplier is `minMultiplier + (maxMultiplier - minMultiplier) *
// (1 - hp/maxHp)`. For Last Stand (min 1.0, max 1.6): full HP → 1.0x,
// 50% → 1.3x, 25% → 1.45x, 0% → 1.6x — matching the dex points exactly.
//
// Implementation: subclasses pokerogue's `StatMultiplierAbAttr` and overrides
// `apply` to compute the multiplier from the current HP fraction instead of
// using a fixed factor (the parent's `multiplier` is passed as 1 and ignored).
// =============================================================================

import { StatMultiplierAbAttr, type StatMultiplierAbAttrParams } from "#abilities/ab-attrs";
import type { BattleStat } from "#enums/stat";

/** Construction options for {@linkcode HpScalingStatMultiplierAbAttr}. */
export interface HpScalingStatMultiplierOptions {
  /** The stat this multiplier applies to. */
  readonly stat: BattleStat;
  /** Multiplier at full HP (typically `1.0` — no boost). */
  readonly minMultiplier: number;
  /** Multiplier at 0% HP (the maximum boost, e.g. `1.6`). */
  readonly maxMultiplier: number;
}

/**
 * Parameterized `AbAttr` implementing the `hp-scaling-stat-multiplier`
 * archetype. The multiplier interpolates linearly between `minMultiplier` (at
 * full HP) and `maxMultiplier` (at 0% HP) based on the holder's missing HP.
 */
export class HpScalingStatMultiplierAbAttr extends StatMultiplierAbAttr {
  private readonly minMultiplier: number;
  private readonly maxMultiplier: number;

  constructor(opts: HpScalingStatMultiplierOptions) {
    // Pass multiplier=1 to the parent; the real factor is computed in apply().
    super(opts.stat, 1);
    if (!(opts.minMultiplier > 0) || !(opts.maxMultiplier > 0)) {
      throw new Error("[HpScalingStatMultiplierAbAttr] multipliers must be > 0");
    }
    this.minMultiplier = opts.minMultiplier;
    this.maxMultiplier = opts.maxMultiplier;
  }

  override apply(params: StatMultiplierAbAttrParams): void {
    const { pokemon, statVal } = params;
    statVal.value *= this.multiplierAt(pokemon.hp, pokemon.getMaxHp());
  }

  /**
   * Compute the linear multiplier for a given current/max HP. Exposed for tests
   * so the gradient can be verified without a full battle.
   */
  public multiplierAt(hp: number, maxHp: number): number {
    const hpFraction = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
    const missing = 1 - hpFraction;
    return this.minMultiplier + (this.maxMultiplier - this.minMultiplier) * missing;
  }

  /** Read-only accessor: multiplier at full HP. */
  public getMinMultiplier(): number {
    return this.minMultiplier;
  }

  /** Read-only accessor: multiplier at 0% HP. */
  public getMaxMultiplier(): number {
    return this.maxMultiplier;
  }
}
