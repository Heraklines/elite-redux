/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-defend-hp-gated-self-tag` primitive.
//
// When a damaging hit drops the holder to or below a fraction of its max HP
// FOR THE FIRST TIME (i.e. it crossed the threshold this hit), apply a battler
// tag to the holder. Used by No Turning Back 668 ("when HP drops to half or
// below for the first time ... the user becomes unable to switch out or flee")
// with the NO_RETREAT self-trap tag, alongside the one-time all-stats boost
// (PostDefendHpGatedStatStageChangeAbAttr).
//
// The HP-crossing gate mirrors PostDefendHpGatedStatStageChangeAbAttr exactly,
// so the boost and the trap trigger on the same hit.
// =============================================================================

import { PostDefendAbAttr } from "#abilities/ab-attrs";
import type { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";
import { toDmgValue } from "#utils/common";

export class PostDefendHpGatedSelfTagAbAttr extends PostDefendAbAttr {
  private readonly hpGate: number;
  private readonly tagType: BattlerTagType;
  private readonly turnCount: number;

  constructor(hpGate: number, tagType: BattlerTagType, turnCount = 0) {
    super(true);
    this.hpGate = hpGate;
    this.tagType = tagType;
    this.turnCount = turnCount;
  }

  override canApply({ pokemon, move, damage }: PostMoveInteractionAbAttrParams): boolean {
    if (move.category === MoveCategory.STATUS) {
      return false;
    }
    const threshold = toDmgValue(pokemon.getMaxHp() * this.hpGate);
    // True only on the hit that first crosses the threshold, and only if the
    // tag isn't already present (so it doesn't re-apply on every subsequent hit).
    return pokemon.hp <= threshold && pokemon.hp + damage > threshold && pokemon.getTag(this.tagType) === undefined;
  }

  override apply({ simulated, pokemon }: PostMoveInteractionAbAttrParams): void {
    if (!simulated) {
      pokemon.addTag(this.tagType, this.turnCount, undefined, pokemon.id);
    }
  }

  getTagType(): BattlerTagType {
    return this.tagType;
  }

  getHpGate(): number {
    return this.hpGate;
  }
}
