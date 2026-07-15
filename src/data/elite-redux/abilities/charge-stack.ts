/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — CHARGE STACK state primitive (Batch 3 charge-stacking trio).
//
// Reuses the concept of vanilla CHARGED (the one-use `TypeBoostTag` that doubles
// the next Electric move — see `battler-tags.ts` `BattlerTagType.CHARGED`), but
// generalizes it into a STACKING counter this holder alone can build up to 4.
// The vanilla CHARGED tag does not stack (it is a single 2x-Electric one-use
// boost), so the stacking counter is a bespoke store keyed on the holder; the
// ability logic (Capacitor Bank / Fault Current / Overloaded) lives in
// `electivire.ts` and drives this store.
//
// Also tracks a per-holder "consecutive active turns" counter (Fault Current's
// every-2nd-turn discharge), which RESETS on switch-out.
// =============================================================================

import type { Pokemon } from "#field/pokemon";

/** Maximum charge stacks the Electivire holder can hold. */
export const CHARGE_STACK_MAX = 4;

const CHARGE = new WeakMap<Pokemon, number>();
const ACTIVE_TURNS = new WeakMap<Pokemon, number>();

/** Current charge stacks on `pokemon` (0 when unset). */
export function getCharge(pokemon: Pokemon): number {
  return CHARGE.get(pokemon) ?? 0;
}

/** Add `amount` stacks (default 1), clamped to {@linkcode CHARGE_STACK_MAX}. Returns the new total. */
export function addCharge(pokemon: Pokemon, amount = 1): number {
  const next = Math.min(CHARGE_STACK_MAX, getCharge(pokemon) + amount);
  CHARGE.set(pokemon, next);
  return next;
}

/** Consume `amount` stacks (default 1), floored at 0. Returns the number actually consumed. */
export function consumeCharge(pokemon: Pokemon, amount = 1): number {
  const have = getCharge(pokemon);
  const spent = Math.min(have, amount);
  CHARGE.set(pokemon, have - spent);
  return spent;
}

/** Set the charge total directly (used by the discharge). */
export function setCharge(pokemon: Pokemon, value: number): void {
  CHARGE.set(pokemon, Math.max(0, Math.min(CHARGE_STACK_MAX, value)));
}

/** Clear all charge on `pokemon`. */
export function clearCharge(pokemon: Pokemon): void {
  CHARGE.delete(pokemon);
}

/** Consecutive active turns the holder has remained on the field (0 when unset). */
export function getActiveTurns(pokemon: Pokemon): number {
  return ACTIVE_TURNS.get(pokemon) ?? 0;
}

/** Increment the holder's consecutive-active-turn counter. Returns the new value. */
export function incrementActiveTurns(pokemon: Pokemon): number {
  const next = getActiveTurns(pokemon) + 1;
  ACTIVE_TURNS.set(pokemon, next);
  return next;
}

/** Reset the holder's consecutive-active-turn counter (on switch-out). */
export function resetActiveTurns(pokemon: Pokemon): void {
  ACTIVE_TURNS.delete(pokemon);
}
