/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `status-cascade` archetype.
//
// PostAttack hook: when the holder inflicts a particular status on an
// opponent via a move (chance-based or move attribute), ALSO apply
// stat-stage changes to that opponent.
//
// Wires:
//   - 750 Neurotoxin — "Inflicting poison also lowers Attack, SpAtk, and
//     Speed." (When the holder poisons a foe, also drop ATK/SPATK/SPD -1.)
// =============================================================================

import { PostAttackAbAttr } from "#abilities/ab-attrs";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";
import { globalScene } from "#app/global-scene";
import type { StatusEffect } from "#enums/status-effect";
import type { BattleStat } from "#enums/stat";

export interface StatusCascadeChange {
  readonly stat: BattleStat;
  readonly stages: number;
}

export interface StatusCascadeOptions {
  /** Status that triggers the cascade. */
  readonly trigger: StatusEffect;
  /** Stat-stage changes applied to the affected opponent. */
  readonly stats: readonly StatusCascadeChange[];
}

export class StatusCascadeAbAttr extends PostAttackAbAttr {
  private readonly trigger: StatusEffect;
  private readonly stats: readonly StatusCascadeChange[];

  constructor(options: StatusCascadeOptions) {
    super(undefined, false);
    if (options.stats.length === 0) {
      throw new Error("[StatusCascadeAbAttr] options.stats must be non-empty");
    }
    this.trigger = options.trigger;
    this.stats = options.stats;
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { opponent } = params;
    if (!opponent || opponent.isFainted()) {
      return false;
    }
    return opponent.status?.effect === this.trigger;
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    const { opponent, simulated } = params;
    if (simulated || !opponent) {
      return;
    }
    for (const change of this.stats) {
      globalScene.phaseManager.unshiftNew(
        "StatStageChangePhase",
        opponent.getBattlerIndex(),
        false,
        [change.stat],
        change.stages,
      );
    }
  }
}
