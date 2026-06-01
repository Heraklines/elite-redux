/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `self-switch-on-stat-lower` archetype.
//
// When any of the holder's stats is lowered (including self-inflicted drops),
// the holder switches out. Triggers once per battle. Reuses the vanilla
// ForceSwitchOutHelper (Eject-Button-style switch).
//
// Wires:
//   - 564 Tactical Retreat — "Flees when stats are lowered." (once per battle)
// =============================================================================

import { ForceSwitchOutHelper, PostStatStageChangeAbAttr } from "#abilities/ab-attrs";
import { SwitchType } from "#enums/switch-type";
import type { PostStatStageChangeAbAttrParams } from "#types/ability-types";

const USED_FLAG = Symbol("SelfSwitchOnStatLower.used");

export class SelfSwitchOnStatLowerAbAttr extends PostStatStageChangeAbAttr {
  private readonly helper = new ForceSwitchOutHelper(SwitchType.SWITCH);

  override canApply(params: PostStatStageChangeAbAttrParams): boolean {
    const { pokemon, stages } = params;
    // Any stat LOWERED (incl. self-drops, per the ROM). Once per battle.
    if ((pokemon as unknown as Record<symbol, boolean>)[USED_FLAG]) {
      return false;
    }
    return stages < 0;
  }

  override apply(params: PostStatStageChangeAbAttrParams): void {
    const { pokemon, simulated } = params;
    if (simulated) {
      return;
    }
    (pokemon as unknown as Record<symbol, boolean>)[USED_FLAG] = true;
    this.helper.switchOutLogic(pokemon);
  }
}
