/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `defense-stat-swap-on-statused-foe` archetype.
//
// MovePowerBoost hook: when the holder attacks a statused opponent, augment
// power based on whichever of the opponent's DEF/SPDEF is LOWEST. We do
// this by adding a 1.5x multiplier when the move category targets the
// opponent's WEAKER defending stat — equivalent to "targets lowest
// defense" in ER's text.
//
// Wires:
//   - 284 Exploit Weakness — "Targets lowest defense vs statused foes."
// =============================================================================

import { MovePowerBoostAbAttr } from "#abilities/ab-attrs";
import { MoveCategory } from "#enums/move-category";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";

export class DefenseStatSwapOnStatusedFoeAbAttr extends MovePowerBoostAbAttr {
  constructor() {
    super(() => true, 1);
  }

  override apply(params: Parameters<MovePowerBoostAbAttr["apply"]>[0]): void {
    const { opponent, move, power } = params;
    if (!opponent || opponent.status?.effect === StatusEffect.NONE) {
      return;
    }
    if (opponent.status?.effect === undefined) {
      return;
    }
    const def = opponent.getStat(Stat.DEF, false);
    const spd = opponent.getStat(Stat.SPDEF, false);
    // If using the side OPPOSITE the foe's weakness, "redirect" by boosting
    // by the ratio of the stronger to the weaker stat. e.g. attacking DEF
    // when SPDEF is lower → boost by def/spd ratio (capped 2x).
    if (move.category === MoveCategory.PHYSICAL && def > spd) {
      power.value *= Math.min(2, def / Math.max(spd, 1));
    } else if (move.category === MoveCategory.SPECIAL && spd > def) {
      power.value *= Math.min(2, spd / Math.max(def, 1));
    }
  }
}
