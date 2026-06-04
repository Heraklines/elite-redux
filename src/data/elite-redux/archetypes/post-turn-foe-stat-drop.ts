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
//   - 819 Serpent Bind / 818 Tentalock — "once trapped, their speed drops by one
//     stage each turn they remain on the field" (stat: SPD, stages: -1,
//     onlyIfTrapped: true — fires only against currently-TRAPPED opponents).
//   - 837 Chokehold — "when the user traps a target, they inflict paralysis and
//     drop their speed by one stage once every turn while trapped" (stat: SPD,
//     stages: -1, onlyIfTrapped: true, inflictStatus: PARALYSIS — the paralysis
//     lands once, since a re-attempt on an already-statused target no-ops).
// =============================================================================

import { type AbAttrBaseParams, PostTurnAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { BattlerTagType } from "#enums/battler-tag-type";
import type { BattleStat, EffectiveStat } from "#enums/stat";
import type { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";

export interface PostTurnFoeStatDropOptions {
  readonly stat: BattleStat;
  readonly stages: number;
  readonly trapAtStage?: number;
  /**
   * When true, only drop the stat on opponents that currently carry the
   * {@linkcode BattlerTagType.TRAPPED} tag. Used by Serpent Bind 819 ("once
   * trapped, their speed drops by one stage each turn they remain on the field").
   */
  readonly onlyIfTrapped?: boolean;
  /**
   * When set, also attempt to inflict this status on each eligible opponent each
   * turn. Lands at most once (a re-attempt on an already-statused target no-ops),
   * modeling Chokehold 837's "inflict paralysis ... while trapped".
   */
  readonly inflictStatus?: StatusEffect;
}

export class PostTurnFoeStatDropAbAttr extends PostTurnAbAttr {
  constructor(private readonly opts: PostTurnFoeStatDropOptions) {
    super();
  }

  private eligible(opp: Pokemon | undefined): boolean {
    if (!opp || opp.isFainted()) {
      return false;
    }
    return !this.opts.onlyIfTrapped || opp.getTag(BattlerTagType.TRAPPED) != null;
  }

  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    return pokemon.getOpponents().some(o => this.eligible(o));
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    for (const opp of pokemon.getOpponents()) {
      if (!this.eligible(opp)) {
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
      if (this.opts.inflictStatus !== undefined && opp.canSetStatus(this.opts.inflictStatus, true, false, pokemon)) {
        opp.trySetStatus(this.opts.inflictStatus, pokemon);
      }
    }
  }
}
