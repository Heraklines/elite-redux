/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — bespoke ability `Quickening Grace` (Mega Xerneas).
//
// "Once per turn, the FIRST attacking two-turn charge move (Solar Beam / Fly /
// Dig class) selected by this Pokemon's ALLY executes immediately, skipping its
// charge turn." Does NOT affect:
//   - Geomancy and other STATUS charge moves (only damaging charge moves qualify),
//   - recharge moves (Hyper Beam class — those never enter `MoveChargePhase`; the
//     recharge is a post-attack tag, so they are naturally excluded here).
//
// Hooked from `MoveChargePhase.end()` — the same instant-charge resolution point
// Power Herb and ER Accelerate use. `erTryQuickeningGrace` returns whether the
// USER's charge should be skipped this turn; the caller sets its `instantCharge`.
// Once-per-turn is tracked per QG holder keyed on wave+turn (deterministic; no
// RNG; co-op safe).
// =============================================================================

import { AbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { MoveCategory } from "#enums/move-category";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import type { AbAttrBaseParams } from "#types/ability-types";

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_QUICKENING_GRACE_ABILITY_ID = 5913;

/** Marker attribute; the skip is applied by {@linkcode erTryQuickeningGrace}. */
export class QuickeningGraceAbAttr extends AbAttr {
  constructor() {
    super(false);
  }

  override apply(_params: AbAttrBaseParams): void {}
}

/** Per-holder record of the wave+turn key in which Quickening Grace last fired. */
const QUICKENING_GRACE_USED = new WeakMap<Pokemon, string>();

/** Stable identity for "this turn of this battle" (wave + turn number). */
function turnKey(): string {
  const battle = globalScene.currentBattle;
  return `${battle?.waveIndex ?? 0}:${battle?.turn ?? 0}`;
}

/** Whether a living, active pokemon carries an unsuppressed Quickening Grace. */
function hasQuickeningGrace(pokemon: Pokemon): boolean {
  return (
    pokemon.isActive(true)
    && pokemon.getAllActiveAbilityAttrs().some(a => a?.constructor?.name === "QuickeningGraceAbAttr")
  );
}

/**
 * Attempt to skip the charge turn of `user`'s two-turn move via an ally's
 * Quickening Grace. Returns `true` when the charge should fire immediately.
 *
 * Fires at most once per QG holder per turn, only for ATTACKING (non-status)
 * charge moves — Geomancy and other status charge moves never qualify.
 */
export function erTryQuickeningGrace(user: Pokemon | undefined, move: Move): boolean {
  if (!user) {
    return false;
  }
  // Only damaging charge moves qualify (Geomancy / status charge moves excluded).
  if (move.category === MoveCategory.STATUS) {
    return false;
  }
  const key = turnKey();
  for (const ally of user.getAllies()) {
    if (!hasQuickeningGrace(ally)) {
      continue;
    }
    if (QUICKENING_GRACE_USED.get(ally) === key) {
      continue;
    }
    QUICKENING_GRACE_USED.set(ally, key);
    globalScene.phaseManager.queueMessage(
      `${ally.getNameToRender()}'s Quickening Grace hastened ${user.getNameToRender()}'s move!`,
    );
    return true;
  }
  return false;
}
