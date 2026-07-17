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

// The dex enumerates the OFFENSIVE weather-based moves Weather Control negates
// from enemies: Weather Ball, Solar Beam/Blade, Hurricane, Thunder, Blizzard,
// Silver Wind, the four Storm moves, Sheer Cold, and the three Pledge moves.
// The self-targeting weather heals (Morning Sun / Synthesis / Moonlight / Shore
// Up / Aurora Veil) are dropped — they never arrive as an incoming enemy move,
// so blocking them was inert and not in the dex list.
const WEATHER_BASED_MOVES = new Set<MoveId>([
  MoveId.WEATHER_BALL,
  MoveId.SOLAR_BEAM,
  MoveId.SOLAR_BLADE,
  MoveId.HURRICANE,
  MoveId.THUNDER,
  MoveId.BLIZZARD,
  MoveId.SILVER_WIND,
  MoveId.WILDBOLT_STORM,
  MoveId.BLEAKWIND_STORM,
  MoveId.SANDSEAR_STORM,
  MoveId.SPRINGTIDE_STORM,
  MoveId.SHEER_COLD,
  MoveId.FIRE_PLEDGE,
  MoveId.WATER_PLEDGE,
  MoveId.GRASS_PLEDGE,
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
