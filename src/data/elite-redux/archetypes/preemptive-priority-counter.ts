/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { AbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { scriptedPokemonMove } from "#data/elite-redux/archetypes/scripted-move-util";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { MovePhaseTimingModifier } from "#enums/move-phase-timing-modifier";
import { MoveUseMode } from "#enums/move-use-mode";
import type { Pokemon } from "#field/pokemon";

export class PreemptivePriorityCounterAbAttr extends AbAttr {
  constructor() {
    super(false);
  }

  public queueCounters(pokemon: Pokemon): void {
    for (const opponent of pokemon.getOpponents()) {
      const command = globalScene.currentBattle.turnCommands[opponent.getBattlerIndex()];
      if (
        command?.command !== Command.FIGHT
        || command.skip
        || command.move === undefined
        || allMoves[command.move.move].getPriority(opponent) <= 0
      ) {
        continue;
      }
      globalScene.phaseManager.unshiftNew(
        "MovePhase",
        pokemon,
        [opponent.getBattlerIndex()],
        scriptedPokemonMove(MoveId.ASTONISH, 40, { bypassFirstMoveCondition: true }),
        MoveUseMode.INDIRECT,
        MovePhaseTimingModifier.FIRST,
      );
    }
  }
}
