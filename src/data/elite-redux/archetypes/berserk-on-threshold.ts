/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PostDefendAbAttr, type PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { MoveCategory } from "#enums/move-category";
import { Stat } from "#enums/stat";

const USED_KEY = "berserk-on-threshold";

export class BerserkOnThresholdAbAttr extends PostDefendAbAttr implements GatedAttr<PostMoveInteractionAbAttrParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  /** Tier B (ability studio spec 3.1): everything the rule decides lives in `gate`; there is no residual. */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  /**
   * The replaceable condition, in the original order: once per wave (the holder's own wave memory), a damaging
   * move from an opponent, and HP that just crossed the floored half line.
   */
  public gate({ pokemon, opponent, move, damage }: PostMoveInteractionAbAttrParams): boolean {
    if (pokemon.waveData.entryEffectsFired.has(USED_KEY)) {
      return false;
    }
    if (move.category === MoveCategory.STATUS || !pokemon.isOpponent(opponent)) {
      return false;
    }
    const threshold = Math.floor(pokemon.getMaxHp() / 2);
    return pokemon.hp <= threshold && pokemon.hp + damage > threshold;
  }

  override apply({ pokemon, simulated }: PostMoveInteractionAbAttrParams): void {
    if (simulated) {
      return;
    }
    pokemon.waveData.entryEffectsFired.add(USED_KEY);
    const stat =
      pokemon.getEffectiveStat(Stat.ATK, undefined, undefined, false, false, false, false, true)
      >= pokemon.getEffectiveStat(Stat.SPATK, undefined, undefined, false, false, false, false, true)
        ? Stat.ATK
        : Stat.SPATK;
    globalScene.phaseManager.unshiftNew("StatStageChangePhase", pokemon.getBattlerIndex(), true, [stat], 1);
  }
}
