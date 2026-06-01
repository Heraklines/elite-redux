/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `suppress-attacker-ability` archetype.
//
// PostDefend hook (configurable trigger) that suppresses the attacker's
// ability for the rest of the battle. Mirrors vanilla Neutralizing Gas at
// a more local scope.
//
// Wires:
//   - 808 Malodor — "Suppresses attacker's abilities on contact."
//   - 832 Hemotoxin — "Suppresses abilities of the target when they're
//     poisoned." Different trigger: when the attacker is poisoned, suppress
//     their ability. We model this as PostDefend with a status-on-attacker
//     filter.
// =============================================================================

import { PostDefendAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { MoveFlags } from "#enums/move-flags";
import { StatusEffect } from "#enums/status-effect";
import type { WeatherType } from "#enums/weather-type";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";

export interface SuppressAttackerAbilityOptions {
  /** If true, only triggers on contact moves. */
  readonly contactOnly?: boolean;
  /** If set, only triggers if the attacker has one of these status effects. */
  readonly requireAttackerStatus?: readonly StatusEffect[];
  /**
   * If set, only triggers while one of these weathers is active. Used as the
   * established ER "enraged" proxy — `WeatherType.FOG` (cf. Madness Enhancement).
   */
  readonly weathers?: readonly WeatherType[];
}

export class SuppressAttackerAbilityAbAttr extends PostDefendAbAttr {
  private readonly contactOnly: boolean;
  private readonly requireAttackerStatus: readonly StatusEffect[] | null;
  private readonly weathers: readonly WeatherType[] | null;

  constructor(options: SuppressAttackerAbilityOptions = {}) {
    super(false);
    this.contactOnly = options.contactOnly ?? false;
    this.requireAttackerStatus = options.requireAttackerStatus ?? null;
    this.weathers = options.weathers ?? null;
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { move, pokemon, opponent } = params;
    if (!opponent || !move.is("AttackMove")) {
      return false;
    }
    if (this.weathers !== null) {
      const current = globalScene.arena.weather;
      if (!current || current.isEffectSuppressed() || !this.weathers.includes(current.weatherType)) {
        return false;
      }
    }
    if (
      this.contactOnly
      && !move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: opponent, target: pokemon })
    ) {
      return false;
    }
    if (this.requireAttackerStatus !== null) {
      const status = opponent.status?.effect ?? StatusEffect.NONE;
      if (!this.requireAttackerStatus.includes(status)) {
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
