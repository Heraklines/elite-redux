/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-attack-contact-suppress-target-ability` archetype.
//
// PostAttack hook (offense surface): when the holder uses a contact move
// against an opponent (optionally gated on the opponent's status), suppress
// the opponent's ability for the rest of the battle. Mirror of
// SuppressAttackerAbilityAbAttr but on the offensive direction.
//
// Wires:
//   - 832 Hemotoxin — "Suppresses abilities of the target when they're
//     poisoned." (requireTargetStatus: [POISON, TOXIC])
// =============================================================================

import { PostAttackAbAttr } from "#abilities/ab-attrs";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";
import { MoveFlags } from "#enums/move-flags";
import { StatusEffect } from "#enums/status-effect";

export interface PostAttackContactSuppressTargetAbilityOptions {
  /** Optional gate: only fires if the opponent has one of these statuses. */
  readonly requireTargetStatus?: readonly StatusEffect[];
  /** If true (default), the holder's move must make contact. */
  readonly contactOnly?: boolean;
}

export class PostAttackContactSuppressTargetAbilityAbAttr extends PostAttackAbAttr {
  private readonly requireTargetStatus: readonly StatusEffect[] | null;
  private readonly contactOnly: boolean;

  constructor(options: PostAttackContactSuppressTargetAbilityOptions = {}) {
    super(undefined, false);
    this.requireTargetStatus = options.requireTargetStatus ?? null;
    this.contactOnly = options.contactOnly ?? true;
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { move, pokemon, opponent } = params;
    if (!opponent || opponent.isFainted()) {
      return false;
    }
    if (!move.is("AttackMove")) {
      return false;
    }
    if (
      this.contactOnly
      && !move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: pokemon, target: opponent })
    ) {
      return false;
    }
    if (this.requireTargetStatus !== null) {
      const status = opponent.status?.effect ?? StatusEffect.NONE;
      if (!this.requireTargetStatus.includes(status)) {
        return false;
      }
    }
    if (opponent.summonData?.abilitySuppressed) {
      return false;
    }
    return true;
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    const { opponent, simulated } = params;
    if (simulated || !opponent) {
      return;
    }
    opponent.summonData.abilitySuppressed = true;
    opponent.updateInfo();
  }
}
