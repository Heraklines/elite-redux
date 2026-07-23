/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-weather-move-follow-up` archetype.
//
// PostMoveUsed hook (the same surface Dancer uses): after the HOLDER itself
// uses a weather-SETTING move (a move carrying `WeatherChangeAttr` — Sunny Day,
// Rain Dance, Sandstorm, Snowscape, …), enqueue a scripted follow-up move at a
// foe. The follow-up is cast in `MoveUseMode.INDIRECT` with
// `MovePhaseTimingModifier.FIRST`, so it resolves right after the weather-set
// move's MoveEffectPhase (the weather is already up).
//
// Wires:
//   - 59 Forecast — after a weather-setting move, follow up with a 100 BP
//     Weather Ball (Weather Ball auto-doubles to 100 BP and takes the active
//     weather's type once the weather is set).
// =============================================================================

import { PostMoveUsedAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { PokemonMove } from "#data/moves/pokemon-move";
import type { MoveId } from "#enums/move-id";
import { MovePhaseTimingModifier } from "#enums/move-phase-timing-modifier";
import { MoveUseMode } from "#enums/move-use-mode";
import type { PostMoveUsedAbAttrParams } from "#types/ability-types";

export class PostWeatherMoveFollowUpAbAttr extends PostMoveUsedAbAttr {
  constructor(private readonly followUpMoveId: MoveId) {
    // showAbility = true (default): the weather-triggered follow-up move is a
    // discrete, player-visible activation, so the ability banner must flash
    // (same popup-display defect class as the counter-attack archetype).
    super();
  }

  /** Read-only accessor for the follow-up move id (used in tests). */
  public getFollowUpMoveId(): MoveId {
    return this.followUpMoveId;
  }

  override canApply({ source, pokemon, move }: PostMoveUsedAbAttrParams): boolean {
    // Only when the HOLDER itself used a weather-SETTING move, and a living foe
    // remains for the follow-up to hit.
    return (
      source.getBattlerIndex() === pokemon.getBattlerIndex()
      && move.getMove().hasAttr("WeatherChangeAttr")
      && pokemon.getOpponents().some(o => !o.isFainted())
    );
  }

  override apply({ pokemon, simulated }: PostMoveUsedAbAttrParams): void {
    if (simulated) {
      return;
    }
    const foes = pokemon.getOpponents().filter(o => !o.isFainted());
    if (foes.length === 0) {
      return;
    }
    globalScene.phaseManager.unshiftNew(
      "MovePhase",
      pokemon,
      [foes[0].getBattlerIndex()],
      new PokemonMove(this.followUpMoveId),
      MoveUseMode.INDIRECT,
      MovePhaseTimingModifier.FIRST,
    );
  }
}
