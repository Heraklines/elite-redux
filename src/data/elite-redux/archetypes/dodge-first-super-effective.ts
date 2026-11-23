/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `dodge-first-super-effective` archetype.
//
// Engine-side hook: dispatched through pokerogue's existing
// `applyAbAttrs("TypeImmunityAbAttr", …)` pass inside
// `Pokemon.getAttackTypeEffectiveness` (src/field/pokemon.ts). By the time that
// pass runs, `typeMultiplier` already holds the type-chart effectiveness, so we
// can read it to detect a super-effective hit (exactly how `Wonder Guard`'s
// `NonSuperEffectiveImmunityAbAttr` reads `typeMultiplier.value < 2`).
//
// Wires:
//   - 184 ANTICIPATION — "Senses Super-effective moves. Dodges one
//     Super-effective hit." This class implements the dodge half: the FIRST
//     super-effective attack received in a battle is nullified (multiplier → 0),
//     then a once-per-battle charge is spent (tracked on `battleData`). The
//     sense/shudder half is the vanilla base ability and is left untouched.
// =============================================================================

import { TypeImmunityAbAttr, type TypeMultiplierAbAttrParams } from "#abilities/ab-attrs";
import { getPokemonNameWithAffix } from "#app/messages";
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import i18next from "i18next";

export class DodgeFirstSuperEffectiveAbAttr
  extends TypeImmunityAbAttr
  implements GatedAttr<TypeMultiplierAbAttrParams>
{
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: TypeMultiplierAbAttrParams) => boolean) | undefined;

  /** The type-chart multiplier from which a hit counts as super effective (the original fixed value is 2). */
  private readonly minMultiplier: number;

  constructor(minMultiplier = 2) {
    // `null` immune type + custom canApply, mirroring NonSuperEffectiveImmunityAbAttr.
    super(null);
    this.minMultiplier = minMultiplier;
  }

  /**
   * Tier B split (ability studio spec 3.1). The original was one `&&` chain of pure reads: an attacking move, the
   * type-chart multiplier is high enough, the damage comes from another Pokemon, the once-per-battle charge is still
   * there. The order of pure reads cannot change the answer and nothing here draws a random number, so they are sorted
   * by kind: `guards` (attacking move, comes from another Pokemon), the replaceable `gate` (the charge is still there) and
   * the `residual` (the multiplier test, which has no library condition yet: it needs the matchup of the frame).
   */
  override canApply(params: TypeMultiplierAbAttrParams): boolean {
    return gatedCanApply<TypeMultiplierAbAttrParams>(this, params);
  }

  /** Safety rules that stay in the class: an attacking move, from another Pokemon (do not burn the charge on self or ally hits). */
  public guards({ move, pokemon, opponent: attacker }: TypeMultiplierAbAttrParams): boolean {
    return move.is("AttackMove") && attacker !== pokemon;
  }

  /** The replaceable condition: the once-per-battle charge is still available. */
  public gate({ pokemon }: TypeMultiplierAbAttrParams): boolean {
    return !pokemon.battleData.anticipationDodgeUsed;
  }

  /** Feasibility that stays in the class until the library can read the matchup: the hit is super effective. */
  public residual({ typeMultiplier }: TypeMultiplierAbAttrParams): boolean {
    return typeMultiplier.value >= this.minMultiplier;
  }

  override apply(params: TypeMultiplierAbAttrParams): void {
    const { typeMultiplier, cancelled, simulated, pokemon } = params;
    typeMultiplier.value = 0;
    cancelled.value = true; // Suppresses the "No Effect" message.
    if (!simulated) {
      // Spend the once-per-battle charge. Resets with the rest of battleData
      // on each new encounter (see PokemonBattleData / resetBattleAndWaveData).
      pokemon.battleData.anticipationDodgeUsed = true;
    }
  }

  override getTriggerMessage({ pokemon }: TypeMultiplierAbAttrParams, abilityName: string): string {
    // Reuse the generic "avoided damage with <ability>" line (also used by Ice Face).
    return i18next.t("abilityTriggers:iceFaceAvoidedDamage", {
      pokemonNameWithAffix: getPokemonNameWithAffix(pokemon),
      abilityName,
    });
  }
}
