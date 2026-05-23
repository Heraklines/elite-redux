/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-victory-clear-tag` archetype.
//
// PostKnockOut hook that removes one or more BattlerTags from the holder
// after KOing a target. Used by Rampage (275): "No recharge after a KO" —
// clear the RECHARGING tag so the holder isn't stuck next turn.
// =============================================================================

import { PostKnockOutAbAttr, type PostKnockOutAbAttrParams } from "#abilities/ab-attrs";
import type { BattlerTagType } from "#enums/battler-tag-type";

export interface PostVictoryClearTagOptions {
  /** Tags to remove from the holder after KOing a target. */
  readonly tags: readonly BattlerTagType[];
}

export class PostVictoryClearTagAbAttr extends PostKnockOutAbAttr {
  private readonly tags: readonly BattlerTagType[];

  constructor(options: PostVictoryClearTagOptions) {
    super();
    if (options.tags.length === 0) {
      throw new Error("[PostVictoryClearTagAbAttr] options.tags must be non-empty");
    }
    this.tags = options.tags;
  }

  override canApply(_params: PostKnockOutAbAttrParams): boolean {
    return true;
  }

  override apply(params: PostKnockOutAbAttrParams): void {
    const { pokemon, simulated } = params;
    if (simulated) {
      return;
    }
    for (const tagType of this.tags) {
      pokemon.removeTag(tagType);
    }
  }
}
