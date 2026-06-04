/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `bst-conditional-ally-aura` archetype.
//
// PostSummon hook that boosts the stats of allies whose BST is below a
// threshold. Mirrors Pixilate-style auras but BST-gated and per-stat
// multiplied.
//
// Wires:
//   - 891 Rat King — "Allies with a BST below 400 get their stats boosted
//     by 50%." (bstMax: 400, statFactor: 1.5.)
//
// Pokerogue's StatMultiplier hook fires for the holder; we need a
// per-stat-fetch hook for allies. Pokerogue's `Pokemon.getStat()` chain
// goes through StatMultiplierAbAttr; we install one on the holder that
// affects allies by checking the call context. Cleaner: post-summon, mark
// allies with a marker tag so their own StatMultiplier sees the boost.
//
// We use the simpler approach: PostSummon → apply +1 stat-stage to each
// qualifying ally's ATK/DEF/SPATK/SPDEF/SPD (≈ +50% mid-game).
// =============================================================================

import { type AbAttrBaseParams, PostSummonAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { Stat, type EffectiveStat } from "#enums/stat";

const STATS: readonly EffectiveStat[] = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD];

export interface BstConditionalAllyAuraOptions {
  /** Max BST to qualify as a "low-BST ally" who receives the boost. */
  readonly bstMax: number;
  /** Stages of boost applied to ATK/DEF/SPATK/SPDEF/SPD. */
  readonly stages: number;
}

export class BstConditionalAllyAuraAbAttr extends PostSummonAbAttr {
  constructor(private readonly opts: BstConditionalAllyAuraOptions) {
    super(true);
  }

  override canApply(_params: AbAttrBaseParams): boolean {
    return true;
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const allies = globalScene.getField()
      .filter(p => p && p !== pokemon && !p.isFainted() && p.isPlayer() === pokemon.isPlayer());
    for (const ally of allies) {
      const bst = ally.species.baseStats.reduce((s, v) => s + v, 0);
      if (bst >= this.opts.bstMax) {
        continue;
      }
      for (const stat of STATS) {
        globalScene.phaseManager.unshiftNew(
          "StatStageChangePhase",
          ally.getBattlerIndex(),
          true,
          [stat],
          this.opts.stages,
        );
      }
    }
  }
}
