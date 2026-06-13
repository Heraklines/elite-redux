/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-damage-force-attacker-out` archetype.
//
// Forces the ATTACKER out when the holder is hit by an attacking move, once per
// switch-in. This is distinct from vanilla Wimp Out / Emergency Exit
// (PostDamageForceSwitchAbAttr), which switches the HOLDER out - the bug behind
// the live report that Gooschase's signature "acts like Wimp Out".
//
// Wires (ER 2.65 dex):
//   - 690 Restraining Order — "Forces the attacker out when hit, once each
//     switch-in." (Gooschase signature)
//   - 864 Chuckster — "...force out the attacker." (paired with its once-per-
//     entry contact damage reduction, wired separately in the dispatcher).
//
// The once-per-switch-in gate lives on `summonData.forceAttackerOutUsed`, which
// resets on every send-out (matching "once each switch-in").
// =============================================================================

import { ForceSwitchOutHelper, PostDamageAbAttr, type PostDamageAbAttrParams } from "#abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { SwitchType } from "#enums/switch-type";

export class PostDamageForceAttackerOutAbAttr extends PostDamageAbAttr {
  private readonly helper = new ForceSwitchOutHelper(SwitchType.SWITCH);

  override canApply({ pokemon, source }: PostDamageAbAttrParams): boolean {
    // Need a living opposing attacker, and the holder must still be on the field.
    if (!source || source === pokemon || source.isFainted() || pokemon.isFainted()) {
      return false;
    }
    if (!pokemon.isOpponent(source)) {
      return false;
    }
    // Once per switch-in.
    if (pokemon.summonData.forceAttackerOutUsed) {
      return false;
    }
    // Only react to the attacker's own offensive move - not weather, hazards,
    // status DoT, or the holder's self-inflicted damage.
    const lastMove = source.getLastXMoves()[0];
    if (!lastMove || lastMove.move === MoveId.NONE || allMoves[lastMove.move]?.category === MoveCategory.STATUS) {
      return false;
    }
    // Respect the standard force-switch eligibility (trapping, last mon, etc.) -
    // here the ATTACKER is the one being switched out.
    return this.helper.getSwitchOutCondition(source, pokemon);
  }

  override apply({ pokemon, source, simulated }: PostDamageAbAttrParams): void {
    if (simulated || !source) {
      return;
    }
    pokemon.summonData.forceAttackerOutUsed = true;
    this.helper.switchOutLogic(source);
  }
}
