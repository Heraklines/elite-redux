/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `offensive-type-chart-override` archetype.
//
// The OFFENSIVE counterpart to TypeChartOverrideAbAttr: rewrites the
// type-effectiveness of the HOLDER'S moves against specific target types,
// gated by the move's type. Used for abilities that change how the holder's
// attacks interact with a target type (including piercing immunities to an
// arbitrary multiplier, which IgnoreTypeImmunityAbAttr cannot do — it only
// yields neutral).
//
// Hooked by `Pokemon.getAttackTypeEffectiveness` via a by-name scan of the
// attacker's ability/passive attrs (the same registration-free pattern
// `RecoilAttr` uses for `RecoilDamageMultiplierAbAttr`), so no edit to the
// central AbAttr constructor map is required.
//
// Wires:
//   - 285 Ground Shock — Electric vs Ground: 0x -> 0.5x ("Grounds resist
//     Electric instead of being immune").
//   - 357 Molten Down — Fire vs Rock: 0.5x -> 2x ("Fire is super effective
//     against Rock").
// =============================================================================

import { AbAttr } from "#abilities/ab-attrs";
import { getTypeDamageMultiplier } from "#data/type";
import type { PokemonType } from "#enums/pokemon-type";
import type { NumberHolder } from "#utils/common";

export interface OffensiveTypeChartRule {
  /** Move type that triggers the override. */
  readonly attackType: PokemonType;
  /** Target's type (one of the defender's types) that triggers the override. */
  readonly defenderType: PokemonType;
  /** Effectiveness multiplier to write when the rule matches. */
  readonly newMultiplier: number;
}

export interface OffensiveTypeChartOverrideOptions {
  readonly rules: readonly OffensiveTypeChartRule[];
}

export class OffensiveTypeChartOverrideAbAttr extends AbAttr {
  private readonly rules: readonly OffensiveTypeChartRule[];

  constructor(options: OffensiveTypeChartOverrideOptions) {
    super(false);
    this.rules = options.rules;
  }

  /** Read-only accessor for the configured rules (used by tests). */
  public getRules(): readonly OffensiveTypeChartRule[] {
    return this.rules;
  }

  /**
   * Apply the first matching rule, rewriting `multi`. Called from
   * `Pokemon.getAttackTypeEffectiveness` with the holder's move type, the
   * defender's types, and the running effectiveness holder (which already holds
   * the FULL natural type-effectiveness product across the defender's types).
   *
   * The override replaces ONLY the matched defender type's contribution — it does
   * NOT slam the whole matchup to `newMultiplier`. e.g. Molten Down (Fire vs Rock
   * → 2x) against Relicanth (Water/Rock) must stay neutral: Water 0.5 × Rock(2)
   * = 1.0, NOT 2.0. The old code set `multi.value = newMultiplier` outright, which
   * made every dual-type-with-Rock target take super-effective Fire damage.
   */
  public fire(moveType: PokemonType, defenderTypes: readonly PokemonType[], multi: NumberHolder): void {
    for (const rule of this.rules) {
      if (rule.attackType !== moveType || !defenderTypes.includes(rule.defenderType)) {
        continue;
      }
      const natural = getTypeDamageMultiplier(moveType, rule.defenderType);
      if (natural === 0) {
        // Immunity (natural 0x): can't divide it back out, and the 0 has already
        // zeroed `multi.value`. Recompute the product of the OTHER defender types
        // (one occurrence of the matched type consumed) and apply newMultiplier —
        // this is how piercing-immunity rules (e.g. Ground Shock) reach 0.5x.
        let rest = 1;
        let consumed = false;
        for (const dt of defenderTypes) {
          if (!consumed && dt === rule.defenderType) {
            consumed = true;
            continue;
          }
          rest *= getTypeDamageMultiplier(moveType, dt);
        }
        multi.value = rest * rule.newMultiplier;
      } else {
        // Swap out the matched type's natural component for newMultiplier while
        // preserving every other multiplier already folded into `multi.value`.
        multi.value = (multi.value / natural) * rule.newMultiplier;
      }
      return;
    }
  }
}
