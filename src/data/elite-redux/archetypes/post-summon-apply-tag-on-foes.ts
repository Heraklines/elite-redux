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
import { BattlerTagType } from "#enums/battler-tag-type";

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
    for (const opp of pokemon.getOpponents()) {
      if (!opp || opp.isFainted()) {
        continue;
      }
      opp.addTag(this.opts.tag, this.opts.turns, undefined, pokemon.id);
    }
  }
}
