/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `incoming-accuracy-multiplier` archetype.
//
// Multiplies the accuracy of moves TARGETING the holder by a fixed factor — an
// evasion-like defensive accuracy debuff that ER abilities apply to incoming
// attacks. Covers:
//   - 334 Bad Luck  — "Foes ... deal 5% less accuracy" (multiplier 0.95).
//   - 608 Ol        — "Reduces accuracy of single-target moves aimed at the
//                      user by 20%. Spread moves retain normal accuracy."
//                      (multiplier 0.80, singleTargetOnly).
//
// Why subclass WonderSkin (zero engine edits)
// -------------------------------------------
// `Move.calculateBattleAccuracy` (move.ts) already applies `WonderSkinAbAttr`
// to the TARGET with the move-accuracy NumberHolder:
//   applyAbAttrs("WonderSkinAbAttr", { pokemon: target, move, accuracy })
// `applyAbAttrs` matches by `instanceof`, so a subclass of WonderSkinAbAttr is
// invoked by that same call — no new dispatch key and no edit to the accuracy
// pipeline. We fully override `canApply`/`apply`, so vanilla Wonder Skin's
// status-move→50 behavior does not run for our instances. Only Pokemon that
// actually carry this ability are affected; nothing else changes.
// =============================================================================

import { type PreDefendModifyAccAbAttrParams, WonderSkinAbAttr } from "#abilities/ab-attrs";
import { MoveTarget } from "#enums/move-target";

/** Move targets that hit more than one Pokemon (excluded by `singleTargetOnly`). */
const SPREAD_TARGETS: ReadonlySet<MoveTarget> = new Set([
  MoveTarget.ALL_OTHERS,
  MoveTarget.ALL_NEAR_OTHERS,
  MoveTarget.ALL_NEAR_ENEMIES,
  MoveTarget.ALL_ENEMIES,
  MoveTarget.ALL,
  MoveTarget.ENEMY_SIDE,
  MoveTarget.BOTH_SIDES,
  MoveTarget.USER_SIDE,
]);

export interface IncomingAccuracyMultiplierOptions {
  /** Accuracy multiplier applied to incoming moves. Must be > 0; < 1 to debuff. */
  readonly multiplier: number;
  /**
   * When true, only single-target moves are debuffed (spread moves keep normal
   * accuracy) — Ol's "single-target moves" clause.
   * @defaultValue `false`
   */
  readonly singleTargetOnly?: boolean;
}

export class IncomingAccuracyMultiplierAbAttr extends WonderSkinAbAttr {
  private readonly multiplier: number;
  private readonly singleTargetOnly: boolean;

  constructor(opts: IncomingAccuracyMultiplierOptions) {
    super();
    if (!(opts.multiplier > 0)) {
      throw new Error(`[IncomingAccuracyMultiplierAbAttr] multiplier must be > 0; got ${opts.multiplier}`);
    }
    this.multiplier = opts.multiplier;
    this.singleTargetOnly = opts.singleTargetOnly ?? false;
  }

  /** Read-only accessor for the configured multiplier. */
  public getMultiplier(): number {
    return this.multiplier;
  }

  public override canApply({ accuracy, move }: PreDefendModifyAccAbAttrParams): boolean {
    // Never-miss moves use the -1 sentinel; leave them untouched.
    if (accuracy.value < 0) {
      return false;
    }
    if (this.singleTargetOnly && SPREAD_TARGETS.has(move.moveTarget)) {
      return false;
    }
    return true;
  }

  public override apply({ accuracy }: PreDefendModifyAccAbAttrParams): void {
    accuracy.value *= this.multiplier;
  }
}
