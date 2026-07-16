/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Shattered Psyche (ability 5968) bonus-action phase.
//
// When Shattered Psyche fuses two opponents into one entity, that entity takes
// BOTH constituents' actions each turn. Its own action is queued by the normal
// turn pipeline; this phase delivers the SECOND action - the absorbed
// constituent's move - as an extra MovePhase.
//
// The target is RE-RESOLVED against the live field with the seeded battle RNG
// (never Math.random) when the phase runs, so if the absorbed move's original
// target has fainted the extra action carries over to a living opponent, and it
// skips cleanly when no opponent remains (mirrors ErClosedCircuitBurstPhase).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import type { Pokemon } from "#field/pokemon";
import { PokemonMove } from "#moves/pokemon-move";

export class ErShatteredPsycheBonusPhase extends Phase {
  public readonly phaseName = "ErShatteredPsycheBonusPhase";

  /** The fused entity taking the absorbed constituent's action. */
  private readonly attacker: Pokemon;
  /** The absorbed constituent's move id. */
  private readonly moveId: MoveId;
  private readonly useMode: MoveUseMode;

  constructor(attacker: Pokemon, moveId: MoveId, useMode: MoveUseMode = MoveUseMode.NORMAL) {
    super();
    this.attacker = attacker;
    this.moveId = moveId;
    this.useMode = useMode;
  }

  public override start(): void {
    if (!this.attacker.isActive(true) || this.moveId === MoveId.NONE) {
      this.end();
      return;
    }
    const opponents = this.attacker.getOpponents();
    if (opponents.length === 0) {
      // No living opponent remains: the extra action fizzles cleanly.
      this.end();
      return;
    }
    const target = opponents[this.attacker.randBattleSeedInt(opponents.length)];
    globalScene.phaseManager.unshiftNew(
      "MovePhase",
      this.attacker,
      [target.getBattlerIndex()],
      new PokemonMove(this.moveId),
      this.useMode,
    );
    this.end();
  }
}
