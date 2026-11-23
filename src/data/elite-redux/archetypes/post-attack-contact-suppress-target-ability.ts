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
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";
import { MoveFlags } from "#enums/move-flags";
import { StatusEffect } from "#enums/status-effect";

export interface PostAttackContactSuppressTargetAbilityOptions {
  /** Optional gate: only fires if the opponent has one of these statuses. */
  readonly requireTargetStatus?: readonly StatusEffect[];
  /** If true (default), the holder's move must make contact. */
  readonly contactOnly?: boolean;
}

export class PostAttackContactSuppressTargetAbilityAbAttr
  extends PostAttackAbAttr
  implements GatedAttr<PostMoveInteractionAbAttrParams>
{
  private readonly requireTargetStatus: readonly StatusEffect[] | null;
  private readonly contactOnly: boolean;

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  constructor(options: PostAttackContactSuppressTargetAbilityOptions = {}) {
    super(undefined, false);
    this.requireTargetStatus = options.requireTargetStatus ?? null;
    this.contactOnly = options.contactOnly ?? true;
  }

  /**
   * Tier B split (ability studio spec 3.1), in the original clause order: `guards` (there is a target that is still
   * standing, the move is an attack move), `gate` (contact, target status), `residual` (its ability is not already
   * suppressed). No `prepare`, no random draw.
   */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  /**
   * There must be a target, it must still be standing, and the move must be an attack move (a class test: nine moves that
   * are status-class moves with a damaging category pass `category != STATUS` but fail this one).
   */
  public guards({ move, opponent }: PostMoveInteractionAbAttrParams): boolean {
    if (!opponent || opponent.isFainted()) {
      return false;
    }
    return move.is("AttackMove");
  }

  /** The replaceable condition: the move makes contact when `contactOnly`, against a target in the wanted status. */
  public gate({ move, pokemon, opponent }: PostMoveInteractionAbAttrParams): boolean {
    if (
      this.contactOnly
      && !move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: pokemon, target: opponent })
    ) {
      return false;
    }
    if (this.requireTargetStatus !== null) {
      const status = opponent?.status?.effect ?? StatusEffect.NONE;
      if (!this.requireTargetStatus.includes(status)) {
        return false;
      }
    }
    return true;
  }

  /** Feasibility that stays in the class: suppressing an ability that is already suppressed does nothing. */
  public residual({ opponent }: PostMoveInteractionAbAttrParams): boolean {
    return !opponent?.summonData?.abilitySuppressed;
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
