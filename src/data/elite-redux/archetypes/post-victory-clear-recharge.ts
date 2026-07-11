/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-victory-clear-recharge` primitive.
//
// A {@linkcode PostVictoryAbAttr}: when the holder scores a direct KO, it
// instantly recovers from recharge — so a recharge move (Hyper Beam, Giga
// Impact, ...) that KOs the target does NOT lock the holder into a recharge
// turn. Rides pokerogue's PostVictory hook (fired in `FaintPhase` on the mon
// that landed the KO blow), where the RECHARGING tag is already on the holder
// (the recharge move applies it during its own MoveEffectPhase, which resolves
// before the victim's FaintPhase runs).
//
// Removing the tag alone is not enough: `RechargingTag.onAdd` also pushes a
// placeholder `MoveId.NONE` onto the holder's move queue (consumed by the tag's
// PRE_MOVE lapse next turn). We must drop that queued entry too, or the holder
// would "use" the placeholder next turn instead of acting freely.
//
// Wires:
//   - 275 Rampage — "Rampage eliminates recharge turns when the user
//     successfully KOs an opponent with a direct attack."
//   - 480 Berserker Rage — composite [Tipping Point + Rampage]; inherits this
//     via its Rampage part.
// =============================================================================

import { PostVictoryAbAttr } from "#abilities/ab-attrs";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import type { AbAttrBaseParams } from "#types/ability-types";

export class PostVictoryClearRechargeAbAttr extends PostVictoryAbAttr {
  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    return pokemon.getTag(BattlerTagType.RECHARGING) !== undefined;
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    pokemon.removeTag(BattlerTagType.RECHARGING);
    // Drop the placeholder move RechargingTag.onAdd queued for the recharge turn.
    const queue = pokemon.getMoveQueue();
    if (queue.length > 0 && queue[0].move === MoveId.NONE) {
      queue.shift();
    }
  }
}
