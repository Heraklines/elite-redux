/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — bespoke ability `Puppet Strings`.
//
// "When the holder deals damage with a Psychic-type move to a target that is
// poisoned or badly poisoned, the target becomes Commanded." The Commanded
// volatile ({@linkcode BattlerTagType.ER_COMMANDED}) hijacks the target's next
// action (see `ErCommandedTag`). Subject to the once-per-switch-in rule tracked
// on the target's `summonData.erCommandedUsedThisSwitchIn`.
//
// Registered as a hand-authored ER-custom ability (id space ≥ 5000, above the
// auto-generated vendor range) via `init-elite-redux-custom-abilities.ts` — the
// same registration path Silken Decree (5900) uses.
// =============================================================================

import { PostAttackAbAttr, type PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { StatusEffect } from "#enums/status-effect";

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_PUPPET_STRINGS_ABILITY_ID = 5901;

export class PuppetStringsAbAttr extends PostAttackAbAttr {
  constructor() {
    // The default `attackCondition` (inherited) already requires a damaging
    // (non-status) move; `showAbility` false — the tag application shows its own
    // message.
    super(undefined, false);
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    // Must be a damaging move (base condition) that actually dealt damage.
    if (!super.canApply(params)) {
      return false;
    }
    const { pokemon, opponent: target, move, damage } = params;
    if (pokemon === target || target.isFainted() || damage <= 0) {
      return false;
    }
    // Psychic-type move (respects the holder's type-changing effects).
    if (pokemon.getMoveType(move) !== PokemonType.PSYCHIC) {
      return false;
    }
    // Target must be poisoned or badly poisoned.
    const status = target.status?.effect;
    if (status !== StatusEffect.POISON && status !== StatusEffect.TOXIC) {
      return false;
    }
    // Shield Dust and friends block ability-inflicted added effects.
    if (target.hasAbilityWithAttr("IgnoreMoveEffectsAbAttr")) {
      return false;
    }
    // Once-per-switch-in: skip if the target has already been Commanded this
    // send-out, or is currently Commanded.
    if (target.summonData.erCommandedUsedThisSwitchIn || target.getTag(BattlerTagType.ER_COMMANDED)) {
      return false;
    }
    return true;
  }

  override apply({ pokemon, opponent: target, simulated }: PostMoveInteractionAbAttrParams): void {
    if (simulated) {
      return;
    }
    // The ErCommandedTag ignores the passed turnCount/sourceMove (it uses its own).
    target.addTag(BattlerTagType.ER_COMMANDED, 0, MoveId.NONE, pokemon.id);
  }
}
