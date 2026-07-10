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
//   - Egoist (555) — "Copies stat boosts that enemy Pokemon receive and applies
//     them to itself (the SAME stat, the SAME number of stages). Does not copy
//     other Egoist boosts." — `new OnOpponentStatRaiseAbAttr()`.
//
// (The earlier implementation extended PostStatStageChangeAbAttr, which fires on
// the SUBJECT of the change, not the reacting holder — so Egoist never triggered.
// A follow-up rewrite rode the Opportunist hook but then IGNORED the foe's actual
// raise, unconditionally granting a hardcoded ATK+1/SpAtk+1/SpD+1 regardless of
// which stat/how many stages the foe raised — so a foe's Iron Defense (+2 Def)
// gave the holder +1 Atk/SpAtk/SpD. This version drops that override: the base
// `StatStageChangeCopyAbAttr.apply` mirrors the EXACT (stat, stages) the opponent
// gained and pushes the copy with `canBeCopied=false` — which is both the dex's
// "same stat, same stages" and its "does not copy other Egoist boosts" (a copy
// that can't itself be copied can never chain off another Egoist/Opportunist).)
// =============================================================================

import { StatStageChangeCopyAbAttr, type StatStageChangeCopyAbAttrParams } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { scriptedPokemonMove } from "#data/elite-redux/archetypes/scripted-move-util";
import type { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";

/**
 * `on-opponent-stat-raise` archetype for Egoist (555). A pure marker subclass of
 * the registered `StatStageChangeCopyAbAttr` (Opportunist) hook: it copies the
 * exact stat + stage count the foe gained, with the copy pushed as uncopyable
 * (base-class behavior). No `apply` override — mirroring is what the dex wants.
 */
export class OnOpponentStatRaiseAbAttr extends StatStageChangeCopyAbAttr {
  private declare readonly _erMarker: never;
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
