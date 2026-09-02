/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";

/** One shared charge/recharge allowance per entry, including composite holders. */
export function consumeCranisphereSkip(pokemon: Pokemon, move: Move): boolean {
  const state = pokemon.tempSummonData as unknown as { erCranisphereSkullBashUsed?: boolean };
  if (
    state.erCranisphereSkullBashUsed
    || move.type !== PokemonType.NORMAL
    || !move.checkFlag(MoveFlags.BONE_BASED, pokemon)
    || !pokemon.getAllActiveAbilityAttrs().some(attr => attr.constructor.name === "CranisphereSkullBashAbAttr")
  ) {
    return false;
  }
  state.erCranisphereSkullBashUsed = true;
  return true;
}
