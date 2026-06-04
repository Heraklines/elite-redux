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
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import type { Move } from "#data/moves/move";
import type { MoveCategory } from "#enums/move-category";
import type { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
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

// =============================================================================
// Move-intrinsic type-conditional always-hit.
//
// Several ER moves carry a "Never misses if user is <Type>-type" clause that is
// a property of the MOVE, not of any ability (so it applies to every user of
// that type). This mirrors pokerogue's built-in Toxic rule (Toxic never misses
// when used by a Poison-type, hardcoded in `MoveEffectPhase`). We model the ER
// additions the same way: a small registry keyed by pokerogue move id, consulted
// once in `MoveEffectPhase.checkBypassAccAndInvuln`.
// =============================================================================

/**
 * ER moves whose accuracy check is bypassed entirely when the user is of a
 * specific type. Keyed by pokerogue move id (vanilla `MoveId` or the resolved
 * id of an ER custom).
 */
export const ER_USER_TYPE_ALWAYS_HIT: ReadonlyMap<number, PokemonType> = new Map<number, PokemonType>([
  [MoveId.LEECH_SEED, PokemonType.GRASS], // er 73
  [MoveId.THUNDER_WAVE, PokemonType.ELECTRIC], // er 86
  [MoveId.WILL_O_WISP, PokemonType.FIRE], // er 261
  // Flash Freeze (er 811) is an ER custom — resolve its runtime id; Ice-typed.
  ...(ER_ID_MAP.moves[811] === undefined ? [] : ([[ER_ID_MAP.moves[811], PokemonType.ICE]] as [number, PokemonType][])),
]);

/**
 * ER moves whose accuracy check is bypassed while a specific weather is active
 * ("Never misses in fog"). Keyed by pokerogue move id. Vexing Void is an ER
 * custom (stable id); Eerie Spell is keyed by its vanilla `MoveId`.
 */
export const ER_WEATHER_ALWAYS_HIT: ReadonlyMap<number, readonly WeatherType[]> = new Map<
  number,
  readonly WeatherType[]
>([
  [MoveId.EERIE_SPELL, [WeatherType.FOG]], // er 754 — "Never misses in fog"
  // Vexing Void (er 974) is an ER custom — resolve its runtime id.
  ...(ER_ID_MAP.moves[974] === undefined
    ? []
    : ([[ER_ID_MAP.moves[974], [WeatherType.FOG]]] as [number, readonly WeatherType[]][])),
]);

/**
 * True when `move` has a move-intrinsic "never misses" clause that is currently
 * satisfied — either a "never misses if user is <Type>-type" clause met by the
 * user's type, or a "never misses in <weather>" clause met by the active
 * weather. Consulted by `MoveEffectPhase.checkBypassAccAndInvuln`.
 */
export function erMoveAlwaysHitsForUserType(move: Move, user: Pokemon): boolean {
  const requiredType = ER_USER_TYPE_ALWAYS_HIT.get(move.id);
  if (requiredType !== undefined && user.isOfType(requiredType)) {
    return true;
  }
  const weathers = ER_WEATHER_ALWAYS_HIT.get(move.id);
  if (weathers !== undefined) {
    const current = globalScene.arena.weather?.weatherType ?? WeatherType.NONE;
    if (weathers.includes(current)) {
      return true;
    }
  }
  return false;
}
