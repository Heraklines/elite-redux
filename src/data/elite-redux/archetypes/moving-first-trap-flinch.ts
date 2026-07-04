/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `moving-first-trap-flinch` archetype.
//
// "When the user moves first in a turn, attacks gain a 20% chance to flinch and
// trap the target on hit. The trap effect applies regardless of flinch
// success."
//
// "Moving first" is read from the target's per-turn `acted` flag: when the
// holder's attack resolves and the target has NOT yet acted this turn, the
// holder moved first. On such hits the target is trapped (always) and flinched
// (configurable chance, default 20%).
//
// Wires:
//   - 702 From the Shadows — "Attacks trap and have a 20% flinch chance when
//     moving first."
// =============================================================================

import { PostAttackAbAttr, type PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";

export class MovingFirstTrapFlinchAbAttr extends PostAttackAbAttr {
  private readonly flinchChance: number;
  private readonly trapTurns: number;

  constructor(flinchChance = 20, trapTurns = 4) {
    super();
    this.flinchChance = flinchChance;
    this.trapTurns = trapTurns;
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { opponent: target, hitResult } = params;
    // "Moving first" is read from the target's per-turn `acted` flag — NOT from
    // the multi-hit counter. The trap applies on every moving-first hit; the
    // flinch roll is additionally gated to the FIRST hit (handled in apply).
    return super.canApply(params) && hitResult < HitResult.NO_EFFECT && !!target && !target.turnData.acted;
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    const { pokemon, opponent: target, simulated } = params;
    if (simulated || !target) {
      return;
    }
    // Trap always applies on a moving-first hit (regardless of flinch success
    // and regardless of which strike of a multi-hit move this is).
    target.addTag(BattlerTagType.TRAPPED, this.trapTurns, undefined, pokemon.id);
    // Flinch chance ONLY works on the FIRST hit of a multi-hit move (dex rule).
    // First strike ⇔ hitsLeft still equals the total hitCount.
    const firstHit = pokemon.turnData.hitCount === pokemon.turnData.hitsLeft;
    if (firstHit && pokemon.randBattleSeedInt(100) < this.flinchChance) {
      target.addTag(BattlerTagType.FLINCHED, 1, undefined, pokemon.id);
    }
  }
}
