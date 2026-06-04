/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — scripted-move helper.
//
// Several ER abilities script a move at a REDUCED base power (e.g. Phantom
// Thief "40 BP Spectral Thief", Sand Pit "20 BP Sand Tomb", Frost Burn "40 BP
// Ice Beam"). The registered moves carry their full vanilla power, and the
// scripted-move primitives previously cast them at that full power — an
// unfaithful balance bug.
//
// `scriptedPokemonMove(moveId, power?)` returns a {@linkcode PokemonMove} the
// scripted-move primitives hand to `MovePhase`. With no `power` it is a plain
// PokemonMove (full power). With a `power` it returns a subclass whose
// `getMove()` yields a shallow CLONE of the registered move with `power`
// overridden — so the cast deals the ER-specified power while keeping the real
// move's type, target, attrs, animation, and name. Nothing global is mutated.
//
// The clone is built lazily on first `getMove()` (battle time), not at
// construction, because ability attrs are built during init BEFORE ER-custom
// moves are registered — a construction-time `allMoves[id]` read could be
// undefined for a custom scripted move.
// =============================================================================

import { PokemonMove } from "#data/moves/pokemon-move";
import type { MoveId } from "#enums/move-id";
import type { Move } from "#moves/move";

class PowerOverriddenPokemonMove extends PokemonMove {
  private readonly power: number | undefined;
  private readonly alwaysHit: boolean;
  private cached: Move | undefined;

  constructor(moveId: MoveId, power: number | undefined, alwaysHit: boolean) {
    super(moveId);
    this.power = power;
    this.alwaysHit = alwaysHit;
  }

  public override getMove(): Move {
    if (this.cached === undefined) {
      const base = super.getMove();
      // Shallow-clone the registered Move: preserve its prototype (so methods
      // work) and copy own fields. `attrs`/`conditions` are shared by reference
      // — they're read-only during move execution — and only `power`/`accuracy`
      // are overridden. `calculateBattlePower` seeds the holder with
      // `this.power`, so the override takes effect for this cast alone.
      const clone = Object.assign(Object.create(Object.getPrototypeOf(base)), base) as Move;
      if (this.power !== undefined) {
        (clone as unknown as { power: number }).power = this.power;
      }
      if (this.alwaysHit) {
        // accuracy -1 = "bypasses the accuracy check" (Swift/Aerial Ace style).
        (clone as unknown as { accuracy: number }).accuracy = -1;
      }
      this.cached = clone;
    }
    return this.cached;
  }
}

/**
 * Build the {@linkcode PokemonMove} a scripted-move ability casts.
 *
 * @param moveId - the move to cast.
 * @param power - optional ER-specified base power override. Omit to use the
 *   move's registered (full) power.
 * @param opts.alwaysHit - when true, the cast bypasses the accuracy check
 *   (accuracy -1) — e.g. Retribution Blow's Hyper Beam "cannot miss".
 */
export function scriptedPokemonMove(moveId: MoveId, power?: number, opts?: { alwaysHit?: boolean }): PokemonMove {
  const alwaysHit = opts?.alwaysHit ?? false;
  return power === undefined && !alwaysHit
    ? new PokemonMove(moveId)
    : new PowerOverriddenPokemonMove(moveId, power, alwaysHit);
}
