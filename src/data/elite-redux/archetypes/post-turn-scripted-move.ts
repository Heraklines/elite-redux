/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-turn-scripted-move` archetype.
//
// Subclasses pokerogue's PostTurnAbAttr. Every N turns (counted via
// pokemon.summonData.turnCount), enqueues a free MovePhase for the holder
// targeting a chosen opponent with the configured moveId in INDIRECT mode.
//
// Wires:
//   - Sumo Wrestler (937)  → Circle Throw every 2 turns
//   - Cool Exit (940)       → Chilly Reception every 2 turns
//   - Life Steal (737)      → ER Soul Tap (drain 10% from opponent) every turn
//   - Soul Tap (820 in fog) → same but fog-gated (gate deferred)
//
// The follow-up uses MoveUseMode.INDIRECT (no PP consumption, no history).
// =============================================================================

import { PostTurnAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import type { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokemonMove } from "#moves/pokemon-move";
import type { AbAttrBaseParams } from "#types/ability-types";

/** Construction options for {@linkcode PostTurnScriptedMoveAbAttr}. */
export interface PostTurnScriptedMoveOptions {
  /** Pokerogue MoveId of the scripted move. */
  readonly moveId: MoveId;
  /**
   * Fire every N-th turn (1 = every turn, 2 = every other turn, etc.).
   * Counted against pokemon.summonData.turnCount.
   * @defaultValue `1` (every turn)
   */
  readonly everyNTurns?: number;
}

/**
 * Parameterized AbAttr implementing the `post-turn-scripted-move` archetype.
 */
export class PostTurnScriptedMoveAbAttr extends PostTurnAbAttr {
  private readonly moveId: MoveId;
  private readonly everyNTurns: number;

  constructor(options: PostTurnScriptedMoveOptions) {
    super();
    this.moveId = options.moveId;
    this.everyNTurns = options.everyNTurns ?? 1;
    if (!(this.everyNTurns >= 1 && Number.isInteger(this.everyNTurns))) {
      throw new Error(`[PostTurnScriptedMoveAbAttr] everyNTurns must be a positive integer; got ${this.everyNTurns}`);
    }
  }

  override canApply(params: AbAttrBaseParams): boolean {
    const { pokemon } = params;
    if (pokemon.isFainted()) {
      return false;
    }
    const turn = pokemon.tempSummonData?.turnCount ?? 0;
    return turn > 0 && turn % this.everyNTurns === 0;
  }

  override apply(params: AbAttrBaseParams): void {
    if (params.simulated) {
      return;
    }
    const { pokemon } = params;
    // Target the first non-fainted opposing pokemon on the field.
    const enemies = pokemon.getOpponents();
    const target = enemies.find(e => !e.isFainted());
    if (!target) {
      return;
    }
    globalScene.phaseManager.unshiftNew(
      "MovePhase",
      pokemon,
      [target.getBattlerIndex()],
      new PokemonMove(this.moveId),
      MoveUseMode.INDIRECT,
    );
  }
}
