/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `self-persistent-bleed` archetype.
//
// "Pokemon with this ability gain an unremovable bleed status condition."
// The holder is kept perpetually bleeding: the ER_BLEED tag is (re)applied at
// every turn end whenever it is absent (e.g. after a heal cured it) and the
// holder is not immune (Rock/Ghost, handled by ErBleedTag.canAdd). The summon
// application itself is wired via the vanilla PostSummonAddBattlerTagAbAttr.
//
// Wires:
//   - 673 Blood Stain — "Is always bleeding if not immune. Spreads on contact."
//     (paired with the contact ER_BLEED spreader)
// =============================================================================

import { type AbAttrBaseParams, PostTurnAbAttr } from "#abilities/ab-attrs";
import { BattlerTagType } from "#enums/battler-tag-type";

export class SelfPersistentBleedAbAttr extends PostTurnAbAttr {
  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    // Re-apply only if it isn't already bleeding and isn't immune.
    return !pokemon.getTag(BattlerTagType.ER_BLEED) && pokemon.canAddTag(BattlerTagType.ER_BLEED);
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (!simulated) {
      pokemon.addTag(BattlerTagType.ER_BLEED);
    }
  }
}
