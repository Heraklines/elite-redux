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
import { gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { HitResult } from "#enums/hit-result";
import type { MoveFlags } from "#enums/move-flags";
import type { MoveId } from "#enums/move-id";

const USED_FLAG = Symbol("FirstMovePriority.used");

function hasUsedPriority(pokemon: ChangeMovePriorityAbAttrParams["pokemon"]): boolean {
  return !!(pokemon.tempSummonData as unknown as Record<symbol, boolean>)[USED_FLAG];
}

function setUsedPriority(pokemon: ChangeMovePriorityAbAttrParams["pokemon"], used: boolean): void {
  (pokemon.tempSummonData as unknown as Record<symbol, boolean>)[USED_FLAG] = used;
}

export class FirstFlaggedMovePriorityAbAttr extends ChangeMovePriorityAbAttr {
  private readonly flags: readonly MoveFlags[];
  private readonly amount: number;

  constructor(flag: MoveFlags | readonly MoveFlags[], amount = 1) {
    super(() => false, 0);
    this.flags = Array.isArray(flag) ? flag : [flag];
    this.amount = amount;
  }

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: ChangeMovePriorityAbAttrParams) => boolean) | undefined;

  /**
   * Tier B split (ability studio spec 3.1): `guards`, then `gate`, in the original clause order
   * (the unspent test first, the flag test second). There is no `prepare` and no `residual`.
   */
  override canApply(params: ChangeMovePriorityAbAttrParams): boolean {
    return gatedCanApply<ChangeMovePriorityAbAttrParams>(this, params);
  }

  /** The one-shot memory: the +1 priority has not been spent since the holder entered. Moved verbatim from `canApply`. */
  public guards({ pokemon }: ChangeMovePriorityAbAttrParams): boolean {
    return !hasUsedPriority(pokemon);
  }

  /** The replaceable condition: the move carries one of the configured flags (the printed flag, `move.hasFlag`). */
  public gate({ move }: ChangeMovePriorityAbAttrParams): boolean {
    return this.flags.some(flag => move.hasFlag(flag));
  }

  override apply({ priority }: ChangeMovePriorityAbAttrParams): void {
    priority.value += this.amount;
  }
}

export class ConsumeFirstFlaggedMovePriorityAbAttr extends PostAttackAbAttr {
  private readonly flags: readonly MoveFlags[];
  private readonly regainOnKo: boolean;

  constructor(flag: MoveFlags | readonly MoveFlags[], regainOnKo = false) {
    super();
    this.flags = Array.isArray(flag) ? flag : [flag];
    this.regainOnKo = regainOnKo;
  }

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  /** Tier B split (ability studio spec 3.1): `guards` (the hit landed), then `gate`, in the original clause order. */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  /** "After my attack lands": the hit result is one of the four landed results. Moved verbatim from `canApply`. */
  public guards({ hitResult }: PostMoveInteractionAbAttrParams): boolean {
    return [
      HitResult.EFFECTIVE,
      HitResult.SUPER_EFFECTIVE,
      HitResult.NOT_VERY_EFFECTIVE,
      HitResult.ONE_HIT_KO,
    ].includes(hitResult);
  }

  /** The replaceable condition: the move has a configured flag, or (when `regainOnKo`) the target fainted. */
  public gate({ move, opponent }: PostMoveInteractionAbAttrParams): boolean {
    return this.flags.some(flag => move.hasFlag(flag)) || (this.regainOnKo && opponent.isFainted());
  }

  override apply({ pokemon, move, opponent }: PostMoveInteractionAbAttrParams): void {
    if (this.flags.some(flag => move.hasFlag(flag))) {
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

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: AbAttrBaseParams) => boolean) | undefined;

  /** Tier B split (ability studio spec 3.1): `guards` (bonus unspent), then `gate`, in the original clause order. */
  override canApply(params: AbAttrBaseParams): boolean {
    return gatedCanApply<AbAttrBaseParams>(this, params);
  }

  /** The one-shot memory: the +1 priority has not been spent yet. Moved verbatim from `canApply`. */
  public guards({ pokemon }: AbAttrBaseParams): boolean {
    return !hasUsedPriority(pokemon);
  }

  /**
   * The replaceable condition. The just-executed move is the most recent history entry (pushed immediately
   * before ExecutedMoveAbAttr is applied). Consume only when it carries the flag.
   */
  public gate({ pokemon }: AbAttrBaseParams): boolean {
    const lastMove = pokemon.getLastXMoves(1)[0];
    return lastMove != null && (allMoves[lastMove.move]?.hasFlag(this.flag) ?? false);
  }

  override apply({ pokemon }: AbAttrBaseParams): void {
    setUsedPriority(pokemon, true);
  }
}

/**
 * Re-arms the one-shot {@linkcode FirstFlaggedMovePriorityAbAttr} boost when the
 * holder USES a specific move. This is the ER Cutthroat (743) "Resets if Sharpen
 * is used" clause: after the entry's first Keen Edge move has spent the +1
 * priority (consumed by {@linkcode ConsumeFirstFlaggedMovePriorityAbAttr}), using
 * Sharpen clears the used-flag so the NEXT slicing move regains the boost.
 *
 * Like {@linkcode ConsumeFirstFlaggedMoveOnUseAbAttr}, it extends
 * `ExecutedMoveAbAttr`, which fires when the move is pushed to history - so it
 * re-arms on the status move Sharpen regardless of whether it "lands".
 */
export class RearmFirstFlaggedMoveOnMoveAbAttr extends ExecutedMoveAbAttr {
  private readonly moveId: MoveId;

  constructor(moveId: MoveId) {
    super(false);
    this.moveId = moveId;
  }

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: AbAttrBaseParams) => boolean) | undefined;

  /** Tier B split (ability studio spec 3.1): the whole rule is the replaceable `gate`; no guard, no residual. */
  override canApply(params: AbAttrBaseParams): boolean {
    return gatedCanApply<AbAttrBaseParams>(this, params);
  }

  /** The replaceable condition. The just-executed move is the most recent history entry. */
  public gate({ pokemon }: AbAttrBaseParams): boolean {
    const lastMove = pokemon.getLastXMoves(1)[0];
    return lastMove != null && lastMove.move === this.moveId;
  }

  override apply({ pokemon }: AbAttrBaseParams): void {
    setUsedPriority(pokemon, false);
  }
}

export class FirstTurnPriorityClampAbAttr extends ChangeMovePriorityAbAttr {
  constructor() {
    super(() => false, 0);
  }

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: ChangeMovePriorityAbAttrParams) => boolean) | undefined;

  /** Tier B split (ability studio spec 3.1): the whole rule is the replaceable `gate`; no guard, no residual. */
  override canApply(params: ChangeMovePriorityAbAttrParams): boolean {
    return gatedCanApply<ChangeMovePriorityAbAttrParams>(this, params);
  }

  /** The replaceable condition: it is the holder's first turn out (library atom `time.first-turn`). */
  public gate({ pokemon }: ChangeMovePriorityAbAttrParams): boolean {
    return pokemon.tempSummonData.waveTurnCount === 1;
  }

  override apply({ priority }: ChangeMovePriorityAbAttrParams): void {
    priority.value = priority.value < 0 ? 0 : priority.value + 1;
  }
}
