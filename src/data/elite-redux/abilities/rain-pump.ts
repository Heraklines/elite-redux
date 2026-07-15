/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — bespoke ability `Rain Pump` (Regitube).
//
// "At the end of each turn while it is raining (ordinary Rain OR the primal
// Heavy Rain), every one of the holder's moves recovers 1 PP (never above its
// maximum)." Modeled on pokerogue's `PostTurnAbAttr` (the same end-of-turn hook
// Speed Boost / Moody use). Restoration is a direct `ppUsed` decrement — there
// is no built-in restore helper (`usePp` only spends).
// =============================================================================

import { PostTurnAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { WeatherType } from "#enums/weather-type";
import type { AbAttrBaseParams } from "#types/ability-types";

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_RAIN_PUMP_ABILITY_ID = 5915;

/** PP restored to each move per end-of-turn tick in rain. */
export const RAIN_PUMP_PP_RESTORE = 1;

/** Whether an active, non-suppressed rain weather (ordinary or heavy) is up. */
function isRainingNow(): boolean {
  const weather = globalScene.arena.weather;
  if (!weather || weather.isEffectSuppressed()) {
    return false;
  }
  return weather.weatherType === WeatherType.RAIN || weather.weatherType === WeatherType.HEAVY_RAIN;
}

export class RainPumpAbAttr extends PostTurnAbAttr {
  constructor() {
    // showAbility true — surfacing the restore reads clearly at turn end.
    super(true);
  }

  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    if (!isRainingNow()) {
      return false;
    }
    // Only fire when at least one move actually has spent PP to give back.
    return pokemon.getMoveset().some(m => !!m?.getMove() && m.ppUsed > 0);
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    for (const move of pokemon.getMoveset()) {
      if (!move?.getMove()) {
        continue;
      }
      move.ppUsed = Math.max(0, move.ppUsed - RAIN_PUMP_PP_RESTORE);
    }
  }
}
