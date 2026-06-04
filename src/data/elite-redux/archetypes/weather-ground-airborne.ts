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
import { PokemonType } from "#enums/pokemon-type";
import { WeatherType } from "#enums/weather-type";
import type { AbAttrBaseParams } from "#types/ability-types";
import type { NumberHolder } from "#utils/common";

export class WeatherGroundAirborneAbAttr extends AbAttr {
  private readonly weathers: readonly WeatherType[];

  constructor(weathers: readonly WeatherType[] = [WeatherType.SANDSTORM]) {
    super(false);
    this.weathers = weathers;
  }

  override canApply(_params: AbAttrBaseParams): boolean {
    return true;
  }

  override apply(_params: AbAttrBaseParams): void {}

  /** Rewrite a Ground move's 0x (immune) to 1x while the gating weather is up. */
  public fire(moveType: PokemonType, multi: NumberHolder): void {
    if (moveType !== PokemonType.GROUND || multi.value !== 0) {
      return;
    }
    const weather = globalScene.arena.weather;
    if (weather && !weather.isEffectSuppressed() && this.weathers.includes(weather.weatherType)) {
      multi.value = 1;
    }
  }
}
