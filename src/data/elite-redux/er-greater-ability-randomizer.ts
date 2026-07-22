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
  bargainReplaceAbilitySlot,
  rollCuriosityAbilities,
} from "#data/elite-redux/er-bargain-sins";
import type { AbilityId } from "#enums/ability-id";
import type { PlayerPokemon } from "#field/pokemon";

/** How many random abilities the Greater Ability Randomizer offers to choose from. */
export const GREATER_RANDOMIZER_ABILITY_CHOICES = 4;

/**
 * Rolls already shown for one Greater Ability Randomizer reward offer, keyed by
 * the target Pokemon's run-local id. The reward-screen continuation copies share
 * this map so leaving the item entirely and re-entering it cannot reroll the menu.
 */
export type GreaterAbilityRandomizerChoiceCache = Map<number, BargainAbilityChoice[]>;

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

/** Return the roll already shown for this offer/target, or create it exactly once. */
export function getOrRollGreaterRandomizerAbilities(
  pokemon: PlayerPokemon,
  cache: GreaterAbilityRandomizerChoiceCache,
): BargainAbilityChoice[] {
  const cached = cache.get(pokemon.id);
  if (cached != null) {
    return cached;
  }

  const choices = rollGreaterRandomizerAbilities(pokemon);
  cache.set(pokemon.id, choices);
  return choices;
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
