/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-turn-apply-tag-on-foes` archetype.
//
// Re-applies a battler tag to every opponent at each turn end. Combined with an
// on-summon application this keeps a tag active for as long as the holder
// remains on the field, and lets it lapse shortly after the holder leaves —
// modelling "while this Pokemon is present" field effects.
//
// Wires:
//   - 532 Permanence — "Foes can't heal in any way." (HEAL_BLOCK, refreshed
//     each turn while the holder is on the field)
// =============================================================================

import { type AbAttrBaseParams, PostTurnAbAttr } from "#abilities/ab-attrs";
import type { BattlerTagType } from "#enums/battler-tag-type";

export interface PostTurnApplyTagOnFoesOptions {
  readonly tag: BattlerTagType;
  /** Turns to (re)apply the tag for each turn-end (2 keeps it fresh). */
  readonly turns: number;
}

export class PostTurnApplyTagOnFoesAbAttr extends PostTurnAbAttr {
  private readonly tag: BattlerTagType;
  private readonly turns: number;

  constructor(options: PostTurnApplyTagOnFoesOptions) {
    super();
    this.tag = options.tag;
    this.turns = options.turns;
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
      opp.addTag(this.tag, this.turns, undefined, pokemon.id);
    }
  }
}
