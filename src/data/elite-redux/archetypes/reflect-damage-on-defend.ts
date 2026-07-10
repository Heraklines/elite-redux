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

export interface ReflectDamageOnDefendOptions {
  /**
   * When set, the reflect is cancelled if the ATTACKER also has this ability
   * (the "does not activate against ANOTHER Soul Linker" clause). Pass the
   * runtime AbilityId of Soul Linker (ER 332).
   */
  readonly cancelIfAttackerHasAbility?: AbilityId;
}

export class ReflectDamageOnDefendAbAttr extends PostDefendAbAttr {
  private readonly cancelIfAttackerHasAbility: AbilityId | undefined;

  constructor(options: ReflectDamageOnDefendOptions = {}) {
    super();
    this.cancelIfAttackerHasAbility = options.cancelIfAttackerHasAbility;
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { simulated, damage, opponent: attacker, pokemon } = params;
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
    if (this.cancelIfAttackerHasAbility != null && attacker?.hasAbility(this.cancelIfAttackerHasAbility)) {
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
