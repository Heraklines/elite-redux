/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `typed-immunity-with-arena-tag` archetype.
//
// PreDefend hook: holder is immune to attacks of the configured type, AND
// when triggered, sets an arena tag on the holder's side (e.g. Mist).
//
// Wires:
//   - 444 Evaporate — "Takes no damage and sets Mist if hit by water."
//     (immuneType: WATER, arenaTag: MIST.)
// =============================================================================

import { PreDefendAbAttr, type TypeMultiplierAbAttrParams } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { ArenaTagSide } from "#enums/arena-tag-side";
import type { ArenaTagType } from "#enums/arena-tag-type";
import type { PokemonType } from "#enums/pokemon-type";

export interface TypedImmunityWithArenaTagOptions {
  readonly immuneType: PokemonType;
  readonly arenaTag: ArenaTagType;
  readonly turns: number;
}

export class TypedImmunityWithArenaTagAbAttr extends PreDefendAbAttr {
  constructor(private readonly opts: TypedImmunityWithArenaTagOptions) {
    super(true);
  }

  override canApply(params: TypeMultiplierAbAttrParams): boolean {
    const { move, opponent, pokemon } = params;
    if (opponent === pokemon || !move.is("AttackMove")) {
      return false;
    }
    return opponent.getMoveType(move) === this.opts.immuneType;
  }

  override apply(params: TypeMultiplierAbAttrParams): void {
    const { pokemon, typeMultiplier, cancelled, simulated } = params;
    typeMultiplier.value = 0;
    cancelled.value = true;
    if (simulated) {
      return;
    }
    const side = pokemon.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
    globalScene.arena.addTag(this.opts.arenaTag, this.opts.turns, undefined, pokemon.id, side);
  }
}
