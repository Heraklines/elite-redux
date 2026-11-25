/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-defend-change-attacker-type` archetype.
//
// PostDefend hook (contact only by default) that overwrites the attacker's
// types to a specified single type. Mirrors vanilla Mummy / Lingering
// Aroma but for type-change instead of ability-change.
//
// Wires:
//   - 304 Magical Dust — "Makes foe Psychic-type on contact." (Psychic)
//   - 880 Paint Shot — "Mega launcher moves change the target's type to the
//     move used." (Move-type, filter by mega-launcher flag.)
// =============================================================================

import { PostDefendAbAttr } from "#abilities/ab-attrs";
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";
import { MoveFlags } from "#enums/move-flags";
import type { PokemonType } from "#enums/pokemon-type";

export interface PostDefendChangeAttackerTypeOptions {
  /**
   * Fixed type to apply, or "moveType" to use the incoming move's type.
   */
  readonly type: PokemonType | "moveType";
  /** If true, only triggers on contact moves. */
  readonly contactOnly?: boolean;
  /**
   * Optional move flag the incoming attack must have (e.g. PULSE_MOVE for
   * mega-launcher moves). When set, only matching attacks trigger.
   */
  readonly requireFlag?: MoveFlags;
  /**
   * If "self" — change the holder's type (Paint Shot reverses: changes the
   * TARGET's type, which is the holder of the ability — wait, re-read ER
   * desc). Actually Paint Shot reads "change the TARGET'S type to the move
   * used" — so the attacker's mega-launcher move changes the target (the
   * defender). For our PostDefend hook on the defender, this means change
   * the holder. Magical Dust reads "Makes foe Psychic-type on contact" —
   * change the attacker. Different sides.
   */
  readonly side: "attacker" | "self";
}

export class PostDefendChangeAttackerTypeAbAttr
  extends PostDefendAbAttr
  implements GatedAttr<PostMoveInteractionAbAttrParams>
{
  private readonly type: PokemonType | "moveType";
  private readonly contactOnly: boolean;
  private readonly requireFlag: MoveFlags | null;
  private readonly side: "attacker" | "self";

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  constructor(options: PostDefendChangeAttackerTypeOptions) {
    super(false);
    this.type = options.type;
    this.contactOnly = options.contactOnly ?? false;
    this.requireFlag = options.requireFlag ?? null;
    this.side = options.side;
  }

  /**
   * Tier B split (ability studio spec 3.1), in the original clause order: `guards` (there is an attacker, the move is an
   * attack move), then `gate` (contact when `contactOnly`, the required flag). No `prepare`, no `residual`, no random draw.
   */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  /** There must be an attacker and the move must be an attack move (a class test, see the contact-suppress class). */
  public guards({ move, opponent }: PostMoveInteractionAbAttrParams): boolean {
    if (!opponent) {
      return false;
    }
    return move.is("AttackMove");
  }

  /** The replaceable condition: the move makes contact (when `contactOnly`) and has the required flag (when set). */
  public gate({ move, pokemon, opponent }: PostMoveInteractionAbAttrParams): boolean {
    if (this.contactOnly) {
      if (!move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: opponent, target: pokemon })) {
        return false;
      }
    }
    if (this.requireFlag !== null) {
      if (!move.doesFlagEffectApply({ flag: this.requireFlag, user: opponent, target: pokemon })) {
        return false;
      }
    }
    return true;
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    const { move, pokemon, opponent, simulated } = params;
    if (simulated || !opponent) {
      return;
    }
    const target = this.side === "attacker" ? opponent : pokemon;
    const resolvedType = this.type === "moveType" ? opponent.getMoveType(move) : this.type;
    target.summonData.types = [resolvedType];
    target.updateInfo();
  }
}
