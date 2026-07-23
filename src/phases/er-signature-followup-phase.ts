/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { MovePhaseTimingModifier } from "#enums/move-phase-timing-modifier";
import { MoveUseMode } from "#enums/move-use-mode";
import type { Pokemon } from "#field/pokemon";
import type { PokemonMove } from "#moves/pokemon-move";

/** Launches an ability-scripted attack after the current move has settled. */
export class ErSignatureFollowupPhase extends Phase {
  public readonly phaseName = "ErSignatureFollowupPhase";
  private readonly attacker: Pokemon;
  private readonly target: Pokemon;
  private readonly move: PokemonMove;

  constructor(attacker: Pokemon, target: Pokemon, move: PokemonMove) {
    super();
    this.attacker = attacker;
    this.target = target;
    this.move = move;
  }

  public override start(): void {
    if (this.attacker.isActive(true) && this.target.isActive(true)) {
      globalScene.phaseManager.unshiftNew(
        "MovePhase",
        this.attacker,
        [this.target.getBattlerIndex()],
        this.move,
        MoveUseMode.FOLLOW_UP,
        MovePhaseTimingModifier.FIRST,
      );
    }
    this.end();
  }
}
