/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `foe-strongest-stat-self-boost` archetype.
//
// PostSummon hook: introspects the strongest opponent's strongest stat
// (among ATK/SPATK only — physical vs special preference for "strong
// point") and applies a +N stat-stage to the holder's MATCHING side
// (sharply raises an offensive stat that counters the foe's offensive
// strength).
//
// Wires:
//   - 896 Spyware — "Sharply raises a stat based on foe's strong point."
//     If foe's ATK > SPATK, raise holder's DEF +2; else raise SPDEF +2.
// =============================================================================

import { type AbAttrBaseParams, PostSummonAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { Stat, type BattleStat } from "#enums/stat";

export interface FoeStrongestStatSelfBoostOptions {
  /** Stage delta applied (commonly +2 for "sharply"). */
  readonly stages: number;
  /** Stat applied when foe is physical-dominant. */
  readonly physicalCounter: BattleStat;
  /** Stat applied when foe is special-dominant. */
  readonly specialCounter: BattleStat;
}

export class FoeStrongestStatSelfBoostAbAttr extends PostSummonAbAttr {
  constructor(private readonly opts: FoeStrongestStatSelfBoostOptions) {
    super(true);
  }

  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    return pokemon.getOpponents().some(o => o && !o.isFainted());
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const opponents = pokemon.getOpponents().filter(o => o && !o.isFainted());
    let foePhysical = 0;
    let foeSpecial = 0;
    for (const opp of opponents) {
      foePhysical = Math.max(foePhysical, opp.getStat(Stat.ATK, false));
      foeSpecial = Math.max(foeSpecial, opp.getStat(Stat.SPATK, false));
    }
    const target = foePhysical >= foeSpecial ? this.opts.physicalCounter : this.opts.specialCounter;
    globalScene.phaseManager.unshiftNew(
      "StatStageChangePhase",
      pokemon.getBattlerIndex(),
      true,
      [target],
      this.opts.stages,
    );
  }
}
