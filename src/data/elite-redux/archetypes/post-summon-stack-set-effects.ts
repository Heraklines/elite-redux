/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-summon-stack-set-effects` archetype.
//
// PostSummon hook that applies BOTH a terrain AND a side-buff (Tailwind /
// Trick Room / Light Screen / Reflect / Safeguard / Mist / etc.) in one
// shot. Mirrors Surge Surfer / Grassy Surge but also stacks an Arena Tag.
//
// Wires:
//   - 833 Harukaze — "Setting Grassy Terrain sets Tailwind and vice versa."
//     Approximation: post-summon set Grassy Terrain + Tailwind tag.
// =============================================================================

import { type AbAttrBaseParams, PostSummonAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import type { TerrainType } from "#data/terrain";
import { ArenaTagSide } from "#enums/arena-tag-side";
import type { ArenaTagType } from "#enums/arena-tag-type";

export interface PostSummonStackSetEffectsOptions {
  /** Terrain to set on summon (optional). */
  readonly terrain?: TerrainType;
  /**
   * Arena tags to apply (optional). `side` is HOLDER-RELATIVE, resolved at apply
   * time: `PLAYER` = the holder's OWN side, `ENEMY` = the opposing side, `BOTH` =
   * both sides. This is critical for side-scoped self-buffs (Tailwind / Light
   * Screen / Reflect / Safeguard / Mist): passing an ABSOLUTE side would leak the
   * buff to the enemy when the holder is on the enemy team (or, with `BOTH`, always
   * — the Gale Bloom/Harukaze both-sides-Tailwind bug, #194 class).
   */
  readonly tags?: ReadonlyArray<{ type: ArenaTagType; turns: number; side: ArenaTagSide }>;
}

export class PostSummonStackSetEffectsAbAttr extends PostSummonAbAttr {
  constructor(private readonly opts: PostSummonStackSetEffectsOptions) {
    super(true);
  }

  override canApply(_params: AbAttrBaseParams): boolean {
    return true;
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    if (this.opts.terrain !== undefined) {
      globalScene.arena.trySetTerrain(this.opts.terrain, false);
    }
    // Resolve each tag's side RELATIVE to the holder so a side-scoped buff
    // (Tailwind) lands on the holder's own side only - never leaks to the enemy.
    const holderSide = pokemon.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
    const foeSide = pokemon.isPlayer() ? ArenaTagSide.ENEMY : ArenaTagSide.PLAYER;
    for (const tag of this.opts.tags ?? []) {
      const side =
        tag.side === ArenaTagSide.BOTH ? ArenaTagSide.BOTH : tag.side === ArenaTagSide.PLAYER ? holderSide : foeSide;
      globalScene.arena.addTag(tag.type, tag.turns, undefined, pokemon.id, side);
    }
  }
}
