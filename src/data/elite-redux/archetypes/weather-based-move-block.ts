/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `weather-based-move-block` archetype.
//
// PreDefend hook: makes the holder immune to all weather-based moves
// (Solar Beam in non-sun, Hurricane in rain, Thunder in rain, Weather
// Ball, etc. — moves keyed by ER's WEATHER_BASED move flag). For our
// implementation we use a curated MoveId list.
//
// Wires:
//   - 354 Weather Control — "Negates all weather based moves from enemies."
// =============================================================================

import { PreDefendAbAttr, type TypeMultiplierAbAttrParams } from "#abilities/ab-attrs";
import { MoveId } from "#enums/move-id";

const WEATHER_BASED_MOVES = new Set<MoveId>([
  MoveId.WEATHER_BALL,
  MoveId.SOLAR_BEAM,
  MoveId.SOLAR_BLADE,
  MoveId.HURRICANE,
  MoveId.THUNDER,
  MoveId.BLIZZARD,
  MoveId.MORNING_SUN,
  MoveId.SYNTHESIS,
  MoveId.MOONLIGHT,
  MoveId.SHORE_UP,
  MoveId.AURORA_VEIL,
]);

export class WeatherBasedMoveBlockAbAttr extends PreDefendAbAttr {
  constructor() {
    super(true);
  }

  override canApply(params: TypeMultiplierAbAttrParams): boolean {
    const { move, opponent, pokemon } = params;
    if (opponent === pokemon) {
      return false;
    }
    return WEATHER_BASED_MOVES.has(move.id);
  }

  override apply(params: TypeMultiplierAbAttrParams): void {
    params.typeMultiplier.value = 0;
    params.cancelled.value = true;
  }
}
