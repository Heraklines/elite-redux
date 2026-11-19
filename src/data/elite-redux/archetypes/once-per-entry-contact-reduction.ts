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
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { MoveFlags } from "#enums/move-flags";

export class OncePerEntryContactDamageReductionAbAttr
  extends ReceivedMoveDamageMultiplierAbAttr
  implements GatedAttr<PreDefendModifyDamageAbAttrParams>
{
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PreDefendModifyDamageAbAttrParams) => boolean) | undefined;

  constructor(multiplier: number) {
    // The parent's closure is the replaceable half of the old one: the incoming move makes contact. The once-per-entry
    // check that used to sit in front of it moved to `guards` below, in the same order.
    super(
      (target, attacker, move) => move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: attacker, target }),
      multiplier,
      true,
    );
  }

  /**
   * Tier B split (ability studio spec 3.1): `guards` (the charge of this entry is not spent yet), then `gate` (the move
   * makes contact), in the original clause order. There is no `prepare` and no `residual`.
   */
  override canApply(params: PreDefendModifyDamageAbAttrParams): boolean {
    return gatedCanApply<PreDefendModifyDamageAbAttrParams>(this, params);
  }

  /** Rule that stays in the class: this entry's charge is unspent. Moved verbatim from the old closure. */
  public guards({ pokemon }: PreDefendModifyDamageAbAttrParams): boolean {
    return pokemon.summonData.chuckusterReductionUsed !== true;
  }

  /** The replaceable condition: the parent's closure (the incoming move makes contact with the holder). */
  public gate(params: PreDefendModifyDamageAbAttrParams): boolean {
    return super.canApply(params);
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
