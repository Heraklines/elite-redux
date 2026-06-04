/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `curse-attacker-on-form-block` primitive.
//
// A Disguise (FormBlockDamageAbAttr) variant that ALSO curses the attacker when
// the disguise breaks. Used by Patchwork 693 ("Disguise + curses the opponent
// when its Disguise breaks. When the disguise breaks, the attacker becomes
// cursed."). Behaviour is identical to vanilla Disguise (block the first
// damaging hit, take 1/8 recoil, change to the busted form) plus the curse.
//
// canApply is inherited unchanged, so the curse only fires on the exact hit
// that breaks the disguise (intact form + damaging move + damage > 0).
// =============================================================================

import { FormBlockDamageAbAttr } from "#abilities/ab-attrs";
import { BattlerTagType } from "#enums/battler-tag-type";
import type { PreDefendModifyDamageAbAttrParams } from "#types/ability-types";

export class CurseAttackerOnFormBlockDamageAbAttr extends FormBlockDamageAbAttr {
  override apply(params: PreDefendModifyDamageAbAttrParams): void {
    // Block the hit + trigger the form change exactly as vanilla Disguise does.
    super.apply(params);
    const { simulated, pokemon, opponent } = params;
    if (!simulated && opponent !== undefined) {
      // Curse the attacker (the Curse battler tag chips the attacker each turn).
      opponent.addTag(BattlerTagType.CURSED, 0, undefined, pokemon.id);
    }
  }
}
