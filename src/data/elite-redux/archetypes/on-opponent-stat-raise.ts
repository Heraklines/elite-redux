/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `on-opponent-stat-raise` archetype.
//
// Rides pokerogue's `StatStageChangeCopyAbAttr` hook — the SAME mechanism
// vanilla Opportunist uses. When a Pokemon makes a *copyable* positive stat
// raise, `StatStageChangePhase` calls
// `applyAbAttrs("StatStageChangeCopyAbAttr", { pokemon: opponent, ... })` on
// each of the raiser's opponents (see stat-stage-change-phase.ts). So an
// instance of this attr (which IS a StatStageChangeCopyAbAttr via subclassing)
// fires on the HOLDER with `params.pokemon` = the holder itself — exactly the
// "react when a foe raises its stats" semantics we need.
//
// Wires:
//   - Egoist (555) — "Raises its own stats when foes raise theirs."
//     `new OnOpponentStatRaiseAbAttr({ stats: [{ATK,+1},{SPATK,+1},{SPD,+1}] })`
//
// (The earlier implementation extended PostStatStageChangeAbAttr, which fires
// on the SUBJECT of the change, not the reacting holder, and whose canApply had
// a `!pokemon.isPlayer` method-reference bug that made it ALWAYS return false —
// so Egoist never triggered. This rewrite fixes both.)
// =============================================================================

import { StatStageChangeCopyAbAttr, type StatStageChangeCopyAbAttrParams } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { scriptedPokemonMove } from "#data/elite-redux/archetypes/scripted-move-util";
import type { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import type { BattleStat } from "#enums/stat";

/** A single stat-stage delta the holder gains in response to a foe's raise. */
export interface OnOpponentStatRaiseChange {
  readonly stat: BattleStat;
  readonly stages: number;
}

/** Construction options for {@linkcode OnOpponentStatRaiseAbAttr}. */
export interface OnOpponentStatRaiseOptions {
  /** Stat-stage deltas dispatched on the holder when a foe makes a copyable raise. */
  readonly stats: readonly OnOpponentStatRaiseChange[];
}

/**
 * Parameterized AbAttr implementing the `on-opponent-stat-raise` archetype by
 * extending the registered `StatStageChangeCopyAbAttr` (Opportunist) hook.
 */
export class OnOpponentStatRaiseAbAttr extends StatStageChangeCopyAbAttr {
  private readonly stats: readonly OnOpponentStatRaiseChange[];

  constructor(options: OnOpponentStatRaiseOptions) {
    super();
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

  /** Read-only accessor (tests). */
  public getStats(): readonly OnOpponentStatRaiseChange[] {
    return this.stats;
  }

  override apply({ pokemon, simulated }: StatStageChangeCopyAbAttrParams): void {
    if (simulated) {
      return;
    }
    // `pokemon` is the HOLDER (the foe of whoever raised). Apply the configured
    // boost to it — NOT a copy of the exact buff (that's vanilla Opportunist).
    for (const change of this.stats) {
      globalScene.phaseManager.unshiftNew(
        "StatStageChangePhase",
        pokemon.getBattlerIndex(),
        true,
        [change.stat],
        change.stages,
        true,
        false,
        // canBeCopied=false, like vanilla Opportunist's copy: a reactive boost must
        // never itself count as a copyable raise, or two reactive holders (Egoist vs
        // an Opportunist/Egoist foe) ping-pong boosts forever - the live "Egoist kept
        // chaining forever" freeze after a Dragon Dance.
        false,
      );
    }
  }
}

/** Construction options for {@linkcode OnOpponentStatRaiseScriptedMoveAbAttr}. */
export interface OnOpponentStatRaiseScriptedMoveOptions {
  /** The move the holder uses in response to a foe's copyable stat raise. */
  readonly moveId: MoveId;
  /** Optional base-power override for the scripted cast. */
  readonly power?: number;
}

/**
 * `on-opponent-stat-raise` variant that makes the HOLDER immediately use a
 * scripted move (INDIRECT — ignores PP) against a foe when an opponent makes a
 * copyable positive stat raise. Rides the same Opportunist hook.
 *
 * Wires: Retribution Blow (407) — "Uses a 150 BP Hyper Beam against opponents
 * that boost stats."
 */
export class OnOpponentStatRaiseScriptedMoveAbAttr extends StatStageChangeCopyAbAttr {
  constructor(private readonly opts: OnOpponentStatRaiseScriptedMoveOptions) {
    super();
  }

  override apply({ pokemon, simulated }: StatStageChangeCopyAbAttrParams): void {
    if (simulated) {
      return;
    }
    const opponents = pokemon.getOpponents().filter(o => !o.isFainted());
    if (opponents.length === 0) {
      return;
    }
    globalScene.phaseManager.unshiftNew(
      "MovePhase",
      pokemon,
      [opponents[0].getBattlerIndex()],
      // noRecharge: the dex says the triggered Hyper Beam "has no recharge period,
      // allowing normal actions next turn" - don't lock the holder into a recharge.
      scriptedPokemonMove(this.opts.moveId, this.opts.power, { alwaysHit: true, noRecharge: true }),
      MoveUseMode.INDIRECT,
    );
  }
}
