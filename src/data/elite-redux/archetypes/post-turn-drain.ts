/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-turn-drain` archetype.
//
// At each turn end, drains `fraction` of every opponent's max HP and heals the
// holder by the total drained. Optionally gated on the active weather.
//
// Wires:
//   - 737 Life Steal — "Steals 1/10 HP from foes each turn." (fraction 0.1)
//   - 820 Soul Tap — "Drain 10% HP from foes each turn in fog." (fraction 0.1,
//     weather FOG)
// =============================================================================

import { PostTurnAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { applyAbilityDrainRecovery } from "#data/elite-redux/archetypes/lifesteal";
import { HitResult } from "#enums/hit-result";
import { WeatherType } from "#enums/weather-type";
import type { AbAttrBaseParams } from "#types/ability-types";
import { toDmgValue } from "#utils/common";
import i18next from "i18next";

export interface PostTurnDrainOptions {
  /** Fraction of each opponent's max HP drained per turn (e.g. 0.1). */
  readonly fraction: number;
  /** If set, only drains while one of these weathers is active. */
  readonly weather?: readonly WeatherType[];
  /** When true, only opponents currently carrying a trapping/binding tag are drained. */
  readonly onlyIfTrapped?: boolean;
}

export class PostTurnDrainAbAttr extends PostTurnAbAttr {
  private readonly fraction: number;
  private readonly weather: readonly WeatherType[] | null;
  private readonly onlyIfTrapped: boolean;

  constructor(options: PostTurnDrainOptions) {
    super();
    this.fraction = options.fraction;
    this.weather = options.weather ?? null;
    this.onlyIfTrapped = options.onlyIfTrapped ?? false;
  }

  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    if (this.weather) {
      const current = globalScene.arena.weather?.weatherType ?? WeatherType.NONE;
      if (!this.weather.includes(current)) {
        return false;
      }
    }
    return pokemon.getOpponents().some(o => o && !o.isFainted() && o.hp > 0 && (!this.onlyIfTrapped || o.isTrapped()));
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    // Triple: a placement-dependent foe effect only reaches ADJACENT foes (binary: all foes).
    for (const opp of pokemon.getAdjacentOpponents()) {
      if (!opp || opp.isFainted() || opp.hp <= 0 || (this.onlyIfTrapped && !opp.isTrapped())) {
        continue;
      }
      const dmg = toDmgValue(opp.getMaxHp() * this.fraction);
      const before = opp.hp;
      opp.damageAndUpdate(dmg, { result: HitResult.INDIRECT });
      const amount = before - opp.hp;
      if (amount <= 0) {
        continue;
      }
      const message = i18next.t("abilityTriggers:postTurnHeal", {
        pokemonNameWithAffix: getPokemonNameWithAffix(pokemon),
        abilityName: pokemon.getAbility()?.name ?? "",
      });
      applyAbilityDrainRecovery(pokemon, opp, amount, message);
    }
  }
}
