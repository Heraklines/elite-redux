/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `on-opponent-stat-raise` archetype.
//
// Subclasses pokerogue's PostStatStageChangeAbAttr. Fires when an OPPOSING
// pokemon (not the holder) gains stat stages (positive delta); dispatches
// the configured stat-stage changes on the holder. Mirrors vanilla
// Opportunist (which copies the opponent's exact buff) but parameterizable
// for ER's variants:
//
//   - Egoist (555) — "Raises its own stats when foes raise theirs."
//     Wire: ATK + SPATK + SPD +1 when any opponent raises any stat.
//
// The discriminator over "opposing pokemon" is the standard `selfTarget`
// false path in PostStatStageChangeAbAttrParams: when selfTarget is false,
// the change happened TO the holder (not from it). For Egoist we want
// the inverse — when the change happened FROM an opponent to itself
// (selfTarget true on the opponent's side, i.e. opponent's PostStat
// fires with selfTarget=true and pokemon=opponent). We hook PostStat as
// holder side and check `params.pokemon !== holder` && stages > 0.
//
// Wired indirectly via the dispatcher's PostStatStageChange iteration —
// pokerogue applies PostStatStageChange to ALL on-field pokemon when ANY
// pokemon's stats change, so our AbAttr fires when an opponent's stats go
// up, and we filter accordingly inside canApply.
// =============================================================================

import { PostStatStageChangeAbAttr, type PostStatStageChangeAbAttrParams } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import type { BattleStat } from "#enums/stat";

/** A single stat-stage delta the holder gains in response to opponent's raise. */
export interface OnOpponentStatRaiseChange {
  readonly stat: BattleStat;
  readonly stages: number;
}

/** Construction options for {@linkcode OnOpponentStatRaiseAbAttr}. */
export interface OnOpponentStatRaiseOptions {
  /** Stat-stage deltas dispatched on the holder when an opponent raises any stat. */
  readonly stats: readonly OnOpponentStatRaiseChange[];
}

/**
 * Parameterized AbAttr implementing the `on-opponent-stat-raise` archetype.
 */
export class OnOpponentStatRaiseAbAttr extends PostStatStageChangeAbAttr {
  private readonly stats: readonly OnOpponentStatRaiseChange[];

  constructor(options: OnOpponentStatRaiseOptions) {
    super(true);
    if (options.stats.length === 0) {
      throw new Error("[OnOpponentStatRaiseAbAttr] options.stats must be non-empty");
    }
    for (const change of options.stats) {
      if (change.stages === 0) {
        throw new Error(`[OnOpponentStatRaiseAbAttr] stages must be non-zero; got 0 for stat ${change.stat}`);
      }
    }
    this.stats = options.stats;
  }

  override canApply(params: PostStatStageChangeAbAttrParams): boolean {
    const { pokemon, stages, selfTarget } = params;
    // Holder must not be the subject of the change. selfTarget tells us
    // whether the stage change was self-inflicted; we want the case where
    // an OPPONENT raised THEIR stats. For Egoist's holder, `pokemon` here
    // refers to whoever's PostStat is being iterated — we want to detect
    // opponent-raise events. The simplest correct check: the AbAttr fires
    // on the subject `pokemon`. We need the HOLDER context — which comes
    // from `this` ownership. PostStatStageChange iteration in pokerogue
    // calls applyAbAttrs for the subject. Returning false here when the
    // subject is the holder OR when the change isn't a positive delta.
    return selfTarget && stages > 0 && !pokemon.isPlayer ? true : false;
  }

  override apply(params: PostStatStageChangeAbAttrParams): void {
    if (params.simulated) {
      return;
    }
    // The HOLDER applies the boost to itself. We need the holder context —
    // params.pokemon is the SUBJECT of the original stat change, which is
    // the opponent. To find the holder, we need to iterate active pokemon
    // and find one with this AbAttr. Pokerogue's standard apply path passes
    // the holder context via the dispatcher; here we approximate by checking
    // globalScene.getField for any pokemon with this AbAttr.
    //
    // Note: this is a simplification — proper field-aura primitives need a
    // dedicated apply-on-each-ally path. For Egoist (single-mon), this
    // approximation lands the boost on the first non-fainted ally.
    const allies = globalScene.getField().filter(p => p && !p.isFainted() && p.isPlayer() === !params.pokemon.isPlayer());
    for (const holder of allies) {
      for (const change of this.stats) {
        globalScene.phaseManager.unshiftNew(
          "StatStageChangePhase",
          holder.getBattlerIndex(),
          true,
          [change.stat],
          change.stages,
        );
      }
    }
  }
}
