/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `set-fog-on-hit` archetype.
//
// PostDefend hook: when the holder is hit by an attack, summon ER's distinct
// EERIE_FOG weather for 8 turns. Wires ER 905 Fog Machine ("When hit, set up
// Eerie Fog"). Eerie Fog is a separate Ghost/Psychic weather (docs/
// er-custom-mechanics.md) — NOT vanilla FOG — with no accuracy debuff. Its
// per-turn effects (buff decay, Ghost/Psychic damage reduction, halved
// recovery, Ghost-type Curse) live in the weather-lapse / damage / heal /
// Curse paths, all gated via `isFogWeather` so they fire under EERIE_FOG.
// =============================================================================

import { PostDefendAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { WeatherType } from "#enums/weather-type";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";

// Uses the default `showAbility = true`: summoning Eerie Fog on being hit is a
// discrete, player-visible activation, so the ability banner must flash —
// matching vanilla convention for weather-setting abilities (same popup-display
// defect class as the counter-attack archetype). A prior explicit `super(false)`
// suppressed that banner.
export class SetFogOnHitAbAttr extends PostDefendAbAttr {
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { move } = params;
    if (!move?.is("AttackMove")) {
      return false;
    }
    const currentWeather = globalScene.arena.weather?.weatherType;
    return currentWeather !== WeatherType.EERIE_FOG;
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    const { pokemon, simulated } = params;
    if (simulated) {
      return;
    }
    // ER 905 summons Eerie Fog for 8 turns (the standard ER weather-summon length).
    globalScene.arena.trySetWeather(WeatherType.EERIE_FOG, pokemon, 8);
  }
}
