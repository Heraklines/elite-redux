/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-ally-faint` archetype.
//
// Subclasses pokerogue's PostKnockOutAbAttr to gate on "the KO'd pokemon is
// an ally of the holder", then dispatches one or more StatStageChangePhase
// instances on the HOLDER. Wires the ER cluster of abilities that react to
// a teammate fainting (Avenger 1.5x boost after teammate faint, Soul Harvest
// fainted teammates increase offenses, etc.).
//
// Pokerogue's vanilla PostKnockOutAbAttr fires when ANY pokemon is knocked
// out (the param `victim`). This subclass narrows to allies-of-holder by
// checking the same `isPlayer()` side as the holder and excluding the
// holder itself.
// =============================================================================

import { PostKnockOutAbAttr, type PostKnockOutAbAttrParams } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import type { BattleStat } from "#enums/stat";

/** A single stat-stage delta dispatched on the holder after an ally faints. */
export interface AllyFaintStatChange {
  readonly stat: BattleStat;
  readonly stages: number;
}

/** Construction options for {@linkcode PostAllyFaintStatChangeAbAttr}. */
export interface PostAllyFaintStatChangeOptions {
  /** One or more stat-stage deltas dispatched in order on the holder. */
  readonly stats: readonly AllyFaintStatChange[];
}

/**
 * Parameterized AbAttr implementing the `post-ally-faint` archetype. Fires
 * after an ally of the holder is knocked out; dispatches the configured
 * stat-stage changes on the holder.
 */
export class PostAllyFaintStatChangeAbAttr extends PostKnockOutAbAttr {
  private readonly stats: readonly AllyFaintStatChange[];

  constructor(options: PostAllyFaintStatChangeOptions) {
    super();
    if (options.stats.length === 0) {
      throw new Error("[PostAllyFaintStatChangeAbAttr] options.stats must be non-empty");
    }
    for (const change of options.stats) {
      if (change.stages === 0) {
        throw new Error(`[PostAllyFaintStatChangeAbAttr] stages must be non-zero; got 0 for stat ${change.stat}`);
      }
    }
    this.stats = options.stats;
  }

  override canApply(params: PostKnockOutAbAttrParams): boolean {
    const { pokemon, victim } = params;
    // Same side AND not the holder itself (holder fainting fires
    // PostFaintAbAttr, not this).
    return victim.id !== pokemon.id && victim.isPlayer() === pokemon.isPlayer();
  }

  override apply(params: PostKnockOutAbAttrParams): void {
    if (params.simulated) {
      return;
    }
    const { pokemon } = params;
    for (const change of this.stats) {
      globalScene.phaseManager.unshiftNew(
        "StatStageChangePhase",
        pokemon.getBattlerIndex(),
        true,
        [change.stat],
        change.stages,
      );
    }
  }
}
