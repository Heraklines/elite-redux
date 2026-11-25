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
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import type { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";
import { toDmgValue } from "#utils/common";

export class PostDefendHpGatedSelfTagAbAttr
  extends PostDefendAbAttr
  implements GatedAttr<PostMoveInteractionAbAttrParams>
{
  private readonly hpGate: number;
  private readonly tagType: BattlerTagType;
  private readonly turnCount: number;

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  constructor(hpGate: number, tagType: BattlerTagType, turnCount = 0) {
    super(true);
    this.hpGate = hpGate;
    this.tagType = tagType;
    this.turnCount = turnCount;
  }

  /**
   * Tier B split (ability studio spec 3.1): no guards, no residual; every clause of the old `canApply` is the replaceable
   * `gate` (a damaging move, the hit crossed the HP line, the effect is not already on me), in the original clause order.
   */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  /** The replaceable condition: a damaging move, the hit just crossed the HP line, and the tag is not on me yet. */
  public gate({ pokemon, move, damage }: PostMoveInteractionAbAttrParams): boolean {
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
