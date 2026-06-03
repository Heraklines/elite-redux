/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-attack-change-target-type` primitive.
//
// PostAttack hook (contact-only by default) that overwrites the TARGET's types
// to a specified single type when the holder lands an attack. This is the
// OFFENSE-side mirror of `PostDefendChangeAttackerTypeAbAttr` (which fires when
// the holder is HIT). Several ER abilities change a Pokemon's type "on contact,
// offensively or defensively" and need both halves:
//
//   - 6 Damp        — "Makes foe Water-type on contact, offense & defense."
//   - 304 Magical Dust — "Makes foe Psychic-type on contact. Also works on offense."
//
// The defensive half is wired with PostDefendChangeAttackerType; this attr adds
// the offensive half (the holder hits a target with contact → target becomes
// the configured type).
// =============================================================================

import { PostAttackAbAttr } from "#abilities/ab-attrs";
import { MoveFlags } from "#enums/move-flags";
import type { PokemonType } from "#enums/pokemon-type";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";

export interface PostAttackChangeTargetTypeOptions {
  /** Fixed type to apply to the target, or "moveType" to use the holder's move type. */
  readonly type: PokemonType | "moveType";
  /** If true (default), only triggers when the holder's move makes contact. */
  readonly contactOnly?: boolean;
  /**
   * If set, only triggers when the holder's move carries this flag. Used by
   * Paint Shot 880 ("Mega launcher moves change the target's type") — pulse
   * moves are non-contact, so it gates on {@linkcode MoveFlags.PULSE_MOVE}
   * with `contactOnly: false`.
   */
  readonly requireFlag?: MoveFlags;
}

/**
 * When the holder lands a (by default contact) attack, overwrite the target's
 * types to a single configured type. Offense-side mirror of
 * {@linkcode PostDefendChangeAttackerTypeAbAttr}.
 */
export class PostAttackChangeTargetTypeAbAttr extends PostAttackAbAttr {
  private readonly newType: PokemonType | "moveType";
  private readonly contactOnly: boolean;
  private readonly requireFlag: MoveFlags | undefined;

  constructor(options: PostAttackChangeTargetTypeOptions) {
    // Default attackCondition (damaging move) + don't flash the ability banner.
    super(undefined, false);
    this.newType = options.type;
    this.contactOnly = options.contactOnly ?? true;
    this.requireFlag = options.requireFlag;
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    if (!super.canApply(params)) {
      return false;
    }
    const { move, pokemon, opponent } = params;
    if (!opponent) {
      return false;
    }
    if (
      this.contactOnly
      && !move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: pokemon, target: opponent })
    ) {
      return false;
    }
    if (this.requireFlag !== undefined && !move.hasFlag(this.requireFlag)) {
      return false;
    }
    return true;
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    const { move, pokemon, opponent, simulated } = params;
    if (simulated || !opponent) {
      return;
    }
    const resolvedType = this.newType === "moveType" ? pokemon.getMoveType(move) : this.newType;
    opponent.summonData.types = [resolvedType];
    opponent.updateInfo();
  }
}
