/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `contact-quash` archetype.
//
// PostDefend hook: on contact, apply the QUASH-equivalent (forces target to
// move last) for N turns. Pokerogue lacks a true Quash tag, so we model
// this via a SPEED penalty stat-stage (the dominant gameplay effect).
//
// Wires:
//   - 735 Know Your Place — "Contact attacks make foes move last for 5 turns."
//
// We approximate Quash by applying -6 SPD stage (effectively last) for the
// rest of the turn; pokerogue's stat-stage resets on switch so this is
// per-turn rather than 5-turn — best fit without a Quash tag.
// =============================================================================

import { PostDefendAbAttr } from "#abilities/ab-attrs";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";
import { globalScene } from "#app/global-scene";
import { MoveFlags } from "#enums/move-flags";
import { Stat } from "#enums/stat";

export interface ContactQuashOptions {
  /** Stages of speed drop. Default -6 (Quash analog). */
  readonly stages?: number;
}

export class ContactQuashAbAttr extends PostDefendAbAttr {
  private readonly stages: number;

  constructor(options: ContactQuashOptions = {}) {
    super(false);
    this.stages = options.stages ?? -6;
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { move, opponent, pokemon } = params;
    if (!opponent || !move.is("AttackMove")) {
      return false;
    }
    return move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: opponent, target: pokemon });
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    const { opponent, simulated } = params;
    if (simulated || !opponent) {
      return;
    }
    globalScene.phaseManager.unshiftNew(
      "StatStageChangePhase",
      opponent.getBattlerIndex(),
      false,
      [Stat.SPD],
      this.stages,
    );
  }
}
