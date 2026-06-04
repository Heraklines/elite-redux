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
