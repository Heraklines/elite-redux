/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `stat-change-on-attack` archetype primitive.
//
// PostAttack ability: when the holder lands a damaging move (optionally gated on
// a MoveFlag, e.g. KEEN_EDGE/SLICING), apply a stat-stage change to the target
// (offensive secondary, e.g. Sinister Claws "Keen Edge moves lower SpDef") or to
// the holder itself.
//
// Mirrors the move-side secondary stat-drop attrs (e.g. Acid's "may lower
// SpDef") but driven by an ability. Uses the same StatStageChangePhase the
// vanilla post-attack stat abilities use.
// =============================================================================

import { PostAttackAbAttr, type PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import type { MoveFlags } from "#enums/move-flags";
import type { BattleStat } from "#enums/stat";

/** Construction options for {@linkcode StatChangeOnAttackAbAttr}. */
export interface StatChangeOnAttackOptions {
  /** Stats to change when the proc fires. */
  readonly stats: readonly BattleStat[];
  /** Stage delta (negative to lower, positive to raise). */
  readonly stages: number;
  /**
   * When true, the change targets the HOLDER; otherwise the move's target.
   * @defaultValue `false` (target the opponent — offensive secondary).
   */
  readonly selfTarget?: boolean;
  /**
   * Optional move-flag gate — the proc only fires when the holder's move carries
   * this flag (e.g. {@linkcode MoveFlags.SLICING_MOVE} for "Keen Edge moves").
   * Omit to fire on any damaging move.
   */
  readonly flag?: MoveFlags;
  /**
   * Roll chance `[0,100]`; defaults to 100 (always). Uses
   * `pokemon.randBattleSeedInt(100) < chance`.
   * @defaultValue `100`
   */
  readonly chance?: number;
}

/**
 * Parameterized PostAttack `AbAttr` that changes a stat stage on hit. Used by ER
 * abilities such as `Sinister Claws` ("Keen Edge moves lower the target's
 * SpDef").
 */
export class StatChangeOnAttackAbAttr extends PostAttackAbAttr {
  private readonly stats: readonly BattleStat[];
  private readonly stages: number;
  private readonly selfTarget: boolean;
  private readonly flag: MoveFlags | undefined;
  private readonly chance: number;

  constructor(opts: StatChangeOnAttackOptions) {
    if (opts.stats.length === 0) {
      throw new Error("[StatChangeOnAttackAbAttr] must configure at least one stat");
    }
    if (opts.chance !== undefined && !(opts.chance >= 0 && opts.chance <= 100)) {
      throw new Error(`[StatChangeOnAttackAbAttr] chance must be in [0, 100]; got ${opts.chance}`);
    }
    super();
    this.stats = opts.stats;
    this.stages = opts.stages;
    this.selfTarget = opts.selfTarget ?? false;
    this.flag = opts.flag;
    this.chance = opts.chance ?? 100;
  }

  /** The configured stage delta (read-only accessor for tests). */
  public getStages(): number {
    return this.stages;
  }

  /** The configured move-flag gate, or `undefined` for any move. */
  public getFlag(): MoveFlags | undefined {
    return this.flag;
  }

  public override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { pokemon, move, opponent: target } = params;
    if (!super.canApply(params)) {
      return false;
    }
    if (!this.selfTarget && (target == null || pokemon === target)) {
      return false;
    }
    if (this.flag !== undefined && !move.hasFlag(this.flag)) {
      return false;
    }
    if (this.chance !== 100 && pokemon.randBattleSeedInt(100) >= this.chance) {
      return false;
    }
    return true;
  }

  public override apply(params: PostMoveInteractionAbAttrParams): void {
    if (params.simulated) {
      return;
    }
    const { pokemon, opponent: target } = params;
    const recipient = this.selfTarget ? pokemon : target;
    if (recipient == null) {
      return;
    }
    globalScene.phaseManager.unshiftNew(
      "StatStageChangePhase",
      recipient.getBattlerIndex(),
      this.selfTarget,
      [...this.stats],
      this.stages,
    );
  }
}
