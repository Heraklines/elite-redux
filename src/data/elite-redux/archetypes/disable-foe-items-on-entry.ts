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
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveFlags } from "#enums/move-flags";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";

export class DisableFoeItemsOnEntryAbAttr extends PostSummonAbAttr {
  /** How long the foe's items stay disabled, in turns. */
  private static readonly TURNS = 2;

  constructor() {
    // showAbility=false: the vanilla Frisk reveal already raises the ability bar;
    // this rider should not double up the popup.
    super(false);
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    for (const opponent of pokemon.getOpponents()) {
      opponent.addTag(BattlerTagType.ER_ITEM_DISABLED, DisableFoeItemsOnEntryAbAttr.TURNS, undefined, pokemon.id);
    }
  }
}

/**
 * Elite Redux — Supersweet Syrup 723: "When making contact, the opponent's item
 * is disabled for 2 turns." Applies the ER_ITEM_DISABLED battler tag to the
 * struck target on a contact hit. (Pairs with Sticky Hold / BlockItemTheft for
 * the "item cannot be removed or stolen" half.)
 */
export class DisableTargetItemOnContactAbAttr extends PostAttackAbAttr {
  private static readonly TURNS = 2;

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { pokemon, opponent, move, hitResult } = params;
    if (!super.canApply(params) || hitResult >= HitResult.NO_EFFECT || opponent === undefined || pokemon === opponent) {
      return false;
    }
    return move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: pokemon, target: opponent });
  }

  override apply({ simulated, pokemon, opponent }: PostMoveInteractionAbAttrParams): void {
    if (!simulated && opponent !== undefined) {
      opponent.addTag(BattlerTagType.ER_ITEM_DISABLED, DisableTargetItemOnContactAbAttr.TURNS, undefined, pokemon.id);
    }
  }
}
