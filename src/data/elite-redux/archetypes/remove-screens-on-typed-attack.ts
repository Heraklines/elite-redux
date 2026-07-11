/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `remove-screens-on-typed-attack` primitive.
//
// PostAttack hook that BREAKS the target side's screens (Reflect / Light Screen
// / Aurora Veil) when the holder lands a move of a configured type — the
// ability-side analogue of Brick Break's `RemoveScreensAttr`. Any holder-side
// gate (e.g. "only while the holder is Fighting-type") is layered on at the
// wiring site via `addCondition`.
//
// Wires:
//   - 762 Qigong — "If the user is Fighting-type their Fighting-type moves break
//     screens." (post-processing block, gated on holder.isOfType(FIGHTING).)
// =============================================================================

import { PostAttackAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import type { PokemonType } from "#enums/pokemon-type";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";

const SCREEN_TAGS = [ArenaTagType.REFLECT, ArenaTagType.LIGHT_SCREEN, ArenaTagType.AURORA_VEIL] as const;

export interface RemoveScreensOnTypedAttackOptions {
  /** Only fires when the holder's move resolves to this type. */
  readonly type: PokemonType;
}

/**
 * When the holder lands a damaging move of {@linkcode type}, remove the target
 * side's screen arena tags (Reflect / Light Screen / Aurora Veil).
 */
export class RemoveScreensOnTypedAttackAbAttr extends PostAttackAbAttr {
  private readonly moveType: PokemonType;

  constructor(options: RemoveScreensOnTypedAttackOptions) {
    // Default attackCondition (damaging move) + don't flash the ability banner.
    super(undefined, false);
    this.moveType = options.type;
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    if (!super.canApply(params)) {
      return false;
    }
    const { move, pokemon, opponent } = params;
    if (!opponent) {
      return false;
    }
    return pokemon.getMoveType(move) === this.moveType;
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    const { opponent, simulated } = params;
    if (simulated || !opponent) {
      return;
    }
    const targetSide = opponent.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
    globalScene.arena.removeTagsOnSide([...SCREEN_TAGS], targetSide);
  }
}
