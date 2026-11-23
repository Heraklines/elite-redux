/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `reflect-damage-on-defend` archetype.
//
// When the holder takes a direct hit, the attacker takes the SAME amount of
// damage back. The offensive counterpart ("user also takes the damage it
// deals") is the existing SelfDamageOnAttackAbAttr with basis "damageDealt"
// and fraction 1.0.
//
// Wires:
//   - 332 Soul Linker — "When the holder takes a direct hit, the attacker takes
//     identical damage. Does NOT activate when either Pokemon is KO'd, from Pain
//     Split, or against ANOTHER Soul Linker." (paired with SelfDamageOnAttack
//     damageDealt 1.0)
// =============================================================================

import { PostDefendAbAttr, type PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import type { AbilityId } from "#enums/ability-id";
import { HitResult } from "#enums/hit-result";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import type { PokemonDefendCondition } from "#types/ability-types";

export interface ReflectDamageOnDefendOptions {
  /**
   * When set, the reflect is cancelled if the ATTACKER also has this ability
   * (the "does not activate against ANOTHER Soul Linker" clause). Pass the
   * runtime AbilityId of Soul Linker (ER 332).
   */
  readonly cancelIfAttackerHasAbility?: AbilityId;
}

export class ReflectDamageOnDefendAbAttr extends PostDefendAbAttr {
  /** Whether the reflect may happen against this attacker; read by the ability studio. */
  public readonly condition: PokemonDefendCondition;

  /**
   * @param options - the exception ability of the default condition
   * @param condition - When the reflect may happen, called with the holder, the attacker and the move. The default is
   *   "the attacker does not have `options.cancelIfAttackerHasAbility`" (always true without one), so
   *   `new ReflectDamageOnDefendAbAttr({ ... })` behaves exactly as before; the ability studio hands in a replacement.
   */
  constructor(options: ReflectDamageOnDefendOptions = {}, condition?: PokemonDefendCondition) {
    super();
    const cancelIfAttackerHasAbility = options.cancelIfAttackerHasAbility;
    this.condition =
      condition
      ?? ((_target, attacker) =>
        !(cancelIfAttackerHasAbility != null && attacker?.hasAbility(cancelIfAttackerHasAbility)));
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { simulated, damage, opponent: attacker, pokemon, move } = params;
    // Soul Linker (this attr is Soul-Linker-only) is suppressed inside the Fun and
    // Games (Wobbuffet) minigame so the player can tap the Wobbuffet down freely.
    if (globalScene.currentBattle?.mysteryEncounter?.encounterType === MysteryEncounterType.FUN_AND_GAMES) {
      return false;
    }
    // Dex: does not activate when EITHER Pokemon is KO'd. Skip if the holder just
    // fainted from this hit (the attacker's already-fainted case is handled below).
    if (pokemon.isFainted()) {
      return false;
    }
    // Dex: does not activate against ANOTHER Soul Linker.
    if (!this.condition(pokemon, attacker, move)) {
      return false;
    }
    // Only on a direct damaging hit from a distinct attacker.
    return !simulated && damage > 0 && attacker != null && attacker !== pokemon && !attacker.isFainted();
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    const { damage, opponent: attacker } = params;
    attacker.damageAndUpdate(damage, { result: HitResult.INDIRECT, ignoreSegments: true });
  }
}
