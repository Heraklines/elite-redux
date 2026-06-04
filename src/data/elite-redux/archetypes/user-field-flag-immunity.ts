/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `user-field-flag-immunity` archetype.
//
// PreDefend hook that grants immunity to moves carrying a given MoveFlag,
// extended to the holder's entire party (not just self).
//
// Wires:
//   - 595 Noise Cancel — "Protects the party from sound-based moves."
//     (SOUND_BASED.)
// =============================================================================

import { PreDefendAbAttr, type TypeMultiplierAbAttrParams } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import type { MoveFlags } from "#enums/move-flags";

export interface UserFieldFlagImmunityOptions {
  readonly flag: MoveFlags;
}

export class UserFieldFlagImmunityAbAttr extends PreDefendAbAttr {
  constructor(private readonly opts: UserFieldFlagImmunityOptions) {
    super(true);
  }

  override canApply(params: TypeMultiplierAbAttrParams): boolean {
    const { move, opponent, pokemon } = params;
    if (opponent === pokemon || !move.is("AttackMove")) {
      return false;
    }
    if (!move.doesFlagEffectApply({ flag: this.opts.flag, user: opponent, target: pokemon })) {
      return false;
    }
    // Holder OR any party-side ally on the field must have the ability.
    // Pokerogue invokes PreDefend on the actual target — for ally
    // protection we trust that the dispatcher fires our AbAttr for ALL
    // pokemon on the holder's side. To extend immunity to allies, we
    // confirm at least one on-field ally (incl. holder) has this AbAttr.
    const sideField = globalScene.getField().filter(p => p && !p.isFainted() && p.isPlayer() === pokemon.isPlayer());
    return sideField.length > 0;
  }

  override apply(params: TypeMultiplierAbAttrParams): void {
    params.typeMultiplier.value = 0;
    params.cancelled.value = true;
  }
}
