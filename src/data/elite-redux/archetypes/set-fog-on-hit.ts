/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `set-fog-on-hit` archetype.
//
// PostDefend hook: when the holder is hit by an attack, set FOG weather
// for the configured number of turns. Wires ER 905 Fog Machine ("When
// hit, set up Eerie Fog").
//
// Pokerogue ships WeatherType.FOG with full weather.ts integration
// (start/lapse/clear messages already wired). We just call
// arena.trySetWeather directly post-defend.
// =============================================================================

import { PostDefendAbAttr } from "#abilities/ab-attrs";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";
import { globalScene } from "#app/global-scene";
import { WeatherType } from "#enums/weather-type";

export class SetFogOnHitAbAttr extends PostDefendAbAttr {
  constructor() {
    super(false);
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { move } = params;
    if (!move?.is("AttackMove")) {
      return false;
    }
    const currentWeather = globalScene.arena.weather?.weatherType;
    return currentWeather !== WeatherType.FOG;
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    const { pokemon, simulated } = params;
    if (simulated) {
      return;
    }
    globalScene.arena.trySetWeather(WeatherType.FOG, pokemon);
  }
}
