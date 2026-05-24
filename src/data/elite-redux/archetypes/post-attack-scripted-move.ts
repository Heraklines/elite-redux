/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-attack-scripted-move` archetype.
//
// PostAttack hook: after the holder uses a qualifying move, enqueue a
// scripted follow-up move (in MoveUseMode.INDIRECT). Mirrors the existing
// CounterAttackOnHitAbAttr (which fires on DEFEND) but on the offensive
// surface — i.e. "after the holder ATTACKS, also do X".
//
// Wires:
//   - 491 Aftershock — "Triggers Magnitude after using a damaging move"
//   - 876 Sludge Spit — "follows up with 35BP Venom Bolt after using an attack"
//   - 993 Thunder Clouds — "After using a special move, launch 35BP Thunderbolt"
//   - 999 Sand Spear (and similar) when they need offensive follow-ups
//
// Optional category filter so abilities like Thunder Clouds (which trigger
// only on SPECIAL moves) can gate themselves.
// =============================================================================

import { PostAttackAbAttr } from "#abilities/ab-attrs";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";
import { globalScene } from "#app/global-scene";
import { PokemonMove } from "#data/moves/pokemon-move";
import type { MoveFlags } from "#enums/move-flags";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import type { PokemonType } from "#enums/pokemon-type";

export interface PostAttackScriptedMoveOptions {
  /** Move id to enqueue after the holder's attack lands. */
  readonly moveId: MoveId;
  /** Optional gate — only fire when the holder's move matches this category. */
  readonly categoryFilter?: MoveCategory;
  /**
   * Optional gate — only fire when the holder's move is one of these types.
   * E.g. `[PokemonType.FIRE]` for Volcano Rage's "after Fire-type move" trigger.
   */
  readonly typeFilter?: readonly PokemonType[];
  /**
   * Optional gate — only fire when the holder's move has this flag set
   * (e.g. `MoveFlags.DANCE_MOVE` for "after dance move" triggers).
   */
  readonly flagFilter?: MoveFlags;
}

export class PostAttackScriptedMoveAbAttr extends PostAttackAbAttr {
  constructor(private readonly opts: PostAttackScriptedMoveOptions) {
    super(undefined, false);
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { move, opponent } = params;
    if (!opponent || opponent.isFainted()) {
      return false;
    }
    if (this.opts.categoryFilter !== undefined && move.category !== this.opts.categoryFilter) {
      return false;
    }
    if (this.opts.typeFilter !== undefined && !this.opts.typeFilter.includes(move.type)) {
      return false;
    }
    if (this.opts.flagFilter !== undefined && !move.hasFlag(this.opts.flagFilter)) {
      return false;
    }
    return true;
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    const { pokemon, opponent, simulated } = params;
    if (simulated || !opponent) {
      return;
    }
    globalScene.phaseManager.unshiftNew(
      "MovePhase",
      pokemon,
      [opponent.getBattlerIndex()],
      new PokemonMove(this.opts.moveId),
      MoveUseMode.INDIRECT,
    );
  }
}
