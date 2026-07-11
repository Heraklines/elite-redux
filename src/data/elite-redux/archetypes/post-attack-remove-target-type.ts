/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-attack-remove-target-type` primitive.
//
// PostAttack hook that STRIPS a specified type from the TARGET's typing when the
// holder lands an attack. The offense-side sibling of
// `PostAttackChangeTargetTypeAbAttr` (which OVERWRITES the target's types to a
// single type); this one only REMOVES one type, preserving the target's other
// type(s).
//
// Wires:
//   - 499 Refrigerator — "Removes Ghost-typing on target when landing an
//     attack." (compositeRiderAttrs case 499, on top of Filter + Illuminate.)
// =============================================================================

import { PostAttackAbAttr } from "#abilities/ab-attrs";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";

export interface PostAttackRemoveTargetTypeOptions {
  /** The type to strip from the target on a landed hit. */
  readonly type: PokemonType;
  /** If true, only triggers when the holder's move makes contact. Default false. */
  readonly contactOnly?: boolean;
}

/**
 * When the holder lands a damaging attack, remove {@linkcode type} from the
 * target's typing (if present). If stripping it would leave the target with no
 * types, it falls back to a single {@linkcode PokemonType.NORMAL} typing rather
 * than reverting to its species types.
 */
export class PostAttackRemoveTargetTypeAbAttr extends PostAttackAbAttr {
  private readonly stripType: PokemonType;
  private readonly contactOnly: boolean;

  constructor(options: PostAttackRemoveTargetTypeOptions) {
    // Default attackCondition (damaging move) + don't flash the ability banner.
    super(undefined, false);
    this.stripType = options.type;
    this.contactOnly = options.contactOnly ?? false;
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
    // Nothing to strip if the target isn't the type.
    return opponent.getTypes().includes(this.stripType);
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    const { opponent, simulated } = params;
    if (simulated || !opponent) {
      return;
    }
    const remaining = opponent.getTypes().filter(t => t !== this.stripType);
    opponent.summonData.types = remaining.length > 0 ? remaining : [PokemonType.NORMAL];
    opponent.updateInfo();
  }
}
