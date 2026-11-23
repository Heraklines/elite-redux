/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `weather-ground-airborne` archetype.
//
// "During sandstorm, the user's Ground-type moves bypass immunity and hit
// airborne Pokemon with normal effectiveness." While the configured weather is
// active, a Ground-type move that would be type-immune (0x — i.e. vs Flying) is
// rewritten to neutral (1x).
//
// Read (registration-free, by class name) inside
// `Pokemon.getAttackTypeEffectiveness`, alongside OffensiveTypeChartOverride /
// BoneMoveTypeChart.
//
// Wires:
//   - 604 Desert Spirit — "Summons sand on entry. Ground moves hit airborne in
//     sand." (paired with the sand-on-entry effect.)
// =============================================================================

import { AbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { PokemonType } from "#enums/pokemon-type";
import { WeatherType } from "#enums/weather-type";
import type { AbAttrBaseParams } from "#types/ability-types";
import type { NumberHolder } from "#utils/common";

export class WeatherGroundAirborneAbAttr extends AbAttr implements GatedAttr<undefined> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: (() => boolean) | undefined;
  private readonly weathers: readonly WeatherType[];

  constructor(weathers: readonly WeatherType[] = [WeatherType.SANDSTORM]) {
    super(false);
    this.weathers = weathers;
  }

  override canApply(_params: AbAttrBaseParams): boolean {
    return true;
  }

  override apply(_params: AbAttrBaseParams): void {}

  /**
   * Rewrite a Ground move's 0x (immune) to 1x while the gating weather is up.
   *
   * Tier B (ability studio spec 3.1): the two moment tests (a Ground move, a matchup of 0) stay here, because the engine only
   * hands this method a move TYPE and the running matchup; the weather test is the replaceable `gate`, asked in the old order.
   */
  public fire(moveType: PokemonType, multi: NumberHolder): void {
    if (moveType !== PokemonType.GROUND || multi.value !== 0) {
      return;
    }
    if (gatedCanApply<undefined>(this, undefined)) {
      multi.value = 1;
    }
  }

  /** The replaceable condition: the gating weather is active and its effects are not suppressed (Cloud Nine / Air Lock). */
  public gate(): boolean {
    const weather = globalScene.arena.weather;
    return !!weather && !weather.isEffectSuppressed() && this.weathers.includes(weather.weatherType);
  }
}
