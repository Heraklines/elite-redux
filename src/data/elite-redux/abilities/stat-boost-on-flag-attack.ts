/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase D bespoke: "self stat boost when using a flag-X attack".
//
// Models ER's "weapon affinity" abilities — Growing Tooth (biting moves boost
// Atk), Hardened Sheath (horn moves boost Atk), and similar. The trigger
// surface is `PostAttackAbAttr` (same surface Beast Boost uses for its post-KO
// stat lift), with a custom condition that gates on a move flag.
//
// Why a new AbAttr instead of composing existing primitives?
//   - pokerogue's existing `PostAttackAbAttr` subclasses (Steal-Held-Item,
//     ApplyStatusEffect, ApplyBattlerTag) don't include "self stat-stage
//     change" as a sibling. The closest is `Beast Boost`, but that's a
//     post-KO trigger gated on a separate `PostFaintAbAttr`-style hook.
//   - The flag filter (BITING / HORN / KEEN_EDGE / PUNCHING_MOVE / SOUND_BASED)
//     varies per ability — parameterize it.
//
// Sub-shapes currently in scope:
//   - 289 Growing Tooth — `{ flag: BITING_MOVE, stat: ATK, stages: 1 }`.
//   - 391 Hardened Sheath — `{ flag: HORN_BASED, stat: ATK, stages: 1 }`.
//
// Trigger semantics:
//   - Fires on POST-ATTACK (after the move resolves). The damage outcome
//     doesn't matter — even if the move misses or is fully resisted, the user
//     still gets the stat lift (matches ER's "horn-based proc" intent).
//     If we want to gate on "actually dealt damage" we can add a hitResult
//     check; today none of the wired abilities do.
//   - Stacks with self with each instance of the matching flag move — no
//     once-per-turn / once-per-switch-in lock. Pokerogue's stat-stage cap
//     (+6) handles the runaway.
// =============================================================================

import { PostAttackAbAttr, type PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import type { MoveFlags } from "#enums/move-flags";
import type { BattleStat } from "#enums/stat";

/** Construction options for {@linkcode StatBoostOnFlagAttackAbAttr}. */
export interface StatBoostOnFlagAttackOptions {
  /**
   * The {@linkcode MoveFlags} bit the used move must carry for the proc to
   * fire. Common flag-cluster sources: `BITING_MOVE`, `HORN_BASED`,
   * `PUNCHING_MOVE`, `KEEN_EDGE`, `SOUND_BASED`.
   */
  readonly flag: MoveFlags;
  /**
   * The stat to lift on the user when the proc fires. Must be a
   * {@linkcode BattleStat} — HP is rejected at the type level.
   */
  readonly stat: BattleStat;
  /**
   * Number of stages to raise the stat. Must be non-zero; positive raises,
   * negative lowers (rare but the archetype allows it for symmetry).
   */
  readonly stages: number;
}

/**
 * Parameterized `AbAttr` raising a user-side stat by N stages after using a
 * move matching the configured flag.
 *
 * @remarks
 * Extends {@linkcode PostAttackAbAttr}. The default `attackCondition` in the
 * base class already gates on "move is damaging" (MoveCategory !== STATUS).
 * We override `canApply` to additionally check the flag. The status-move
 * gate is preserved — Growing Tooth doesn't trigger from a status-class
 * biting move (none exist today, but the contract is the same).
 *
 * Pokerogue's stat-stage cap (+6) is handled by `StatStageChangePhase`; we
 * unconditionally queue the phase and let the cap apply naturally.
 */
export class StatBoostOnFlagAttackAbAttr extends PostAttackAbAttr {
  private readonly flag: MoveFlags;
  private readonly stat: BattleStat;
  private readonly stages: number;

  constructor(opts: StatBoostOnFlagAttackOptions) {
    if (opts.stages === 0 || !Number.isInteger(opts.stages)) {
      throw new Error(`[StatBoostOnFlagAttackAbAttr] stages must be a non-zero integer; got ${opts.stages}`);
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

  /** Read-only accessor: the stat to lift. */
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
    // `doesFlagEffectApply` honors per-user / per-target overrides (e.g.
    // Long Reach turns off MAKES_CONTACT). For BITING_MOVE / HORN_BASED /
    // etc. that's a no-op but the call is the canonical way to check the bit.
    return move.doesFlagEffectApply({ flag: this.flag, user: pokemon, target: opponent });
  }

  public override apply(params: PostMoveInteractionAbAttrParams): void {
    if (params.simulated) {
      return;
    }
    const { pokemon } = params;
    globalScene.phaseManager.unshiftNew(
      "StatStageChangePhase",
      pokemon.getBattlerIndex(),
      true,
      [this.stat],
      this.stages,
    );
  }
}
