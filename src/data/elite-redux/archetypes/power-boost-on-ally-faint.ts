/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `power-boost-on-ally-faint` archetype.
//
// "Avenger boosts the power of ALL of the holder's moves by 50% for one turn
// after any party Pokemon faints."
//
// Implemented as three cooperating attrs sharing a per-holder Symbol timer:
//   1. AllyFaintPowerBoostTriggerAbAttr (PostKnockOut, ally-only) arms the
//      timer (TURNS = 2) when a teammate is KO'd.
//   2. AllyFaintPowerBoostAbAttr (MovePowerBoost) multiplies move power by the
//      factor while the timer is active.
//   3. AllyFaintPowerBoostExpireAbAttr (PostTurn) decrements the timer each
//      turn end, so the boost survives exactly through the turn following the
//      faint.
//
// Engine note: PostKnockOut only fires for on-field holders, so (like every
// "ally faint" ER ability) this is reliable in doubles and for the
// faint-while-holder-is-out case; a benched teammate fainting can't be observed
// by the engine.
//
// Wires:
//   - 292 Avenger — "If a party Pokemon fainted last turn, next move gets 1.5x."
// =============================================================================

import {
  type AbAttrBaseParams,
  MovePowerBoostAbAttr,
  PostKnockOutAbAttr,
  type PostKnockOutAbAttrParams,
  PostTurnAbAttr,
} from "#abilities/ab-attrs";
import type { Pokemon } from "#field/pokemon";

const TURNS = Symbol("PowerBoostOnAllyFaint.turns");

const isActive = (pokemon: Pokemon): boolean => ((pokemon as unknown as Record<symbol, number>)[TURNS] ?? 0) > 0;

export class AllyFaintPowerBoostTriggerAbAttr extends PostKnockOutAbAttr {
  override canApply({ pokemon, victim }: PostKnockOutAbAttrParams): boolean {
    return victim.id !== pokemon.id && victim.isPlayer() === pokemon.isPlayer();
  }

  override apply({ pokemon, simulated }: PostKnockOutAbAttrParams): void {
    if (simulated) {
      return;
    }
    // 2 ticks: this turn's remainder + the full following turn.
    (pokemon as unknown as Record<symbol, number>)[TURNS] = 2;
  }
}

export class AllyFaintPowerBoostAbAttr extends MovePowerBoostAbAttr {
  constructor(factor = 1.5) {
    super(user => isActive(user), factor, true);
  }
}

export class AllyFaintPowerBoostExpireAbAttr extends PostTurnAbAttr {
  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    return isActive(pokemon);
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const store = pokemon as unknown as Record<symbol, number>;
    store[TURNS] = Math.max(0, (store[TURNS] ?? 0) - 1);
  }

  /** Test helper: remaining boosted turns for this holder. */
  public turnsRemaining(pokemon: Pokemon): number {
    return (pokemon as unknown as Record<symbol, number>)[TURNS] ?? 0;
  }
}

/** Test helper: whether the one-turn boost is currently active for a holder. */
export const isAvengerBoostActive = isActive;
