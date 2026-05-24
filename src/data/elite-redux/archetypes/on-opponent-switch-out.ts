/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `on-opponent-switch-out` archetype.
//
// Fires when an OPPOSING pokemon switches out — used by ER 656 Tag
// ("Attacks switching opponents with a 20BP Pursuit") and any other
// ability that needs to react to a foe leaving the field.
//
// Hook: switch-summon-phase.ts calls `attr.fire(holder, leavingOpponent)`
// directly on each opposing-side pokemon's attrs after the standard
// PreSwitchOut chain. We bypass pokerogue's centralised applyAbAttrs
// map (which would require adding this attr to a 6000-line registry)
// in favour of a direct constructor.name lookup at the call-site.
//
// Behaviour: enqueues the configured move via MovePhase in INDIRECT
// mode targeting the switching-out opponent. Mirrors PostAttackScripted
// MoveAbAttr's shape but on the switch-event surface.
// =============================================================================

import { AbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { PokemonMove } from "#data/moves/pokemon-move";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import type { Pokemon } from "#field/pokemon";

export interface OnOpponentSwitchOutOptions {
  /** Move id to spawn against the switching-out opponent. */
  readonly moveId: MoveId;
}

export class OnOpponentSwitchOutAbAttr extends AbAttr {
  constructor(private readonly opts: OnOpponentSwitchOutOptions) {
    super(false);
  }

  /** Called by switch-summon-phase.ts when the configured trigger fires. */
  public fire(holder: Pokemon, leavingOpponent: Pokemon): void {
    if (!leavingOpponent || leavingOpponent.isFainted()) {
      return;
    }
    globalScene.phaseManager.unshiftNew(
      "MovePhase",
      holder,
      [leavingOpponent.getBattlerIndex()],
      new PokemonMove(this.opts.moveId),
      MoveUseMode.INDIRECT,
    );
  }
}
