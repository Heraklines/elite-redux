/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — 3-slot passive (innate) bitmask helpers.
//
// `passiveAttr` (stored on gameData.starterData[rootSpeciesId]) is a 6-bit mask
// holding the unlock + enable state of each of the 3 innate slots:
//   slot 0: UNLOCKED_1 | ENABLED_1   (aliases UNLOCKED/ENABLED — back-compat)
//   slot 1: UNLOCKED_2 | ENABLED_2
//   slot 2: UNLOCKED_3 | ENABLED_3
//
// These helpers are the single source of truth for "is this innate slot active
// for the player". They live in utils (not the starter-select UI handler) so
// the field layer (pokemon.ts) can consult them at battle time without a
// circular import. starter-select-ui-handler re-exports them for back-compat.
// =============================================================================

import { Passive as PassiveAttr } from "#enums/passive";

/** Slot index into the 3-passive bitmask. */
export type PassiveSlot = 0 | 1 | 2;

/** Static metadata for the 3 passive slots: bit positions + cost multiplier. */
export const PASSIVE_SLOTS = [
  { unlocked: PassiveAttr.UNLOCKED_1, enabled: PassiveAttr.ENABLED_1, costMultiplier: 1 },
  { unlocked: PassiveAttr.UNLOCKED_2, enabled: PassiveAttr.ENABLED_2, costMultiplier: 2 },
  { unlocked: PassiveAttr.UNLOCKED_3, enabled: PassiveAttr.ENABLED_3, costMultiplier: 4 },
] as const;

/** True if the given passive slot is unlocked in `passiveAttr`. */
export function isSlotUnlocked(passiveAttr: number, slot: PassiveSlot): boolean {
  return (passiveAttr & PASSIVE_SLOTS[slot].unlocked) !== 0;
}

/** True if the given passive slot is enabled in `passiveAttr`. */
export function isSlotEnabled(passiveAttr: number, slot: PassiveSlot): boolean {
  return (passiveAttr & PASSIVE_SLOTS[slot].enabled) !== 0;
}

/** True if the given passive slot is both unlocked AND enabled (i.e. active). */
export function isSlotActive(passiveAttr: number, slot: PassiveSlot): boolean {
  return isSlotUnlocked(passiveAttr, slot) && isSlotEnabled(passiveAttr, slot);
}

/** True if ANY of the 3 passive slots is active. */
export function hasAnyActiveSlot(passiveAttr: number): boolean {
  return isSlotActive(passiveAttr, 0) || isSlotActive(passiveAttr, 1) || isSlotActive(passiveAttr, 2);
}

/** Return `passiveAttr` with the given slot's enabled bit flipped. */
export function toggleSlotEnabled(passiveAttr: number, slot: PassiveSlot): number {
  return passiveAttr ^ PASSIVE_SLOTS[slot].enabled;
}

/** Return `passiveAttr` with the given slot's unlocked AND enabled bits set. */
export function unlockSlot(passiveAttr: number, slot: PassiveSlot): number {
  return passiveAttr | PASSIVE_SLOTS[slot].unlocked | PASSIVE_SLOTS[slot].enabled;
}

/** Result of {@linkcode planMassUnlock} for a single species. */
export interface MassUnlockPlan {
  /** The resulting `passiveAttr` after buying every affordable locked slot. */
  passiveAttr: number;
  /** Total candy spent. */
  candySpent: number;
  /** How many innate slots were newly unlocked. */
  unlocked: number;
}

/**
 * Plan a "unlock every affordable innate, cheapest-first" purchase for ONE
 * species (the mass-unlock feature). Pure + deterministic so it can be unit
 * tested and run in a tight staggered loop over every caught species without
 * touching UI/game state.
 *
 * Only LOCKED slots that hold a real ability (`hasAbility(slot)` true) are
 * considered; among those, the cheapest are bought first to maximise the number
 * of unlocks for the available candy.
 *
 * @param passiveAttr  - the species' current passive bitmask
 * @param candyCount   - candy available to spend
 * @param costForSlot  - per-slot candy cost (e.g. getErPassiveSlotCandyCost)
 * @param hasAbility   - whether the slot has a real (non-NONE) innate
 */
export function planMassUnlock(
  passiveAttr: number,
  candyCount: number,
  costForSlot: (slot: PassiveSlot) => number,
  hasAbility: (slot: PassiveSlot) => boolean,
): MassUnlockPlan {
  const candidates = ([0, 1, 2] as PassiveSlot[])
    .filter(slot => hasAbility(slot) && !isSlotUnlocked(passiveAttr, slot))
    .map(slot => ({ slot, cost: costForSlot(slot) }))
    .sort((a, b) => a.cost - b.cost);

  let attr = passiveAttr;
  let candy = candyCount;
  let candySpent = 0;
  let unlocked = 0;
  for (const { slot, cost } of candidates) {
    if (candy >= cost) {
      attr = unlockSlot(attr, slot);
      candy -= cost;
      candySpent += cost;
      unlocked++;
    }
  }
  return { passiveAttr: attr, candySpent, unlocked };
}
