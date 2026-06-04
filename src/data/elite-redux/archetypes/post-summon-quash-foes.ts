/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-summon-quash-foes` archetype.
//
// PostSummon hook: applies the Quash-equivalent (force to move last) to
// all on-field opponents. Models via -6 SPD stage like contact-quash.
//
// Wires:
//   - 612 Rejection — "Applies Quash on switch-in."
// =============================================================================

import { type AbAttrBaseParams, PostSummonAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { Stat } from "#enums/stat";

export interface PostSummonQuashFoesOptions {
  readonly stages?: number;
}

export class PostSummonQuashFoesAbAttr extends PostSummonAbAttr {
  private readonly stages: number;

  constructor(options: PostSummonQuashFoesOptions = {}) {
    super(true);
    this.stages = options.stages ?? -6;
  }

  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    return pokemon.getOpponents().some(o => o && !o.isFainted());
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    for (const opp of pokemon.getOpponents()) {
      if (!opp || opp.isFainted()) {
        continue;
      }
      globalScene.phaseManager.unshiftNew(
        "StatStageChangePhase",
        opp.getBattlerIndex(),
        false,
        [Stat.SPD],
        this.stages,
      );
    }
  }
}
