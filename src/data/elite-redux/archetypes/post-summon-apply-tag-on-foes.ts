/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-summon-apply-tag-on-foes` archetype.
//
// PostSummon hook that applies a configured BattlerTag to each on-field
// opponent for `turns` duration.
//
// Wires:
//   - 923 Mashed Potato — "Syrup Bomb effect on the foe for 3 turns."
// =============================================================================

import { type AbAttrBaseParams, PostSummonAbAttr } from "#abilities/ab-attrs";
import type { BattlerTagType } from "#enums/battler-tag-type";

export interface PostSummonApplyTagOnFoesOptions {
  readonly tag: BattlerTagType;
  readonly turns: number;
}

export class PostSummonApplyTagOnFoesAbAttr extends PostSummonAbAttr {
  constructor(private readonly opts: PostSummonApplyTagOnFoesOptions) {
    super(true);
  }

  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    return pokemon.getOpponents().some(o => o && !o.isFainted());
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    // Triple: a placement-dependent foe effect only reaches ADJACENT foes (binary: all foes).
    for (const opp of pokemon.getAdjacentOpponents()) {
      if (!opp || opp.isFainted()) {
        continue;
      }
      opp.addTag(this.opts.tag, this.opts.turns, undefined, pokemon.id);
    }
  }
}
