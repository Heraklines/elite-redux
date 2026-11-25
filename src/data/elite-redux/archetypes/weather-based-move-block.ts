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

import { MoveImmunityAbAttr, type MoveImmunityAbAttrParams } from "#abilities/ab-attrs";
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { MoveId } from "#enums/move-id";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";

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

/** The block test: the move is not the holder's own and is one of the weather-based moves. */
function blocksWeatherMove(pokemon: Pokemon, opponent: Pokemon, move: Move): boolean {
  return pokemon !== opponent && WEATHER_BASED_MOVES.has(move.id);
}

export class WeatherBasedMoveBlockAbAttr extends MoveImmunityAbAttr implements GatedAttr<MoveImmunityAbAttrParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: MoveImmunityAbAttrParams) => boolean) | undefined;

  constructor() {
    super(blocksWeatherMove);
  }

  override canApply(params: MoveImmunityAbAttrParams): boolean {
    return gatedCanApply<MoveImmunityAbAttrParams>(this, params);
  }

  /**
   * Tier B (ability studio spec 3.1), the old `canApply` in its old order. Clause 1 is the parent's: another ability already blocked
   * this move. Clause 2a (inside the old closure): a Pokemon never blocks its own move.
   */
  public guards({ cancelled, pokemon, opponent }: MoveImmunityAbAttrParams): boolean {
    return !cancelled.value && pokemon !== opponent;
  }

  /** Clause 2b, the replaceable condition: the move is one of the weather-based moves. */
  public gate({ move }: MoveImmunityAbAttrParams): boolean {
    return WEATHER_BASED_MOVES.has(move.id);
  }
}
