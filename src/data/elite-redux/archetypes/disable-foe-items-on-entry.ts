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

import { type AbAttrBaseParams, PostSummonAbAttr } from "#abilities/ab-attrs";
import { BattlerTagType } from "#enums/battler-tag-type";

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
