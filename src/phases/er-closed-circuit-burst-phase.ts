/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Closed Circuit (ability 5924) extra-attack burst phase.
//
// When the holder and an ally both target the same opponent in one turn, BOTH
// launch an additional 25 BP Electric/Fairy dual-type attack after both primary
// moves resolve. The extra attacks are re-targetable: if the shared target
// faints (from the primaries OR from the first extra attack), the remaining
// extra attack carries over to a living opponent (seeded pick when several
// remain); it skips cleanly when no opponent is left.
//
// Carry-over requires RE-RESOLVING each extra's target AFTER the previous one
// executes (a fixed-target MovePhase fizzles against a fainted target — see
// MoveEffectPhase.getTargets). This phase launches the extras ONE AT A TIME:
// it resolves the current target, unshifts (a) a follow-up burst for the
// REMAINING attackers and then (b) the current attacker's MovePhase on top, so
// the move resolves first and the remaining-attackers burst re-resolves its
// target against the post-move field.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { scriptedPokemonMove } from "#data/elite-redux/archetypes/scripted-move-util";
import { DualTypeMoveAttr } from "#data/moves/move";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import type { PokemonMove } from "#moves/pokemon-move";

/** Base power of the Closed Circuit follow-up attack. */
export const CLOSED_CIRCUIT_FOLLOWUP_POWER = 25;

/**
 * Build the 25 BP Electric/Fairy special follow-up (Shock Wave clone + Fairy
 * second type). Never mutates the registered Shock Wave — the second type is
 * attached onto the scripted clone's own attrs array (idempotently).
 */
function closedCircuitFollowupMove(): PokemonMove {
  const move = scriptedPokemonMove(MoveId.SHOCK_WAVE, CLOSED_CIRCUIT_FOLLOWUP_POWER);
  const built = move.getMove();
  if (!built.attrs.some(a => a instanceof DualTypeMoveAttr)) {
    (built as unknown as { attrs: unknown[] }).attrs = [...built.attrs, new DualTypeMoveAttr(PokemonType.FAIRY)];
  }
  return move;
}

export class ErClosedCircuitBurstPhase extends Phase {
  public readonly phaseName = "ErClosedCircuitBurstPhase";

  /** Attackers still owing an extra attack, in launch order. */
  private readonly attackers: Pokemon[];
  /** The pair's originally shared target (preferred while it lives). */
  private readonly sharedTarget: Pokemon;

  constructor(attackers: Pokemon[], sharedTarget: Pokemon) {
    super();
    this.attackers = attackers;
    this.sharedTarget = sharedTarget;
  }

  public override start(): void {
    // Drop attackers that fainted / left the field before their extra fired.
    while (this.attackers.length > 0 && !this.attackers[0].isActive(true)) {
      this.attackers.shift();
    }
    if (this.attackers.length === 0) {
      this.end();
      return;
    }
    const attacker = this.attackers[0];
    const rest = this.attackers.slice(1);

    const target = this.resolveTarget(attacker);
    if (target === undefined) {
      // No living opponent remains: every remaining extra fizzles cleanly.
      this.end();
      return;
    }

    // Unshift the remaining-attackers burst FIRST (it lands behind), then the
    // current attacker's MovePhase (lands in front, runs first). The burst then
    // re-resolves its target against the post-move field.
    if (rest.length > 0) {
      globalScene.phaseManager.unshiftNew("ErClosedCircuitBurstPhase", rest, this.sharedTarget);
    }
    globalScene.phaseManager.unshiftNew(
      "MovePhase",
      attacker,
      [target.getBattlerIndex()],
      closedCircuitFollowupMove(),
      MoveUseMode.INDIRECT,
    );
    this.end();
  }

  /**
   * The shared target if it is still a living opponent, else a seeded pick among
   * `attacker`'s remaining living opponents, else `undefined`.
   */
  private resolveTarget(attacker: Pokemon): Pokemon | undefined {
    const opponents = attacker.getOpponents();
    if (opponents.length === 0) {
      return;
    }
    if (opponents.includes(this.sharedTarget)) {
      return this.sharedTarget;
    }
    return opponents[attacker.randBattleSeedInt(opponents.length)];
  }
}
