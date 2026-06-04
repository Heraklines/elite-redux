/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `target-highest-stat-drop` archetype.
//
// PostSummon hook that finds each opposing pokemon's highest stat (among a
// configurable candidate list) and applies a stat-stage change to that stat.
//
// Wires:
//   - 598 Malicious — "Lowers the foe's highest Attack and Defense stat"
//     (drop the higher of ATK vs DEF by -1 stage, drop the higher of SPATK
//     vs SPDEF by -1 stage).
// =============================================================================

import { type AbAttrBaseParams, PostSummonAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import type { EffectiveStat } from "#enums/stat";

export interface TargetHighestStatDropRule {
  /** Candidate stats — the one with the highest value gets dropped. */
  readonly candidates: readonly EffectiveStat[];
  /** Stage delta (negative for drops). */
  readonly stages: number;
}

export interface TargetHighestStatDropOptions {
  /** Rules — each rule targets one stat-group per opposing pokemon. */
  readonly rules: readonly TargetHighestStatDropRule[];
}

export class TargetHighestStatDropAbAttr extends PostSummonAbAttr {
  private readonly rules: readonly TargetHighestStatDropRule[];

  constructor(options: TargetHighestStatDropOptions) {
    super(true);
    if (options.rules.length === 0) {
      throw new Error("[TargetHighestStatDropAbAttr] options.rules must be non-empty");
    }
    this.rules = options.rules;
  }

  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    const opponents = pokemon.getOpponents();
    return opponents.length > 0;
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const opponents = pokemon.getOpponents();
    for (const opp of opponents) {
      if (!opp || opp.isFainted()) {
        continue;
      }
      for (const rule of this.rules) {
        let bestStat: EffectiveStat = rule.candidates[0];
        let bestValue = -1;
        for (const stat of rule.candidates) {
          const value = opp.getStat(stat, false);
          if (value > bestValue) {
            bestValue = value;
            bestStat = stat;
          }
        }
        globalScene.phaseManager.unshiftNew(
          "StatStageChangePhase",
          opp.getBattlerIndex(),
          false,
          [bestStat],
          rule.stages,
        );
      }
    }
  }
}
