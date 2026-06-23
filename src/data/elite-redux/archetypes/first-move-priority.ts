/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  type AbAttrBaseParams,
  ChangeMovePriorityAbAttr,
  type ChangeMovePriorityAbAttrParams,
  ExecutedMoveAbAttr,
  PostAttackAbAttr,
  type PostMoveInteractionAbAttrParams,
} from "#abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import { HitResult } from "#enums/hit-result";
import type { MoveFlags } from "#enums/move-flags";

const USED_FLAG = Symbol("FirstMovePriority.used");

function hasUsedPriority(pokemon: ChangeMovePriorityAbAttrParams["pokemon"]): boolean {
  return !!(pokemon.tempSummonData as unknown as Record<symbol, boolean>)[USED_FLAG];
}

function setUsedPriority(pokemon: ChangeMovePriorityAbAttrParams["pokemon"], used: boolean): void {
  (pokemon.tempSummonData as unknown as Record<symbol, boolean>)[USED_FLAG] = used;
}

export class FirstFlaggedMovePriorityAbAttr extends ChangeMovePriorityAbAttr {
  private readonly flag: MoveFlags;

  constructor(flag: MoveFlags) {
    super(() => false, 0);
    this.flag = flag;
  }

  override canApply({ pokemon, move }: ChangeMovePriorityAbAttrParams): boolean {
    return !hasUsedPriority(pokemon) && move.hasFlag(this.flag);
  }

  override apply({ priority }: ChangeMovePriorityAbAttrParams): void {
    priority.value += 1;
  }
}

export class ConsumeFirstFlaggedMovePriorityAbAttr extends PostAttackAbAttr {
  private readonly flag: MoveFlags;
  private readonly regainOnKo: boolean;

  constructor(flag: MoveFlags, regainOnKo = false) {
    super();
    this.flag = flag;
    this.regainOnKo = regainOnKo;
  }

  override canApply({ move, hitResult, opponent }: PostMoveInteractionAbAttrParams): boolean {
    const landed = [
      HitResult.EFFECTIVE,
      HitResult.SUPER_EFFECTIVE,
      HitResult.NOT_VERY_EFFECTIVE,
      HitResult.ONE_HIT_KO,
    ].includes(hitResult);
    return landed && (move.hasFlag(this.flag) || (this.regainOnKo && opponent.isFainted()));
  }

  override apply({ pokemon, move, opponent }: PostMoveInteractionAbAttrParams): void {
    if (move.hasFlag(this.flag)) {
      setUsedPriority(pokemon, true);
    }
    if (this.regainOnKo && opponent.isFainted()) {
      setUsedPriority(pokemon, false);
    }
  }
}

/**
 * Consumes the {@linkcode FirstFlaggedMovePriorityAbAttr} boost the first time the
 * holder USES a move carrying {@linkcode flag} - even if that move misses, is
 * immune, or otherwise fails to land. This is the ER Coil Up (302) semantics
 * ("consumed the first time a biting move is used"): unlike
 * {@linkcode ConsumeFirstFlaggedMovePriorityAbAttr} (a PostAttack hook that only
 * fires on a landed hit), this extends `ExecutedMoveAbAttr`, which fires when the
 * move is pushed to history - BEFORE the per-target hit checks - so a non-landing
 * biting move still spends the boost. (#632)
 */
export class ConsumeFirstFlaggedMoveOnUseAbAttr extends ExecutedMoveAbAttr {
  private readonly flag: MoveFlags;

  constructor(flag: MoveFlags) {
    super(false);
    this.flag = flag;
  }

  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    if (hasUsedPriority(pokemon)) {
      return false;
    }
    // The just-executed move is the most recent history entry (pushed immediately
    // before ExecutedMoveAbAttr is applied). Consume only when it carries the flag.
    const lastMove = pokemon.getLastXMoves(1)[0];
    return lastMove != null && (allMoves[lastMove.move]?.hasFlag(this.flag) ?? false);
  }

  override apply({ pokemon }: AbAttrBaseParams): void {
    setUsedPriority(pokemon, true);
  }
}

export class FirstTurnPriorityClampAbAttr extends ChangeMovePriorityAbAttr {
  constructor() {
    super(() => false, 0);
  }

  override canApply({ pokemon }: ChangeMovePriorityAbAttrParams): boolean {
    return pokemon.tempSummonData.waveTurnCount === 1;
  }

  override apply({ priority }: ChangeMovePriorityAbAttrParams): void {
    priority.value = priority.value < 0 ? 0 : priority.value + 1;
  }
}
