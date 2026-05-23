/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `on-crit-stat-boost-lowest` archetype.
//
// PostAttack hook: when the holder lands a critical hit, boost the N lowest
// of the holder's stats by `stages`. Limited to once per turn.
//
// Wires:
//   - 914 Home Run — "Landing a crit boosts your 3 lowest stats once per
//     turn." (n: 3, stages: +1.)
// =============================================================================

import { PostAttackAbAttr } from "#abilities/ab-attrs";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";
import { globalScene } from "#app/global-scene";
import { type EffectiveStat, Stat } from "#enums/stat";

const LAST_TURN_FLAG = Symbol("OnCritStatBoostLowest.lastTurn");

const EFFECTIVE_STATS: readonly EffectiveStat[] = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD];

export interface OnCritStatBoostLowestOptions {
  /** Number of lowest stats to boost. */
  readonly n: number;
  /** Stage delta. */
  readonly stages: number;
}

export class OnCritStatBoostLowestAbAttr extends PostAttackAbAttr {
  constructor(private readonly opts: OnCritStatBoostLowestOptions) {
    super(undefined, false);
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { pokemon } = params;
    const turn = globalScene.currentBattle?.turn ?? 0;
    if ((pokemon as unknown as Record<symbol, number>)[LAST_TURN_FLAG] === turn) {
      return false;
    }
    const lastHit = pokemon.turnData?.attacksReceived?.[0];
    if (lastHit) {
      // not relevant — we need crit landed BY holder, check turnData on opponent's side
    }
    // Check if the most recent move resolution was a crit by the holder.
    // pokerogue's turnData on attacker tracks `currentDmg` and `crit` on the
    // resolved move via `attacksReceived` on the TARGET. We probe the target.
    const opp = params.opponent;
    if (!opp) {
      return false;
    }
    const received = opp.turnData?.attacksReceived?.[0];
    return !!received?.critical;
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    const { pokemon, simulated } = params;
    if (simulated) {
      return;
    }
    const turn = globalScene.currentBattle?.turn ?? 0;
    (pokemon as unknown as Record<symbol, number>)[LAST_TURN_FLAG] = turn;

    const sorted = [...EFFECTIVE_STATS].sort((a, b) => pokemon.getStatStage(a) - pokemon.getStatStage(b));
    const targets = sorted.slice(0, this.opts.n);
    for (const stat of targets) {
      globalScene.phaseManager.unshiftNew(
        "StatStageChangePhase",
        pokemon.getBattlerIndex(),
        true,
        [stat],
        this.opts.stages,
      );
    }
  }
}
