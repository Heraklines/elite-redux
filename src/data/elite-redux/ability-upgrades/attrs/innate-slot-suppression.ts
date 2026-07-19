/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Pokemon } from "#field/pokemon";

export type InnateSlot = 0 | 1 | 2;

const SUPPRESSED_INNATE_SLOTS = new WeakMap<object, Set<InnateSlot>>();

/** Disable one innate slot for the lifetime of the current summon data. */
export function suppressInnateSlotUntilSwitch(pokemon: Pokemon, slot: InnateSlot): void {
  const summonData = pokemon.summonData;
  let slots = SUPPRESSED_INNATE_SLOTS.get(summonData);
  if (!slots) {
    slots = new Set<InnateSlot>();
    SUPPRESSED_INNATE_SLOTS.set(summonData, slots);
  }
  slots.add(slot);
}

/** Whether an innate slot is disabled until the holder next switches out. */
export function isInnateSlotSuppressed(pokemon: Pokemon, slot: InnateSlot): boolean {
  return SUPPRESSED_INNATE_SLOTS.get(pokemon.summonData)?.has(slot) ?? false;
}
