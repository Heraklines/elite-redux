/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — bespoke ability `Cleansing Light` (Mega Xerneas).
//
// "For every direct KO the holder scores, heal the lowest-HP living ally by 10%
// of its max HP. If the holder scores a SECOND (or later) direct KO in the SAME
// turn, that heal ALSO cures the chosen ally's status."
//
// Doubles-oriented. In singles with no living ally the effect is WASTED (strict
// reading of the spec — DECISION, documented in the batch report). Implemented
// as a `PostVictoryAbAttr` (fires on the mon that lands a direct KO, from
// `FaintPhase`). Per-turn KO count is tracked per-holder keyed on wave+turn.
// =============================================================================

import { PostVictoryAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import type { Pokemon } from "#field/pokemon";
import type { AbAttrBaseParams } from "#types/ability-types";
import { toDmgValue } from "#utils/common";
import i18next from "i18next";

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_CLEANSING_LIGHT_ABILITY_ID = 5912;

/** Fraction of the healed ally's max HP restored per KO. */
export const CLEANSING_LIGHT_HEAL_FRACTION = 0.1;

/** Per-holder record of `{ key, count }` — how many direct KOs it scored this turn. */
const CLEANSING_LIGHT_KO_COUNT = new WeakMap<Pokemon, { key: string; count: number }>();

/** Stable identity for "this turn of this battle" (wave + turn number). */
function turnKey(): string {
  const battle = globalScene.currentBattle;
  return `${battle?.waveIndex ?? 0}:${battle?.turn ?? 0}`;
}

/**
 * Record a KO for `pokemon` this turn and return the running count (1 for the
 * first KO of the turn, 2 for the second, …). Resets when the turn key changes.
 */
function bumpKoCount(pokemon: Pokemon): number {
  const key = turnKey();
  const prev = CLEANSING_LIGHT_KO_COUNT.get(pokemon);
  const count = prev && prev.key === key ? prev.count + 1 : 1;
  CLEANSING_LIGHT_KO_COUNT.set(pokemon, { key, count });
  return count;
}

export class CleansingLightAbAttr extends PostVictoryAbAttr {
  /** The lowest-HP living ally, or `undefined` in singles / when none survive. */
  private lowestAlly(pokemon: Pokemon): Pokemon | undefined {
    const living = pokemon.getAllies().filter(a => a?.isActive(true) && !a.isFainted());
    if (living.length === 0) {
      return;
    }
    return living.reduce((lowest, a) => (a.hp < lowest.hp ? a : lowest));
  }

  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    return this.lowestAlly(pokemon) !== undefined;
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    // Count the KO even when simulated would no-op, so the "second KO cures"
    // trajectory tracks real KOs only. `apply` is only reached on a real KO
    // (FaintPhase), and simulated PostVictory calls do not occur, but guard anyway.
    if (simulated) {
      return;
    }
    const koCount = bumpKoCount(pokemon);
    const ally = this.lowestAlly(pokemon);
    if (!ally) {
      // Singles / no living ally — the effect is wasted (strict reading).
      return;
    }
    const abilityName = pokemon.getAbility()?.name ?? "";
    if (!ally.isFullHp()) {
      globalScene.phaseManager.unshiftNew(
        "PokemonHealPhase",
        ally.getBattlerIndex(),
        toDmgValue(ally.getMaxHp() * CLEANSING_LIGHT_HEAL_FRACTION),
        i18next.t("abilityTriggers:postTurnHeal", {
          pokemonNameWithAffix: getPokemonNameWithAffix(ally),
          abilityName,
        }),
        true,
      );
    }
    // Second (or later) KO this turn also cures the chosen ally's status.
    if (koCount >= 2 && ally.status) {
      ally.resetStatus();
      globalScene.phaseManager.queueMessage(`${ally.getNameToRender()}'s status was cleansed!`);
    }
  }
}
