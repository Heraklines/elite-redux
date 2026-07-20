/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Greater Ability Randomizer - the Master-Ball-tier, pink reskin of the
// Ability Randomizer. It is Curiosity's REWARD half, simplified: the player
// picks ANY of the mon's ability/innate slots, is shown 4 RANDOM abilities (with
// their in-game descriptions) in the Bargain-styled picker, chooses one, and it
// REPLACES that slot. There is NO lock cost (Curiosity's cost half is dropped).
//
// The roll reuses the SAME pool + exclusions as the existing Ability Randomizer /
// Curiosity (via rollCuriosityAbilities with a count of 4). The replacement is
// run-state: a per-mon customPokemonData override (Pokemon.setAbilityOverrideForSlot,
// reused through bargainReplaceAbilitySlot) that persists for the run via the
// session save - NOT a permanent dex unlock.
// =============================================================================

import {
  type BargainAbilityChoice,
  bargainAbilityDescription,
  bargainReplaceAbilitySlot,
  rollCuriosityAbilities,
} from "#data/elite-redux/er-bargain-sins";
import { allAbilities } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import type { PlayerPokemon } from "#field/pokemon";

/** How many random abilities the Greater Ability Randomizer offers to choose from. */
export const GREATER_RANDOMIZER_ABILITY_CHOICES = 4;

/**
 * Roll {@linkcode GREATER_RANDOMIZER_ABILITY_CHOICES} (4) DISTINCT abilities for the
 * player to choose from, excluding the abilities the mon's slots already hold (so a
 * roll never offers a duplicate of a slot it could land in) plus any extra ids in
 * `exclude`. Reuses the Curiosity roller (same pool, same pure-downside exclusions),
 * just with a smaller count.
 */
export function rollGreaterRandomizerAbilities(
  pokemon: PlayerPokemon,
  exclude: Iterable<AbilityId> = [],
): BargainAbilityChoice[] {
  const present = pokemon.getAbilitySlots().map(s => s.ability.id);
  return rollCuriosityAbilities([...present, ...exclude], GREATER_RANDOMIZER_ABILITY_CHOICES);
}

/**
 * Reconstruct an authority-authored randomizer board without consuming RNG. Invalid, duplicate, excluded,
 * or already-present abilities are rejected so a malformed presentation can never open an unexecutable UI.
 */
export function resolveGreaterRandomizerAbilityIds(
  pokemon: PlayerPokemon,
  abilityIds: readonly number[],
): BargainAbilityChoice[] | null {
  const present = new Set(pokemon.getAbilitySlots().map(slot => slot.ability.id));
  if (
    abilityIds.length !== GREATER_RANDOMIZER_ABILITY_CHOICES
    || new Set(abilityIds).size !== abilityIds.length
    || abilityIds.some(
      id =>
        !Number.isSafeInteger(id)
        || id <= AbilityId.NONE
        || id === AbilityId.TRUANT
        || id === AbilityId.SLOW_START
        || present.has(id as AbilityId)
        || allAbilities[id] == null,
    )
  ) {
    return null;
  }
  return abilityIds.map(id => ({
    abilityId: id as AbilityId,
    name: allAbilities[id]?.name ?? "",
    description: bargainAbilityDescription(id as AbilityId),
  }));
}

/**
 * Write the player-chosen rolled ability into the chosen slot (ER index: 0 = active
 * ability, 1-3 = innate slots), reusing the same per-mon override path as the
 * existing Ability Randomizer + Curiosity ({@linkcode PlayerPokemon.setAbilityOverrideForSlot}
 * via {@linkcode bargainReplaceAbilitySlot}). Run-state only (customPokemonData),
 * never a permanent dex unlock.
 */
export function greaterRandomizerReplaceSlot(pokemon: PlayerPokemon, slot: number, abilityId: AbilityId): void {
  bargainReplaceAbilitySlot(pokemon, slot, abilityId);
}
