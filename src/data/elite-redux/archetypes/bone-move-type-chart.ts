/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `bone-move-type-chart` archetype.
//
// "Bone moves bypass immunities and hit for normal damage, while resisted moves
// do 2x damage. Neutral/super-effective moves remain unchanged."
//
// Bone moves are flagged `MoveFlags.BONE_BASED`. This attr rewrites the type
// effectiveness multiplier for such moves:
//   - immune (0x)        → 1x   (bypass the type immunity, normal damage)
//   - resisted (<1x)     → ×2   (0.5x → 1x-equivalent, 0.25x → 0.5x)
//   - neutral / SE (≥1x) → unchanged
//
// Read (registration-free, by class name) inside
// `Pokemon.getAttackTypeEffectiveness`, alongside OffensiveTypeChartOverride.
//
// Wires:
//   - 353 Bone Zone — "Bone moves ignore immunities and deal 2x on not very
//     effective."
// =============================================================================

import { AbAttr } from "#abilities/ab-attrs";
import { MoveFlags } from "#enums/move-flags";
import type { Move } from "#moves/move";
import type { AbAttrBaseParams } from "#types/ability-types";
import type { NumberHolder } from "#utils/common";

export class BoneMoveTypeChartAbAttr extends AbAttr {
  constructor() {
    super(false);
  }

  override canApply(_params: AbAttrBaseParams): boolean {
    return true;
  }

  override apply(_params: AbAttrBaseParams): void {}

  /** Adjust the effectiveness multiplier for a bone move. No-op otherwise. */
  public fire(move: Move, multi: NumberHolder): void {
    if (!move.hasFlag(MoveFlags.BONE_BASED)) {
      return;
    }
    if (multi.value === 0) {
      multi.value = 1; // bypass type immunity → normal damage
    } else if (multi.value < 1) {
      multi.value *= 2; // resisted → doubled
    }
  }
}
