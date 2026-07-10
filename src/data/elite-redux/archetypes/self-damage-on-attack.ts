/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `self-damage-on-attack` archetype.
//
// Ability-driven self-damage when the holder lands a damaging move. Two bases:
//   - "damageDealt": recoil = `fraction` of the damage dealt by THIS hit. Fires
//     per hit, so a multi-hit move sums to `fraction` of total damage — exactly
//     how vanilla RecoilAttr accumulates.
//   - "maxHp": lose `fraction` of the holder's MAX HP per move. Gated to the
//     move's last hit (`turnData.hitsLeft <= 1`) so multi-hit moves only pay
//     the cost once.
//
// Mirrors vanilla RecoilAttr's damage application
// (`damageAndUpdate(dmg, { result: INDIRECT, ignoreSegments: true })`).
//
// Wires:
//   - 487 Super Strain — "moves deal 25% of the damage done as recoil."
//     (basis "damageDealt", fraction 0.25)
//   - 536 Blood Price — "lose 10% of max HP when landing an attack."
//     (basis "maxHp", fraction 0.10, once per move)
// =============================================================================

import { PostAttackAbAttr, type PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import type { AbilityId } from "#enums/ability-id";
import { HitResult } from "#enums/hit-result";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { toDmgValue } from "#utils/common";

export type SelfDamageBasis = "damageDealt" | "maxHp";

export interface SelfDamageOnAttackOptions {
  /** What the self-damage is a fraction of. */
  readonly basis: SelfDamageBasis;
  /** Fraction of the basis to lose (0.25 = 25%). */
  readonly fraction: number;
  /**
   * Marks this instance as the OFFENSIVE half of Soul Linker (332). Soul Linker
   * is disabled during the Fun and Games (Wobbuffet) minigame - the player taps
   * the Wobbuffet down to a target HP, and self-recoil there would faint the
   * player's mon and break the game. Only Soul Linker is suppressed; Super Strain
   * / Blood Price recoil are unaffected. Self-restoring: works normally after.
   */
  readonly soulLink?: boolean;
  /**
   * When set (Soul Linker), the self-damage is cancelled if the TARGET has this
   * ability (the "does not activate against ANOTHER Soul Linker" clause). Pass the
   * runtime AbilityId of Soul Linker (ER 332).
   */
  readonly cancelIfTargetHasAbility?: AbilityId;
}

export class SelfDamageOnAttackAbAttr extends PostAttackAbAttr {
  private readonly basis: SelfDamageBasis;
  private readonly fraction: number;
  private readonly soulLink: boolean;
  private readonly cancelIfTargetHasAbility: AbilityId | undefined;

  constructor(options: SelfDamageOnAttackOptions) {
    super();
    this.basis = options.basis;
    this.fraction = options.fraction;
    this.soulLink = options.soulLink ?? false;
    this.cancelIfTargetHasAbility = options.cancelIfTargetHasAbility;
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { simulated, damage, pokemon, opponent: target } = params;
    // Soul Linker is suppressed inside the Fun and Games (Wobbuffet) minigame.
    if (
      this.soulLink
      && globalScene.currentBattle?.mysteryEncounter?.encounterType === MysteryEncounterType.FUN_AND_GAMES
    ) {
      return false;
    }
    if (this.soulLink) {
      // Dex: Soul Linker does not activate when either Pokemon is KO'd. Skip the
      // offensive recoil when this hit KO'd the target.
      if (target?.isFainted()) {
        return false;
      }
      // Dex: does not activate against ANOTHER Soul Linker.
      if (this.cancelIfTargetHasAbility != null && target?.hasAbility(this.cancelIfTargetHasAbility)) {
        return false;
      }
    }
    // Damaging move (super) + actually connected for damage this hit.
    if (!super.canApply(params) || simulated || damage <= 0) {
      return false;
    }
    // maxHp cost is per move: only pay on the final hit of a multi-hit move.
    if (this.basis === "maxHp" && pokemon.turnData.hitsLeft > 1) {
      return false;
    }
    return true;
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    const { pokemon, damage } = params;
    const base = this.basis === "maxHp" ? pokemon.getMaxHp() : damage;
    const self = toDmgValue(base * this.fraction, 1);
    if (self <= 0) {
      return;
    }
    pokemon.damageAndUpdate(self, { result: HitResult.INDIRECT, ignoreSegments: true });
  }
}
