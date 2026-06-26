/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Greater Ability Capsule - the rarer, stronger Ability Capsule (a violet
// reskin). On use the player chooses ONE of:
//
//   (A) PERMANENTLY unlock ONE innate slot. This writes the REAL permanent
//       (candy-style) innate unlock into gameData.starterData[root].passiveAttr,
//       so the innate stays unlocked in starter-select AND future runs - exactly
//       the write the Innate Shrine's `attune()` and the candy "unlock innate"
//       purchase perform (`unlockSlot` sets the slot's UNLOCKED + ENABLED bits,
//       then saveSystem() persists it). This is the precedent the normal capsule
//       set for a PERMANENT unlock (it writes a dex `abilityAttr` bit for the
//       PRIMARY ability); the innate unlock is the per-innate-slot equivalent.
//
//   (B) RUN-unlock TWO innate slots. This is exactly the normal Ability Capsule's
//       run-unlock (erRunUnlockAbilitySlot -> erRunUnlockedAbilitySlots, run-only,
//       serialized with the SESSION save, never the permanent starterData unlock),
//       but applied to TWO slots instead of one.
//
// The ER ability-slot index is 0 for the active ability and 1-3 for the innate
// slots (matching PlayerPokemon.getAbilitySlots). The permanent passiveAttr
// bitmask is keyed by the 0-2 passive slot, so an ER innate slot `slot` maps to
// passive slot `slot - 1`.
// =============================================================================

import { globalScene } from "#app/global-scene";
import {
  erRunUnlockableInnateSlots,
  erRunUnlockAbilitySlot,
  type ErRunUnlockableInnate,
} from "#data/elite-redux/er-ability-capsule";
import type { PlayerPokemon } from "#field/pokemon";
import { isSlotUnlocked, type PassiveSlot, unlockSlot } from "#utils/passive-utils";

/** Minimum run-unlockable innate slots needed for option (B) "run-unlock two innates". */
export const GREATER_CAPSULE_RUN_UNLOCK_COUNT = 2;

/**
 * The innate slots (ER index 1-3) on `pokemon` that the Greater Capsule may act on:
 * the same currently-LOCKED, non-Curiosity-locked innate slots the normal capsule
 * offers for its run-unlock (see {@linkcode erRunUnlockableInnateSlots}). Both the
 * permanent unlock (A) and the run-unlock (B) draw from this set - a slot that is
 * already permanently unlocked / free / run-unlocked is not offered.
 */
export function greaterCapsuleUnlockableInnateSlots(pokemon: PlayerPokemon): ErRunUnlockableInnate[] {
  return erRunUnlockableInnateSlots(pokemon);
}

/** Whether option (A) "permanently unlock one innate" is available for `pokemon`. */
export function greaterCapsuleCanPermanentlyUnlock(pokemon: PlayerPokemon): boolean {
  return greaterCapsuleUnlockableInnateSlots(pokemon).length >= 1;
}

/** Whether option (B) "run-unlock two innates" is available for `pokemon`. */
export function greaterCapsuleCanRunUnlockTwo(pokemon: PlayerPokemon): boolean {
  return greaterCapsuleUnlockableInnateSlots(pokemon).length >= GREATER_CAPSULE_RUN_UNLOCK_COUNT;
}

/** Whether the Greater Capsule can do ANYTHING for `pokemon` (at least one option). */
export function greaterCapsuleHasAnyOption(pokemon: PlayerPokemon): boolean {
  return greaterCapsuleCanPermanentlyUnlock(pokemon);
}

/**
 * The species that OWNS innate `slot`'s permanent unlock. For a fusion the innate
 * slots 0 and 2 (ER slots 1 and 3) belong to the FUSION species and slot 1 (ER
 * slot 2) to the base - mirroring {@linkcode PlayerPokemon.innateSlotPassiveAttr}
 * / `getAbilitySlotOwner` - so the unlock must be written to the species that owns
 * it. For a non-fusion every slot uses the base species.
 */
function permanentUnlockOwnerRootId(pokemon: PlayerPokemon, passiveSlot: PassiveSlot): number {
  const owner =
    pokemon.isFusion() && pokemon.fusionSpecies && (passiveSlot === 0 || passiveSlot === 2)
      ? pokemon.fusionSpecies
      : pokemon.species;
  return owner.getRootSpeciesId();
}

/**
 * Option (A): PERMANENTLY unlock the given innate slot (ER index 1-3) for the
 * species that owns it. Sets the slot's UNLOCKED + ENABLED bits in that species'
 * `starterData.passiveAttr` and persists the account save - identical to the
 * Innate Shrine's permanent attune write and the candy "unlock innate" purchase,
 * so the innate reads UNLOCKED in starter-select and starts unlocked in every
 * future run. No-op for the active slot (0) or an already-unlocked slot.
 *
 * @returns the resulting `passiveAttr`, or `null` if nothing was written.
 */
export function greaterCapsulePermanentlyUnlockInnate(pokemon: PlayerPokemon, slot: number): number | null {
  if (slot < 1 || slot > 3) {
    return null;
  }
  const passiveSlot = (slot - 1) as PassiveSlot;
  const rootId = permanentUnlockOwnerRootId(pokemon, passiveSlot);
  const starterData = globalScene.gameData.starterData[rootId];
  if (!starterData) {
    return null;
  }
  if (isSlotUnlocked(starterData.passiveAttr, passiveSlot)) {
    // Already permanently unlocked - nothing to write (and the modifier-type
    // filter / picker should not have offered it).
    return null;
  }
  starterData.passiveAttr = unlockSlot(starterData.passiveAttr, passiveSlot);
  void globalScene.gameData.saveSystem();
  pokemon.updateInfo();
  return starterData.passiveAttr;
}

/**
 * Option (B): RUN-unlock the given innate slots for THIS RUN ONLY, reusing the
 * normal Ability Capsule's per-slot run-unlock ({@linkcode erRunUnlockAbilitySlot}
 * -> `erRunUnlockedAbilitySlots`). Run-scoped, serialized with the session save,
 * NEVER the permanent starterData unlock - so the innates still read LOCKED in
 * starter-select and future runs.
 */
export function greaterCapsuleRunUnlockInnates(pokemon: PlayerPokemon, slots: readonly number[]): void {
  for (const slot of slots) {
    erRunUnlockAbilitySlot(pokemon, slot);
  }
}
