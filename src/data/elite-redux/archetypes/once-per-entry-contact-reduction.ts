/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `once-per-entry-contact-reduction` primitive (Chuckster 864).
//
// "Once per entry when receiving a contact move, gain 50% damage reduction."
// A `ReceivedMoveDamageMultiplier` whose condition gates on (a) the incoming
// move making contact and (b) the holder not having spent its once-per-entry
// charge yet (`summonData.chuckusterReductionUsed`, which resets each send-out).
// The charge is consumed on the first real (non-simulated) application, so the
// reduction applies to exactly one contact hit per entry.
// =============================================================================

import type { PreDefendModifyDamageAbAttrParams } from "#abilities/ab-attrs";
import { ReceivedMoveDamageMultiplierAbAttr } from "#abilities/ab-attrs";
import { MoveFlags } from "#enums/move-flags";

export class OncePerEntryContactDamageReductionAbAttr extends ReceivedMoveDamageMultiplierAbAttr {
  constructor(multiplier: number) {
    super(
      (target, attacker, move) =>
        target.summonData.chuckusterReductionUsed !== true
        && move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: attacker, target }),
      multiplier,
      true,
    );
  }

  override apply(params: PreDefendModifyDamageAbAttrParams): void {
    // Spend the once-per-entry charge on the first real hit (never during AI
    // damage simulation, which must not mutate battle state).
    if (!params.simulated) {
      params.pokemon.summonData.chuckusterReductionUsed = true;
    }
    super.apply(params);
  }
}
