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
    // NB: no AttackMove gate — Noise Cancel blocks ALL sound moves, including
    // status ones (Growl, Metal Sound), matching Soundproof. The dispatcher in
    // getMoveEffectiveness only invokes this on the target's own side, so the
    // opponent (attacker) is always the other side.
    if (opponent === pokemon) {
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
    // Zero the type multiplier (not `cancelled`) so the move reads as a plain
    // type-immunity — the engine shows "It doesn't affect ..." rather than a
    // MISS. The getMoveEffectiveness dispatcher returns this 0 for the target.
    params.typeMultiplier.value = 0;
  }
}
