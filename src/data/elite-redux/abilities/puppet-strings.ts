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
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { StatusEffect } from "#enums/status-effect";

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_PUPPET_STRINGS_ABILITY_ID = 5901;

export class PuppetStringsAbAttr extends PostAttackAbAttr implements GatedAttr<PostMoveInteractionAbAttrParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  constructor() {
    // The default `attackCondition` (inherited) already requires a damaging
    // (non-status) move; `showAbility` false — the tag application shows its own
    // message.
    super(undefined, false);
  }

  /**
   * Tier B (ability studio spec 3.1): `canApply = guards && gate && residual`. The original clause order was
   * damaging move, other target / alive / damage dealt, Psychic move, poisoned target, Shield Dust, already Commanded.
   * None of them draws a random number or has a side effect, so grouping the safety rules first changes no result.
   */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  /**
   * Safety rules: the target is another Pokemon that is still standing, the move really dealt damage, and the target
   * is not protected from added effects (Shield Dust and friends block ability-inflicted added effects).
   */
  public guards({ pokemon, opponent: target, damage }: PostMoveInteractionAbAttrParams): boolean {
    if (pokemon === target || target.isFainted() || damage <= 0) {
      return false;
    }
    return !target.hasAbilityWithAttr("IgnoreMoveEffectsAbAttr");
  }

  /** The replaceable conditions: a damaging move (base condition), of Psychic type, against a poisoned or badly poisoned target. */
  public gate(params: PostMoveInteractionAbAttrParams): boolean {
    // Must be a damaging move (base condition).
    if (!super.canApply(params)) {
      return false;
    }
    const { pokemon, opponent: target, move } = params;
    // Psychic-type move (respects the holder's type-changing effects).
    if (pokemon.getMoveType(move) !== PokemonType.PSYCHIC) {
      return false;
    }
    // Target must be poisoned or badly poisoned.
    const status = target.status?.effect;
    return status === StatusEffect.POISON || status === StatusEffect.TOXIC;
  }

  /**
   * Feasibility that stays in the class, once-per-switch-in: not when the target has already been Commanded this
   * send-out, or is currently Commanded.
   */
  public residual({ opponent: target }: PostMoveInteractionAbAttrParams): boolean {
    return !(target.summonData.erCommandedUsedThisSwitchIn || target.getTag(BattlerTagType.ER_COMMANDED));
  }

  override apply({ pokemon, opponent: target, simulated }: PostMoveInteractionAbAttrParams): void {
    if (simulated) {
      return;
    }
    // The ErCommandedTag ignores the passed turnCount/sourceMove (it uses its own).
    target.addTag(BattlerTagType.ER_COMMANDED, 0, MoveId.NONE, pokemon.id);
  }
}
