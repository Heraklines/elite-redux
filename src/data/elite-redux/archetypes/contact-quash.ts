/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `contact-quash` archetype.
//
// PostDefend hook: on contact, apply a true QUASH-equivalent to the ATTACKER —
// it moves LAST within its priority bracket for N turns (the ER_QUASHED battler
// tag, checked in Move.getPriorityModifier alongside ER_DRENCHED). This is a
// persistent, switch-surviving tag, NOT the old -6 SPD stat-stage approximation.
//
// Wires:
//   - 735 Know Your Place — "Contact attacks make foes move last for 5 turns."
// =============================================================================

import { PostDefendAbAttr } from "#abilities/ab-attrs";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveFlags } from "#enums/move-flags";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";

export interface ContactQuashOptions {
  /** How many turns the attacker is forced to move last. Default 5 (ER dex). */
  readonly turns?: number;
}

export class ContactQuashAbAttr extends PostDefendAbAttr {
  private readonly turns: number;

  constructor(options: ContactQuashOptions = {}) {
    super(false);
    this.turns = options.turns ?? 5;
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
    opponent.addTag(BattlerTagType.ER_QUASHED, this.turns);
  }
}
