/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1: `flag-damage-boost` archetype primitive.
//
// Implements taxonomy entry #4 (~15-20 ER abilities, plus all vanilla flag-
// based boosters like Iron Fist, Strong Jaw, Punk Rock, Mega Launcher).
// Parameterized AbAttr that multiplies a Pokemon's outgoing move power when
// the move's `MoveFlags` bitmask carries the configured flag. Mirrors
// {@linkcode TypeDamageBoostAbAttr} structurally — only the gating predicate
// differs (flag-match vs type-match).
//
// Base class: `MovePowerBoostAbAttr`. We deliberately do NOT extend pokerogue's
// existing `MoveTypePowerBoostAbAttr` (which is type-specific); instead we
// extend the more general `MovePowerBoostAbAttr` and pass a flag-checking
// closure as the condition.
//
// Examples (per taxonomy):
//   - `new FlagDamageBoostAbAttr({ flag: MoveFlags.SLICING_MOVE, multiplier: 1.3 })`
//     → `Keen Edge`.
//   - `new FlagDamageBoostAbAttr({ flag: MoveFlags.PUNCHING_MOVE, multiplier: 1.3 })`
//     → `Striker` (kicking variant requires the ER `KICKING_MOVE` flag once
//     it's added to {@linkcode MoveFlags}).
//   - `new FlagDamageBoostAbAttr({ flag: MoveFlags.SOUND_BASED, multiplier: 1.2 })`
//     → various sound-boosting passives.
//
// Sub-shapes not yet covered (deferred to later archetypes / composites):
//   - Flag + secondary effect (e.g. "Strong Jaw also flinches" — composes via
//     `CompositeAbAttr` with `ChanceStatusOnHitAbAttr`).
//   - Multi-flag (`Giant Wings` — "wing, wind or air-based"). Wire as multi-
//     instance, one per flag bit, until a `flags: MoveFlags[]` variant is added.
// =============================================================================

import { MovePowerBoostAbAttr } from "#abilities/ab-attrs";
import { MoveFlags } from "#enums/move-flags";

/** Construction options for {@linkcode FlagDamageBoostAbAttr}. */
export interface FlagDamageBoostAbAttrOptions {
  /**
   * The {@linkcode MoveFlags} bit that this boost gates on. Matched via
   * `(move.flags & flag) !== MoveFlags.NONE` so single-bit flags work as
   * configured and multi-bit masks (e.g. `SLICING_MOVE | PUNCHING_MOVE`) act
   * as "any of these" gates.
   */
  readonly flag: MoveFlags;
  /**
   * The damage multiplier applied when {@linkcode flag} is present on the move
   * AND the user is at or above {@linkcode lowHpThreshold} HP. Must be > 0.
   */
  readonly multiplier: number;
  /**
   * The damage multiplier applied when {@linkcode flag} is present on the move
   * AND the user is strictly below {@linkcode lowHpThreshold} HP. When omitted,
   * {@linkcode multiplier} is always used — no low-HP swap.
   */
  readonly lowHpMultiplier?: number;
  /**
   * The HP ratio (`hp / maxHp`) strictly below which {@linkcode lowHpMultiplier}
   * applies. Ignored when {@linkcode lowHpMultiplier} is undefined.
   * @defaultValue `1 / 3`
   */
  readonly lowHpThreshold?: number;
}

/**
 * Parameterized `AbAttr` implementing the `flag-damage-boost` archetype.
 *
 * Used (or will be used) by ER abilities such as `Keen Edge`, `Striker`,
 * `Archer`, `Mighty Horn`, `Super Slammer`, `Giant Wings`, plus the vanilla
 * flag-boost family (`Iron Fist`, `Strong Jaw`, `Punk Rock`,
 * `Mega Launcher`, …) that ER rebalances to its own multipliers.
 *
 * @remarks
 * Extends {@linkcode MovePowerBoostAbAttr}. The condition closure checks the
 * move's flags directly rather than going through `move.hasFlag()` — both
 * are equivalent at runtime and the closure form is what pokerogue's
 * `MoveTypePowerBoostAbAttr` uses, so this matches existing style.
 *
 * Flag matching uses `(move.flags & this.flag) !== MoveFlags.NONE`. When the
 * caller passes a *composite* flag (e.g. `MoveFlags.SLICING_MOVE | MoveFlags.PUNCHING_MOVE`)
 * the bitwise AND yields any-of semantics — the boost fires if the move has
 * ANY of the requested flag bits. This is intentional; ER's `Mighty Horn`
 * (horn-or-drill) is the canonical multi-bit example.
 */
export class FlagDamageBoostAbAttr extends MovePowerBoostAbAttr {
  private readonly flag: MoveFlags;
  private readonly highHpMultiplier: number;
  private readonly lowHpMultiplier: number | null;
  private readonly lowHpThreshold: number;

  constructor(opts: FlagDamageBoostAbAttrOptions) {
    if (!(opts.multiplier > 0)) {
      throw new Error(`[FlagDamageBoostAbAttr] multiplier must be > 0; got ${opts.multiplier}`);
    }
    if (opts.lowHpMultiplier !== undefined && !(opts.lowHpMultiplier > 0)) {
      throw new Error(`[FlagDamageBoostAbAttr] lowHpMultiplier must be > 0 when set; got ${opts.lowHpMultiplier}`);
    }
    if (opts.flag === MoveFlags.NONE) {
      throw new Error("[FlagDamageBoostAbAttr] flag must be a non-NONE MoveFlags bit");
    }
    super((_pokemon, _defender, move) => move.hasFlag(opts.flag), opts.multiplier, false);
    this.flag = opts.flag;
    this.highHpMultiplier = opts.multiplier;
    this.lowHpMultiplier = opts.lowHpMultiplier ?? null;
    this.lowHpThreshold = opts.lowHpThreshold ?? 1 / 3;
  }

  /** The configured flag bitmask (read-only accessor). */
  public getBoostFlag(): MoveFlags {
    return this.flag;
  }

  /** The configured high-HP multiplier. */
  public getHighHpMultiplier(): number {
    return this.highHpMultiplier;
  }

  /** The configured low-HP multiplier, or `null` if no low-HP swap is configured. */
  public getLowHpMultiplier(): number | null {
    return this.lowHpMultiplier;
  }

  /** The configured low-HP threshold (defaults to `1/3`). */
  public getLowHpThreshold(): number {
    return this.lowHpThreshold;
  }

  /**
   * Multiply `power.value` by the appropriate multiplier given the user's
   * current HP ratio. The super's `canApply` already verified the flag
   * predicate, so by the time `apply` runs we know the boost should fire.
   */
  public override apply(params: Parameters<MovePowerBoostAbAttr["apply"]>[0]): void {
    const mult = this.resolveMultiplier(params.pokemon.getHpRatio(true));
    params.power.value *= mult;
  }

  /**
   * Compute the multiplier that {@linkcode apply} would use for a Pokemon with
   * the given HP ratio. Exposed for tests and downstream archetype clients.
   */
  public resolveMultiplier(hpRatio: number): number {
    if (this.lowHpMultiplier !== null && hpRatio < this.lowHpThreshold) {
      return this.lowHpMultiplier;
    }
    return this.highHpMultiplier;
  }
}
