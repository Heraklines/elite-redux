/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `conditional-always-hit` primitive.
//
// Models ER ROM's per-move accuracy overrides where an ability forces
// moveAcc = 100 only for moves matching a predicate. From ER C source
// (vendor/elite-redux/source/src/battle_script_commands.c:1910..1947):
//
//   case 327 HYPNOTIST     → user uses MOVE_HYPNOSIS
//   case 368 SIGHTING_SYSTEM → any move (unconditional — use vanilla AlwaysHit)
//   case 403 ROUNDHOUSE    → move has FLAG_STRIKER_BOOST (= KICKING_MOVE)
//   case 377 ARTILLERY     → move has FLAG_MEGA_LAUNCHER_BOOST (= PULSE_MOVE)
//   case 421 SWEEPING_EDGE → move has FLAG_KEEN_EDGE_BOOST (= SLICING_MOVE)
//   case 422 GIFTED_MIND   → move is status (IS_MOVE_STATUS)
//   case 439 ANGELS_WRATH  → move is in fixed move-id list
//
// Engine integration: `Pokemon.hasMoveAlwaysHitAbility(move)` returns true
// if any ability attr matches, allowing the move-effect-phase accuracy
// bypass to short-circuit. The check is consulted explicitly in
// `MoveEffectPhase.checkBypassAccAndInvuln`.
// =============================================================================

import { AbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import type { Move } from "#data/moves/move";
import type { MoveCategory } from "#enums/move-category";
import type { MoveFlags } from "#enums/move-flags";
import type { MoveId } from "#enums/move-id";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import type { AbAttrBaseParams } from "#types/ability-types";

export interface ConditionalAlwaysHitOptions {
  /** When provided, only fires when the move has this flag set. */
  readonly flag?: MoveFlags;
  /** When provided, only fires when move.category is in this list. */
  readonly categories?: readonly MoveCategory[];
  /** When provided, only fires when move.id is in this list. */
  readonly moveIds?: readonly MoveId[];
  /** When provided, only fires while the active weather is one of these. */
  readonly weather?: readonly WeatherType[];
  /**
   * When true, only fires when the move is super-effective against the target
   * (type effectiveness > 1). Used by Fatal Precision ("Super-effective moves
   * never miss").
   */
  readonly superEffective?: boolean;
}

/**
 * AbAttr that toggles "always hit" for moves matching its predicate. Read
 * by `MoveEffectPhase.checkBypassAccAndInvuln` via
 * {@link Pokemon.hasConditionalAlwaysHit}.
 */
export class ConditionalAlwaysHitAbAttr extends AbAttr {
  public readonly opts: ConditionalAlwaysHitOptions;

  constructor(opts: ConditionalAlwaysHitOptions) {
    super(false);
    this.opts = opts;
  }

  override canApply(_params: AbAttrBaseParams): boolean {
    return true;
  }

  override apply(_params: AbAttrBaseParams): void {}

  /**
   * Returns true if the configured predicate matches the move/user/target.
   */
  public matches(move: Move, user: Pokemon, target: Pokemon): boolean {
    if (this.opts.flag !== undefined && !move.hasFlag(this.opts.flag)) {
      return false;
    }
    if (this.opts.categories !== undefined && !this.opts.categories.includes(move.category)) {
      return false;
    }
    if (this.opts.moveIds !== undefined && !this.opts.moveIds.includes(move.id)) {
      return false;
    }
    if (this.opts.weather !== undefined) {
      const current = globalScene.arena.weather?.weatherType ?? WeatherType.NONE;
      if (!this.opts.weather.includes(current)) {
        return false;
      }
    }
    if (this.opts.superEffective && target.getMoveEffectiveness(user, move) <= 1) {
      return false;
    }
    return true;
  }
}
