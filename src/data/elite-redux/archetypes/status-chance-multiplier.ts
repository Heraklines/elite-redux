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
//   - 456 Cryomancy — "Moves inflict frostbite 5x as often." (FREEZE, 5x — ER
//     treats freeze as the frostbite analogue at the move-chance layer)
// =============================================================================

import { type ModifyMoveEffectChanceAbAttrParams, MoveEffectChanceMultiplierAbAttr } from "#abilities/ab-attrs";
import { BattlerTagType } from "#enums/battler-tag-type";
import { StatusEffect } from "#enums/status-effect";

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
    const move = params.move;
    // Scale moves that inflict the configured status directly...
    if (move.getAttrs("StatusEffectAttr").some(attr => attr.effect === this.status)) {
      return true;
    }
    // ...and, for frostbite (which ER models as the FREEZE analogue), also scale
    // moves that inflict it via the ER_FROSTBITE battler tag (Chilling Water,
    // Bitter Malice, Flash Freeze, the chance-status frostbite family) — those
    // carry no StatusEffectAttr(FREEZE) so the check above misses them. Both the
    // status and the tag proc share the same `move.chance` the parent scales.
    if (this.status === StatusEffect.FREEZE) {
      return move.getAttrs("AddBattlerTagAttr").some(a => a.tagType === BattlerTagType.ER_FROSTBITE);
    }
    return false;
  }
}
