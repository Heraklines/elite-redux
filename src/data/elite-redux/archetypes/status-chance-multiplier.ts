/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `status-chance-multiplier` archetype.
//
// Multiplies the secondary-effect chance of the holder's moves, but ONLY for
// moves that inflict a specific status (unlike Serene Grace which multiplies
// every move's chance). Faithfully models "inflicts <status> N× as often" —
// it does NOT add the status to moves that never had it.
//
// Wires:
//   - 270 Pyromancy — "Moves inflict burn 5x as often." (BURN, 5x)
//   - 387 Cryomancy — "Moves inflict frostbite 5x as often." (FREEZE, 5x — ER
//     treats freeze as the frostbite analogue at the move-chance layer)
// =============================================================================

import { type ModifyMoveEffectChanceAbAttrParams, MoveEffectChanceMultiplierAbAttr } from "#abilities/ab-attrs";
import type { StatusEffect } from "#enums/status-effect";

export class StatusChanceMultiplierAbAttr extends MoveEffectChanceMultiplierAbAttr {
  private readonly status: StatusEffect;

  constructor(status: StatusEffect, multiplier: number) {
    super(multiplier);
    this.status = status;
  }

  override canApply(params: ModifyMoveEffectChanceAbAttrParams): boolean {
    if (!super.canApply(params)) {
      return false;
    }
    // Only scale moves that actually inflict the configured status.
    return params.move.getAttrs("StatusEffectAttr").some(attr => attr.effect === this.status);
  }
}
