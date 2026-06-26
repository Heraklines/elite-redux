/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Ability Capsule - run-only innate unlock (maintainer request: "ability
// capsule should also be able to unlock an innate for the run if you want").
//
// The capsule's second option lets the player make one of a mon's currently
// LOCKED innate slots ACTIVE for THIS RUN ONLY. "Locked" here means "not yet
// usable" - the innate exists on the mon's slot but `canApplyAbility` currently
// returns false for it (no candy unlock, not free via Youngster/Daily/Shrine,
// not already run-unlocked). The run-unlock is the INVERSE of the Curiosity
// hard-lock: it stores the ER slot index on `customPokemonData.erRunUnlockedAbilitySlots`
// (run-scoped, serialized with the SESSION save - survives a mid-run reload),
// which is OR-ed into the candy gate in `Pokemon.canApplyAbility`. It NEVER
// writes the permanent candy unlock (`starterData[...].passiveAttr`), so the
// innate still reads LOCKED in starter-select and future runs.
//
// A Curiosity-locked slot (`erLockedAbilitySlots`) is never offered here, and
// even if it somehow were, the lock check in `canApplyAbility` runs first and
// wins, so a locked slot stays dead.
// =============================================================================

import type { Ability } from "#abilities/ability";
import type { PlayerPokemon } from "#field/pokemon";

/** One run-unlockable innate slot: the ER slot index (1-3) and the ability it holds. */
export interface ErRunUnlockableInnate {
  /** ER ability-slot index, matching {@linkcode PlayerPokemon.getAbilitySlots} (1-3 for innates). */
  slot: number;
  /** The {@linkcode Ability} currently occupying that innate slot. */
  ability: Ability;
}

/**
 * The innate slots (1-3) on `pokemon` that the Ability Capsule may run-unlock:
 * slots whose innate is present but currently NOT usable (gated by the candy
 * `passiveAttr` unlock and not already free/run-unlocked), and NOT Curiosity-
 * hard-locked. Computed via {@linkcode PlayerPokemon.canApplyAbility}: a slot is
 * "lockable for run-unlock" exactly when `canApplyAbility(true, slot - 1)` is
 * currently `false` while the slot still holds a real ability. The active ability
 * (slot 0) is never run-unlockable.
 */
export function erRunUnlockableInnateSlots(pokemon: PlayerPokemon): ErRunUnlockableInnate[] {
  const locked = pokemon.customPokemonData?.erLockedAbilitySlots ?? [];
  return pokemon
    .getAbilitySlots()
    .filter(({ slot }) => slot >= 1) // innate slots only; slot 0 is the active ability
    .filter(({ slot }) => !locked.includes(slot)) // never offer a Curiosity-locked slot
    .filter(({ slot }) => !pokemon.canApplyAbility(true, slot - 1)) // currently locked (candy-gated)
    .map(({ slot, ability }) => ({ slot, ability }));
}

/** Whether `pokemon` has at least one innate slot the capsule can run-unlock. */
export function erHasRunUnlockableInnate(pokemon: PlayerPokemon): boolean {
  return erRunUnlockableInnateSlots(pokemon).length > 0;
}

/**
 * Force-unlock the given innate slot for the REST OF THE RUN. `slot` is the ER
 * ability-slot index (1-3). Stored on `customPokemonData.erRunUnlockedAbilitySlots`
 * (run-scoped, serialized) - it makes the innate fire this run via the candy-gate
 * OR-in in {@linkcode PlayerPokemon.canApplyAbility} but NEVER touches the permanent
 * starterData passive unlock. No-op for slot 0 (the active ability is not an innate)
 * or a Curiosity-locked slot (the lock wins regardless).
 */
export function erRunUnlockAbilitySlot(pokemon: PlayerPokemon, slot: number): void {
  if (slot < 1) {
    return;
  }
  if (pokemon.customPokemonData.erLockedAbilitySlots?.includes(slot)) {
    return;
  }
  const unlocked = pokemon.customPokemonData.erRunUnlockedAbilitySlots;
  if (!unlocked.includes(slot)) {
    unlocked.push(slot);
  }
  pokemon.updateInfo();
}
