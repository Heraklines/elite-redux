/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `self-highest-stat-multiplier` primitive.
//
// Multiplies whichever of the holder's configured candidate stats is currently
// highest (raw base + any persistent boosts). The chosen stat receives a
// configurable multiplier on its effective value.
//
// Wires (with optional weather gate):
//   - 269 Whiteout — highest attacking stat × 1.5 in hail
//   - 621 Ectoplasm — highest attacking stat × 1.5 in fog
//   - 935 Raging Storm — highest attacking stat × 1.5 in rain
//   - and similar abilities that boost the holder's strongest offensive stat
//     during a specific weather.
// =============================================================================

import { StatMultiplierAbAttr } from "#abilities/ab-attrs";
import type { StatMultiplierAbAttrParams } from "#types/ability-types";
import type { EffectiveStat } from "#enums/stat";
import { globalScene } from "#app/global-scene";
import type { WeatherType } from "#enums/weather-type";

export interface SelfHighestStatMultiplierOptions {
  /** Candidate stats — whichever has the highest base value gets the multiplier. */
  readonly candidates: readonly EffectiveStat[];
  /** Multiplier applied to the chosen stat's effective value. */
  readonly multiplier: number;
  /**
   * Optional weather gate — only applies when active weather is in this set.
   * Omit for an always-on multiplier.
   */
  readonly weathers?: readonly WeatherType[];
}

/**
 * Extends `StatMultiplierAbAttr`. The vanilla attr applies a fixed multiplier
 * to a fixed stat; we override the predicate so it only fires when:
 *   - (optional) the active weather is in `opts.weathers`
 *   - the queried stat equals the holder's current-highest among `candidates`
 */
export class SelfHighestStatMultiplierAbAttr extends StatMultiplierAbAttr {
  private readonly candidates: readonly EffectiveStat[];
  private readonly mult: number;
  private readonly weathers?: readonly WeatherType[];

  constructor(opts: SelfHighestStatMultiplierOptions) {
    if (opts.candidates.length === 0) {
      throw new Error("[SelfHighestStatMultiplierAbAttr] candidates must be non-empty");
    }
    if (!(opts.multiplier > 0)) {
      throw new Error("[SelfHighestStatMultiplierAbAttr] multiplier must be > 0");
    }
    // Parent expects (stat, multiplier). We pass the first candidate as a
    // placeholder — canApply will gate against the dynamic highest stat.
    super(opts.candidates[0], opts.multiplier);
    this.candidates = opts.candidates;
    this.mult = opts.multiplier;
    this.weathers = opts.weathers;
  }

  override canApply(params: StatMultiplierAbAttrParams): boolean {
    if (!super.canApply(params)) {
      // Parent gates on stat === this.stat (the placeholder first candidate),
      // which we WANT to bypass. So we replicate the parent's other checks here.
    }
    if (this.weathers !== undefined) {
      const active = globalScene.arena.weather?.weatherType;
      if (active === undefined || !this.weathers.includes(active)) {
        return false;
      }
    }
    const queriedStat = params.stat as EffectiveStat;
    if (!this.candidates.includes(queriedStat)) {
      return false;
    }
    // Find the current highest candidate.
    const pokemon = params.pokemon;
    let bestStat: EffectiveStat = this.candidates[0];
    let bestValue = -1;
    for (const stat of this.candidates) {
      const value = pokemon.getStat(stat, false);
      if (value > bestValue) {
        bestValue = value;
        bestStat = stat;
      }
    }
    return queriedStat === bestStat;
  }

  override apply(params: StatMultiplierAbAttrParams): void {
    params.statVal.value *= this.mult;
  }
}
