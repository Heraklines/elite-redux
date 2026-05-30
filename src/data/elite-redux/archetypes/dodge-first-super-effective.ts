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
import i18next from "i18next";

export class DodgeFirstSuperEffectiveAbAttr extends TypeImmunityAbAttr {
  constructor() {
    // `null` immune type + custom canApply, mirroring NonSuperEffectiveImmunityAbAttr.
    super(null);
  }

  override canApply({ move, typeMultiplier, pokemon, opponent: attacker }: TypeMultiplierAbAttrParams): boolean {
    return (
      move.is("AttackMove") // Super-effective: the type-chart multiplier is >= 2x.
      && typeMultiplier.value >= 2 // Foe-sourced damage only (don't burn the charge on self/ally hits).
      && attacker !== pokemon // Once-per-battle charge still available.
      && !pokemon.battleData.anticipationDodgeUsed
    );
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
