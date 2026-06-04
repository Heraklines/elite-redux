/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `chance-dodge` archetype.
//
// PreDefend hook: rolls a configurable percentage chance to evade ANY
// single-target incoming attack. Mirrors classic "evasion" but as a per-
// hit roll (not a permanent EVA stat boost).
//
// Wires:
//   - 597 Olé! — "20% chance to evade single-target moves" (chance: 20,
//     singleTargetOnly: true).
// =============================================================================

import { PreDefendAbAttr, type TypeMultiplierAbAttrParams } from "#abilities/ab-attrs";
import { MoveTarget } from "#enums/move-target";

export interface ChanceDodgeOptions {
  /** Percentage chance to evade (0-100). */
  readonly chance: number;
  /** If true, only single-target attacks can be dodged (mirrors Olé). */
  readonly singleTargetOnly?: boolean;
}

const SINGLE_TARGET_KINDS = new Set<MoveTarget>([
  MoveTarget.NEAR_OTHER,
  MoveTarget.OTHER,
  MoveTarget.NEAR_ENEMY,
  MoveTarget.ENEMY_SIDE,
]);

export class ChanceDodgeAbAttr extends PreDefendAbAttr {
  private readonly chance: number;
  private readonly singleTargetOnly: boolean;

  constructor(options: ChanceDodgeOptions) {
    if (!(options.chance > 0 && options.chance <= 100)) {
      throw new Error(`[ChanceDodgeAbAttr] chance must be in (0, 100]; got ${options.chance}`);
    }
    super(true);
    this.chance = options.chance;
    this.singleTargetOnly = options.singleTargetOnly ?? false;
  }

  override canApply(params: TypeMultiplierAbAttrParams): boolean {
    const { move, opponent: attacker, pokemon } = params;
    if (attacker === pokemon || !move.is("AttackMove")) {
      return false;
    }
    if (this.singleTargetOnly && !SINGLE_TARGET_KINDS.has(move.moveTarget)) {
      return false;
    }
    return pokemon.randBattleSeedInt(100) < this.chance;
  }

  override apply(params: TypeMultiplierAbAttrParams): void {
    params.typeMultiplier.value = 0;
    params.cancelled.value = true;
  }
}
