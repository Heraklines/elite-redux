/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase D bespoke / Phase C late-addition: `weather-stat-multiplier`
// archetype primitive (Round 7).
//
// Parameterized `AbAttr` covering the "stat is multiplied by K when WEATHER is
// active" family — the long-tail cousin of vanilla `Swift Swim` /
// `Chlorophyll` / `Sand Rush` / `Slush Rush`, which gate a Speed multiplier on
// a single weather type via the AbBuilder `.condition()` mechanism. Our
// version generalizes:
//
//   - Configurable target stat (typically Speed, but any {@linkcode BattleStat}
//     works — `Solar Power`'s SpAtk-in-sun is the same shape with a different
//     stat).
//   - Configurable multiplier (1.5, 2, 1.33, etc.). Must be > 0; values < 1
//     are accepted so the same primitive can model debuffs ("-50% Speed in
//     hail").
//   - **List** of weathers (not single) — covers ER abilities like
//     `Thermal Slide` ("ups speed by 50% in sun or hail") that activate under
//     multiple weathers.
//
// Base class: extends pokerogue's {@linkcode StatMultiplierAbAttr} (the same
// parent Swift Swim et al. use) and overrides {@linkcode canApply} to add the
// weather check. This is cleaner than the AbBuilder `.condition()` route
// because the dispatcher returns AbAttrs without builder context — embedding
// the weather gate inside the AbAttr keeps the archetype self-contained.
//
// Why not reuse the existing {@linkcode WeatherTypeBoostAbAttr}? That class
// extends `MovePowerBoostAbAttr` and lives on the *damage* side — it boosts
// outgoing move damage of a given type, gated on weather. This primitive is
// orthogonal: it boosts a *stat* (which feeds into damage and turn order),
// not the final damage roll.
//
// Sub-shapes intentionally NOT covered (deferred):
//   - **Conditional self-stat boost on weather start / change** (e.g.
//     `Solar Power`-style end-of-turn HP cost) — composes with
//     `passive-recovery` + this primitive but the HP-cost piece is bespoke.
//   - **Weather-gated stat protect** (e.g. "stat drops are negated in sand")
//     — different surface (`PreStatStageChangeAbAttr`).
//
// Examples:
//   - `Swift Swim` parity — `new WeatherStatMultiplierAbAttr({
//       stat: Stat.SPD, multiplier: 2, weathers: [WeatherType.RAIN, WeatherType.HEAVY_RAIN] })`
//   - `Thermal Slide` (862) — `new WeatherStatMultiplierAbAttr({
//       stat: Stat.SPD, multiplier: 1.5, weathers: [WeatherType.SUNNY, WeatherType.HARSH_SUN,
//         WeatherType.HAIL, WeatherType.SNOW] })`
// =============================================================================

import { StatMultiplierAbAttr, type StatMultiplierAbAttrParams } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import type { BattleStat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";

/** Construction options for {@linkcode WeatherStatMultiplierAbAttr}. */
export interface WeatherStatMultiplierOptions {
  /**
   * The stat whose computed value is multiplied. Typically `Stat.SPD`
   * (Speed) — matching the dominant ER usage — but any {@linkcode BattleStat}
   * is accepted.
   */
  readonly stat: BattleStat;
  /**
   * Multiplier applied to the stat value when the active weather matches one
   * of {@linkcode weathers}. Must be > 0. Values > 1 boost; values < 1 reduce.
   * Typical: `1.5` (Thermal Slide's +50%), `2` (Swift Swim parity).
   */
  readonly multiplier: number;
  /**
   * Weather types that activate the multiplier. The active weather must be
   * listed (and not effect-suppressed) for the proc to fire. Most ER customs
   * list 1-4 entries (often a primary + its `HEAVY_/HARSH_/HEAVY_RAIN`
   * counterpart, or a pair like sun + hail).
   */
  readonly weathers: readonly WeatherType[];
}

/**
 * Parameterized `AbAttr` implementing the `weather-stat-multiplier` archetype.
 *
 * @remarks
 * Extends pokerogue's {@linkcode StatMultiplierAbAttr}. The parent already
 * handles the stat-match check and the apply path (`statVal.value *=
 * multiplier`); we override {@linkcode canApply} to add the weather gate.
 *
 * Weather check follows the same pattern as vanilla `getWeatherCondition`:
 *
 *   - Returns `false` when the active weather effect is suppressed (e.g. by
 *     a Cloud Nine ally) — matches vanilla `getWeatherCondition` line in
 *     `ab-attrs.ts:6067`.
 *   - Returns `true` iff the active weather type is in the configured list.
 *
 * Note: the parent's `condition` field is not used here — that field is
 * Hustle's accuracy gate ("only halve accuracy on damaging moves"), which is
 * orthogonal to our weather gate. We extend `canApply` rather than passing a
 * `condition` to keep the two concerns separable.
 */
export class WeatherStatMultiplierAbAttr extends StatMultiplierAbAttr {
  private readonly weathers: readonly WeatherType[];

  constructor(opts: WeatherStatMultiplierOptions) {
    if (!(opts.multiplier > 0)) {
      throw new Error(`[WeatherStatMultiplierAbAttr] multiplier must be > 0; got ${opts.multiplier}`);
    }
    if (opts.weathers.length === 0) {
      throw new Error("[WeatherStatMultiplierAbAttr] must configure at least one weather type");
    }
    if (opts.weathers.includes(WeatherType.NONE)) {
      throw new Error("[WeatherStatMultiplierAbAttr] weathers must not include NONE (use no-op instead)");
    }
    super(opts.stat, opts.multiplier);
    this.weathers = opts.weathers;
  }

  /** Read-only accessor for the configured weather list. */
  public getWeathers(): readonly WeatherType[] {
    return this.weathers;
  }

  /**
   * canApply: stat must match (parent's check) AND active weather must be one
   * of the configured weathers and not suppressed.
   */
  public override canApply(params: StatMultiplierAbAttrParams): boolean {
    if (!super.canApply(params)) {
      return false;
    }
    return this.isWeatherActive();
  }

  /**
   * Check whether the active weather is one of the configured weathers and
   * not effect-suppressed (e.g. by Cloud Nine).
   *
   * @remarks
   * Exposed as a method (not static) because it reads from `globalScene` at
   * call time. The dispatch path runs inside a battle, so `globalScene` is
   * always defined; tests that need to call this without a live scene should
   * stub `globalScene.arena.weather` and `globalScene.arena.weatherType`.
   */
  public isWeatherActive(): boolean {
    if (globalScene.arena.weather?.isEffectSuppressed()) {
      return false;
    }
    return this.weathers.includes(globalScene.arena.weatherType);
  }
}
