/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Pokemon } from "#field/pokemon";
import { PokemonHeldItemModifier } from "#modifiers/modifier";
import { PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import type { HeldModifierConfig } from "#types/held-modifier-config";

export function materializeHeldModifierConfig(
  config: HeldModifierConfig | null | undefined,
  pokemon: Pokemon,
): PokemonHeldItemModifier | null {
  if (!config?.modifier) {
    return null;
  }

  const modifier =
    config.modifier instanceof PokemonHeldItemModifierType ? config.modifier.newModifier(pokemon) : config.modifier;
  if (!(modifier instanceof PokemonHeldItemModifier)) {
    return null;
  }

  modifier.pokemonId = pokemon.id;
  modifier.stackCount = config.stackCount ?? 1;
  modifier.isTransferable = config.isTransferable ?? modifier.isTransferable;
  return modifier;
}
