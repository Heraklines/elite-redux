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
import type { ArenaTagSide } from "#enums/arena-tag-side";
import type { ArenaTagType } from "#enums/arena-tag-type";

export interface PostSummonStackSetEffectsOptions {
  /** Terrain to set on summon (optional). */
  readonly terrain?: TerrainType;
  /** Arena tags to apply (optional). */
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
    for (const tag of this.opts.tags ?? []) {
      globalScene.arena.addTag(tag.type, tag.turns, undefined, pokemon.id, tag.side);
    }
  }
}
