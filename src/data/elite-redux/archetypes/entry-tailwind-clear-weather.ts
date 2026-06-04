/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `entry-tailwind-clear-weather` archetype.
//
// Engine-side hook: dispatched through pokerogue's existing
// `applyAbAttrs("PostSummonAbAttr", …)` on switch-in.
//
// Wires:
//   - 76 AIR_LOCK — ER spec: "Sets Tailwind for 3 turns and clears all weather
//     effects on entry. Primal weathers are suppressed. Weather can still be set
//     while the user is on the field, but has no effect until it switches out."
//     The weather-SUPPRESSION half (Cloud Nine) is the vanilla base ability and
//     is left in place; this class adds the on-entry rider: set Tailwind (3
//     turns, holder's own side) and clear any active (mutable) weather.
// =============================================================================

import { type AbAttrBaseParams, PostSummonAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { WeatherType } from "#enums/weather-type";

export class EntryTailwindClearWeatherAbAttr extends PostSummonAbAttr {
  /** Tailwind duration in turns. ER Air Blower sets 3 turns on entry. */
  private static readonly TAILWIND_TURNS = 3;

  constructor() {
    super(true);
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    // Tailwind on the holder's own side.
    const side = pokemon.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
    globalScene.arena.addTag(
      ArenaTagType.TAILWIND,
      EntryTailwindClearWeatherAbAttr.TAILWIND_TURNS,
      undefined,
      pokemon.id,
      side,
    );
    // Clear current weather. trySetWeather rejects immutable (primal) weathers,
    // which is exactly the "primal weathers are suppressed (not removed)" rule.
    if (globalScene.arena.weather && !globalScene.arena.weather.isImmutable()) {
      globalScene.arena.trySetWeather(WeatherType.NONE);
    }
  }
}
