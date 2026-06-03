/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-turn-random-type` primitive.
//
// At the end of each turn the holder's typing is replaced by a single random
// "pure" type. Used by Color Spectrum 700 ("The user changes to a random Pure
// type at the start of every turn") alongside the STAB +20% boost. Writing at
// end-of-turn means the new type is in effect for the following turn's moves,
// which is functionally the per-turn rotation the description calls for.
//
// The chosen type is one of the 18 real types (NORMAL..FAIRY); UNKNOWN (-1) and
// STELLAR are excluded. The override is written to `summonData.types`, the same
// per-battle type slot used by `add-self-type` / Protean-style changes.
// =============================================================================

import { PostTurnAbAttr } from "#abilities/ab-attrs";
import { PokemonType } from "#enums/pokemon-type";
import type { AbAttrBaseParams } from "#types/ability-types";

export class PostTurnRandomPureTypeAbAttr extends PostTurnAbAttr {
  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    return !pokemon.isFainted();
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    // Real types are NORMAL (0) .. FAIRY (17); randBattleSeedInt(n) yields [0, n).
    const newType = pokemon.randBattleSeedInt(PokemonType.FAIRY + 1) as PokemonType;
    pokemon.summonData.types = [newType];
  }
}
