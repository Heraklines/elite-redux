/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-turn-foe-stat-drop` archetype.
//
// PostTurn hook: drops a stat on each opposing pokemon. If the opponent's
// stage in that stat reaches `trapAtStage`, additionally apply a trap tag.
//
// Wires:
//   - 943 Sap Trap — "Lowers foe's speed at the end of turns. At -3 they
//     get trapped." (stat: SPD, stages: -1, trapAtStage: -3.)
// =============================================================================

import { type AbAttrBaseParams, PostTurnAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { BattlerTagType } from "#enums/battler-tag-type";
import type { BattleStat, EffectiveStat } from "#enums/stat";

export interface PostTurnFoeStatDropOptions {
  readonly stat: BattleStat;
  readonly stages: number;
  readonly trapAtStage?: number;
}

export class PostTurnFoeStatDropAbAttr extends PostTurnAbAttr {
  constructor(private readonly opts: PostTurnFoeStatDropOptions) {
    super();
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
        [this.opts.stat],
        this.opts.stages,
      );
      if (this.opts.trapAtStage !== undefined) {
        const cur = opp.getStatStage(this.opts.stat as unknown as EffectiveStat);
        if (cur + this.opts.stages <= this.opts.trapAtStage) {
          opp.addTag(BattlerTagType.TRAPPED, 4, undefined, pokemon.id);
        }
      }
    }
  }
}
