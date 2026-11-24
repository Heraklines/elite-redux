/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `disable-foe-items-on-entry` archetype.
//
// Engine-side hook: dispatched through pokerogue's existing
// `applyAbAttrs("PostSummonAbAttr", …)` on switch-in.
//
// Wires:
//   - 119 FRISK — ER spec: "Upon entering battle, reveals the opponents' items
//     and prevents them from working for 2 turns. Does not prevent Mega Stones
//     and other similar items from working." The reveal is the vanilla base
//     ability; this class adds the disable rider by applying the
//     ER_ITEM_DISABLED battler tag to each on-field opponent for 2 turns. While
//     tagged, the foe's held-item effects are suppressed (gated in
//     `PokemonHeldItemModifier.shouldApply`). Mega Stones / form-change items
//     are not routed through that path, so they keep working — matching the spec.
// =============================================================================

import { type AbAttrBaseParams, PostAttackAbAttr, PostSummonAbAttr } from "#abilities/ab-attrs";
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveFlags } from "#enums/move-flags";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";

export class DisableFoeItemsOnEntryAbAttr extends PostSummonAbAttr {
  // The default is 3, not 2, to disable the foe's item for 2 full turns (the dex "2 turns").
  // TurnEndPhase lapses TURN_END tags BEFORE held-item turn-end effects fire
  // (turn-end-phase.ts), so a count-2 tag is already removed when turn 2's
  // Leftovers heal runs - only turn 1 is actually blocked. Count 3 keeps the tag
  // alive through both turn-end heals. (Reported: "frisk only locks for 1 turn".)
  private static readonly DEFAULT_TURNS = 3;

  /** The tag count handed to `addTag` (a count of 3 blocks the items for 2 full turns, see above). */
  private readonly turns: number;

  constructor(turns: number = DisableFoeItemsOnEntryAbAttr.DEFAULT_TURNS) {
    // showAbility=false: the vanilla Frisk reveal already raises the ability bar;
    // this rider should not double up the popup.
    super(false);
    this.turns = turns;
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    for (const opponent of pokemon.getOpponents()) {
      opponent.addTag(BattlerTagType.ER_ITEM_DISABLED, this.turns, undefined, pokemon.id);
    }
  }
}

/**
 * Elite Redux — Supersweet Syrup 723: "When making contact, the opponent's item
 * is disabled for 2 turns." Applies the ER_ITEM_DISABLED battler tag to the
 * struck target on a contact hit. (Pairs with Sticky Hold / BlockItemTheft for
 * the "item cannot be removed or stolen" half.)
 */
export class DisableTargetItemOnContactAbAttr
  extends PostAttackAbAttr
  implements GatedAttr<PostMoveInteractionAbAttrParams>
{
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  // The default 3 = 2 full turns of suppression; see DisableFoeItemsOnEntryAbAttr above for
  // why (TURN_END tag lapse runs before the held-item turn-end heal).
  private static readonly DEFAULT_TURNS = 3;

  /** The tag count handed to `addTag`. */
  private readonly turns: number;

  constructor(turns: number = DisableTargetItemOnContactAbAttr.DEFAULT_TURNS) {
    // The parent's own defaults: a damaging move is required (attackCondition) and the ability bar is shown.
    super();
    this.turns = turns;
  }

  /**
   * Tier B split (ability studio spec 3.1). The original order was: the parent's damaging-move test, the hit connected,
   * there is another Pokemon, then the contact test. The three pure safety reads are `guards` now, and the damaging-move
   * test (which ran first and could not be seen) joins the contact test in the replaceable `gate`; every clause is a pure
   * read, so the answer is unchanged. No random draw, nothing in a residual.
   */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  /** Safety rules that stay in the class: the hit really landed (not a no-effect or a miss) on another Pokemon. */
  public guards({ pokemon, opponent, hitResult }: PostMoveInteractionAbAttrParams): boolean {
    return !(hitResult >= HitResult.NO_EFFECT || opponent === undefined || pokemon === opponent);
  }

  /** The replaceable condition: the move deals damage (the parent's test) and makes contact (Long Reach aware). */
  public gate(params: PostMoveInteractionAbAttrParams): boolean {
    const { pokemon, opponent, move } = params;
    if (!super.canApply(params)) {
      return false;
    }
    return move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: pokemon, target: opponent });
  }

  override apply({ simulated, pokemon, opponent }: PostMoveInteractionAbAttrParams): void {
    if (!simulated && opponent !== undefined) {
      opponent.addTag(BattlerTagType.ER_ITEM_DISABLED, this.turns, undefined, pokemon.id);
    }
  }
}
