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
import { gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { WeatherType } from "#enums/weather-type";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";

// Uses the default `showAbility = true`: summoning Eerie Fog on being hit is a
// discrete, player-visible activation, so the ability banner must flash —
// matching vanilla convention for weather-setting abilities (same popup-display
// defect class as the counter-attack archetype). A prior explicit `super(false)`
// suppressed that banner.
export class SetFogOnHitAbAttr extends PostDefendAbAttr {
  private readonly weather: WeatherType;
  private readonly turns: number;

  /**
   * @param weather - the weather set when the holder is hit; the default is Eerie Fog, the only shipped value
   * @param turns - how many turns it lasts; the default is 8 (the standard ER weather-summon length)
   */
  constructor(weather: WeatherType = WeatherType.EERIE_FOG, turns = 8) {
    super();
    this.weather = weather;
    this.turns = turns;
  }

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  /** Tier B split (ability studio spec 3.1): the whole rule is the gate, there is no guard and no residual. */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  /** The replaceable conditions, in the ORIGINAL order: the move is an attack, and that weather is not already up. */
  public gate(params: PostMoveInteractionAbAttrParams): boolean {
    const { move } = params;
    if (!move?.is("AttackMove")) {
      return false;
    }
    const currentWeather = globalScene.arena.weather?.weatherType;
    return currentWeather !== this.weather;
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    const { pokemon, simulated } = params;
    if (simulated) {
      return;
    }
    // ER 905 summons Eerie Fog for 8 turns (the standard ER weather-summon length).
    globalScene.arena.trySetWeather(this.weather, pokemon, this.turns);
  }
}
