/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase D bespoke: "lower target stat when the user attacks with
// a category-X move" cluster.
//
// Sibling primitive to {@linkcode StatDebuffOnFlagAttackAbAttr}. Where the
// flag variant gates on a `MoveFlags` bit, this gates on the move's
// {@linkcode MoveCategory} (PHYSICAL / SPECIAL). Models ER's "Whiplash" pattern
// ("Physical attacks lower defense") — the move category is the distinguisher,
// not a flag bit, so a separate primitive is the cleanest fit.
//
// Why not extend the flag variant?
//   - `MoveCategory` is a strict enum (PHYSICAL / SPECIAL / STATUS), not a
//     bitmask. Smuggling it into the flag-attack primitive would require
//     widening that surface to a union or adding a parallel field. Keeping a
//     sibling primitive matches the convention used by `StatBoostOnFlagAttack`
//     vs `StatDebuffOnFlagAttack` (the same payload, different target side).
//
// Sub-shape variants currently in scope:
//   - 722 Whiplash — `{ category: PHYSICAL, stat: DEF, stages: -1, target: "opponent" }`.
//
// Trigger semantics:
//   - Fires on POST-ATTACK (after the move resolves). The damage outcome
//     doesn't matter — even if the move misses or is fully resisted, the
//     stat drop still queues. Matches the convention in
//     `StatDebuffOnFlagAttackAbAttr`.
// =============================================================================

import { PostAttackAbAttr, type PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import type { MoveCategory } from "#enums/move-category";
import type { BattleStat } from "#enums/stat";

/** Construction options for {@linkcode StatChangeOnCategoryAttackAbAttr}. */
export interface StatChangeOnCategoryAttackOptions {
  /**
   * The {@linkcode MoveCategory} the used move must match for the proc to
   * fire. Must be PHYSICAL or SPECIAL — STATUS moves are already excluded by
   * the {@linkcode PostAttackAbAttr} parent's default condition.
   */
  readonly category: MoveCategory;
  /**
   * The {@linkcode BattleStat} to mutate.
   */
  readonly stat: BattleStat;
  /**
   * Number of stages to change the stat. Must be non-zero; negative drops,
   * positive raises.
   */
  readonly stages: number;
  /**
   * Whose stat gets the change. `"opponent"` (the target of the attack) for
   * the canonical Whiplash use case; `"self"` for symmetry / future ER
   * abilities.
   */
  readonly target: "self" | "opponent";
}

/**
 * Parameterized `AbAttr` mutating either the user's or the opponent's stat
 * by N stages after using a move of a configured category.
 *
 * @remarks
 * Extends {@linkcode PostAttackAbAttr}. The parent's default `attackCondition`
 * gates on "move is damaging" (MoveCategory !== STATUS); we add a category-
 * equality check on top.
 *
 * Pokerogue's stat-stage cap ([-6, +6]) is handled by `StatStageChangePhase`;
 * we unconditionally queue the phase and let the cap apply naturally.
 */
export class StatChangeOnCategoryAttackAbAttr extends PostAttackAbAttr {
  private readonly category: MoveCategory;
  private readonly stat: BattleStat;
  private readonly stages: number;
  private readonly target: "self" | "opponent";

  constructor(opts: StatChangeOnCategoryAttackOptions) {
    if (opts.stages === 0 || !Number.isInteger(opts.stages)) {
      throw new Error(`[StatChangeOnCategoryAttackAbAttr] stages must be a non-zero integer; got ${opts.stages}`);
    }
    super();
    this.category = opts.category;
    this.stat = opts.stat;
    this.stages = opts.stages;
    this.target = opts.target;
  }

  /** Read-only accessor: the configured move category filter. */
  public getCategory(): MoveCategory {
    return this.category;
  }

  /** Read-only accessor: the stat to mutate. */
  public getStat(): BattleStat {
    return this.stat;
  }

  /** Read-only accessor: the stage delta. */
  public getStages(): number {
    return this.stages;
  }

  /** Read-only accessor: which side's stat changes. */
  public getTarget(): "self" | "opponent" {
    return this.target;
  }

  public override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    if (!super.canApply(params)) {
      return false;
    }
    return params.move.category === this.category;
  }

  public override apply(params: PostMoveInteractionAbAttrParams): void {
    if (params.simulated) {
      return;
    }
    const subject = this.target === "self" ? params.pokemon : params.opponent;
    globalScene.phaseManager.unshiftNew(
      "StatStageChangePhase",
      subject.getBattlerIndex(),
      this.target === "self",
      [this.stat],
      this.stages,
    );
  }
}
