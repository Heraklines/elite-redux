/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase D bespoke: "lower target stat when using a flag-X attack".
//
// Mirror of {@linkcode StatBoostOnFlagAttackAbAttr} but the stat-stage change
// targets the OPPONENT, not the user. Models ER's "weapon-affinity drops"
// cluster — Denting Blows (Hammer moves lower Defense), Chainsaw (Keen edge
// attacks lower defense by -1), and the related ER bestiary of "fang/horn/
// blade leaves the foe weaker" abilities.
//
// Why a new AbAttr instead of composing existing primitives?
//   - pokerogue's existing `PostAttackAbAttr` subclasses don't include a
//     "lower-stat-on-foe" variant. The closest sibling is
//     `StatBoostOnFlagAttackAbAttr` (the user-side analog), so we model this
//     as the opposite-target version. Sharing inheritance keeps the contract
//     surface symmetrical.
//   - The flag filter (HAMMER_BASED / SLICING_MOVE / PUNCHING_MOVE / etc.)
//     varies per ability — parameterize it.
//   - Stage delta is always negative for the opponent-targeting variant
//     (lowering rather than raising), but we still allow positive for symmetry
//     (e.g. an ability that "buffs the target on a flag attack" — unused in
//     ER today but the surface is the same).
//
// Sub-shapes currently in scope:
//   - 643 Denting Blows — `{ flag: HAMMER_BASED, stat: DEF, stages: -1 }`.
//   - 945 Chainsaw — `{ flag: SLICING_MOVE, stat: DEF, stages: -1 }`.
//
// Trigger semantics:
//   - Fires on POST-ATTACK (after the move resolves). The damage outcome
//     doesn't matter — even if the move misses or is fully resisted, the
//     stat drop still queues. (Matches `StatBoostOnFlagAttackAbAttr`.)
//   - Stacks against the same target — no once-per-turn lock. Pokerogue's
//     stat-stage cap (-6) handles the runaway.
//   - The drop applies to the opponent's stat (selfTarget = false in the
//     queued `StatStageChangePhase`).
// =============================================================================

import { PostAttackAbAttr, type PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import type { MoveFlags } from "#enums/move-flags";
import type { BattleStat } from "#enums/stat";

/** Construction options for {@linkcode StatDebuffOnFlagAttackAbAttr}. */
export interface StatDebuffOnFlagAttackOptions {
  /**
   * The {@linkcode MoveFlags} bit the used move must carry for the proc to
   * fire. Common flag-cluster sources: `HAMMER_BASED`, `SLICING_MOVE`,
   * `PUNCHING_MOVE`, `KICKING_MOVE`, `BITING_MOVE`.
   */
  readonly flag: MoveFlags;
  /**
   * The stat to mutate on the OPPONENT when the proc fires. Must be a
   * {@linkcode BattleStat} — HP is rejected at the type level.
   */
  readonly stat: BattleStat;
  /**
   * Number of stages to change the stat. Must be non-zero; negative drops
   * (the common case), positive raises (allowed for symmetry but unused in
   * ER today).
   */
  readonly stages: number;
}

/**
 * Parameterized `AbAttr` lowering an opponent-side stat by N stages after
 * using a move matching the configured flag.
 *
 * @remarks
 * Extends {@linkcode PostAttackAbAttr}. The default `attackCondition` in the
 * base class already gates on "move is damaging" (MoveCategory !== STATUS).
 * We override `canApply` to additionally check the flag. The status-move
 * gate is preserved — Denting Blows doesn't trigger from a status-class
 * hammer move (none exist today, but the contract is the same).
 *
 * Pokerogue's stat-stage cap (-6) is handled by `StatStageChangePhase`; we
 * unconditionally queue the phase and let the cap apply naturally.
 */
export class StatDebuffOnFlagAttackAbAttr extends PostAttackAbAttr {
  private readonly flag: MoveFlags;
  private readonly stat: BattleStat;
  private readonly stages: number;

  constructor(opts: StatDebuffOnFlagAttackOptions) {
    if (opts.stages === 0 || !Number.isInteger(opts.stages)) {
      throw new Error(`[StatDebuffOnFlagAttackAbAttr] stages must be a non-zero integer; got ${opts.stages}`);
    }
    super();
    this.flag = opts.flag;
    this.stat = opts.stat;
    this.stages = opts.stages;
  }

  /** Read-only accessor: the configured flag filter. */
  public getFlag(): MoveFlags {
    return this.flag;
  }

  /** Read-only accessor: the stat to mutate on the opponent. */
  public getStat(): BattleStat {
    return this.stat;
  }

  /** Read-only accessor: the stage delta. */
  public getStages(): number {
    return this.stages;
  }

  public override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    if (!super.canApply(params)) {
      return false;
    }
    const { pokemon, opponent, move } = params;
    return move.doesFlagEffectApply({ flag: this.flag, user: pokemon, target: opponent });
  }

  public override apply(params: PostMoveInteractionAbAttrParams): void {
    if (params.simulated) {
      return;
    }
    const { opponent } = params;
    // selfTarget = false → the change applies to the opponent (drops the
    // target's stat). Pokerogue's `StatStageChangePhase` clamps to [-6, 6].
    globalScene.phaseManager.unshiftNew(
      "StatStageChangePhase",
      opponent.getBattlerIndex(),
      false,
      [this.stat],
      this.stages,
    );
  }
}
