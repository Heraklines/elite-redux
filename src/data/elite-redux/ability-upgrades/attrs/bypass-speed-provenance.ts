/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { type AbAttrBaseParams, BypassSpeedChanceAbAttr } from "#abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import { gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { claimCommandAbilityProvenance } from "./innate-slot-suppression";

export class ProvenanceBypassSpeedChanceAbAttr extends BypassSpeedChanceAbAttr {
  constructor(
    chance: number,
    private readonly provenanceKey: string,
  ) {
    super(chance);
  }

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: AbAttrBaseParams) => boolean) | undefined;

  /**
   * Tier B split (ability studio spec 3.1) of the parent's `canApply`, in its original clause order:
   * not simulated, then the chance roll, then "I chose a damaging move" and "the speed jump can be added".
   * The roll is drawn BEFORE the last two tests, so it is drawn even when the chosen move is a status move.
   */
  override canApply(params: AbAttrBaseParams): boolean {
    return gatedCanApply<AbAttrBaseParams>(this, params);
  }

  /** The preview never rolls (the parent's TODO: this could move into `apply`). Moved verbatim from the parent. */
  public guards({ simulated }: AbAttrBaseParams): boolean {
    return !simulated;
  }

  /** The replaceable condition: the chance roll, `pokemon.randBattleSeedInt(100) < chance`. Moved verbatim from the parent. */
  public gate({ pokemon }: AbAttrBaseParams): boolean {
    return pokemon.randBattleSeedInt(100) < this.chance;
  }

  /** Feasibility that stays in the class: the chosen move deals damage and the speed jump can still be added. */
  public residual({ pokemon }: AbAttrBaseParams): boolean {
    const turnCommand = globalScene.currentBattle.turnCommands[pokemon.getBattlerIndex()];
    const move = turnCommand?.move?.move ? allMoves[turnCommand.move.move] : null;
    const isDamageMove = move?.category === MoveCategory.PHYSICAL || move?.category === MoveCategory.SPECIAL;
    return isDamageMove && pokemon.canAddTag(BattlerTagType.BYPASS_SPEED);
  }

  override apply(params: AbAttrBaseParams): void {
    super.apply(params);
    claimCommandAbilityProvenance(params.pokemon, this.provenanceKey);
  }
}
