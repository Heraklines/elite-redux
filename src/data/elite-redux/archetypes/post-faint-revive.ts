/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-faint-revive` archetype.
//
// PreDefend hook: when an incoming attack would faint the holder, clamp
// the damage to leave the holder at 1 HP AND queue a HealPhase to restore
// to `hpFraction`. One-shot per battle, gated optionally on terrain or
// weather environment.
//
// Implementation: extends pokerogue's PreDefendFullHpEndureAbAttr which
// already implements the damage clamp via the STURDY tag. We override
// canApply with our environment + once-per-battle gate, and override
// apply to ALSO queue a heal-to-fraction phase post-clamp.
//
// Wires:
//   - 629 Shallow Grave — "Revives at 25% HP once after fainting in fog."
//   - 899 Backup Power — "Revives at 25% HP once after fainting in Electric
//     Terrain."
// =============================================================================

import {
  PreDefendFullHpEndureAbAttr,
  type PreDefendModifyDamageAbAttrParams,
} from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { TerrainType } from "#data/terrain";
import { BattlerTagType } from "#enums/battler-tag-type";
import type { WeatherType } from "#enums/weather-type";

export interface PostFaintReviveOptions {
  /** Fraction of max HP restored post-clamp. */
  readonly hpFraction: number;
  /** If set, only revives while one of these terrains is active. */
  readonly requireTerrain?: readonly TerrainType[];
  /** If set, only revives while one of these weathers is active. */
  readonly requireWeather?: readonly WeatherType[];
}

const USED_FLAG = Symbol("PostFaintReviveAbAttr.used");

export class PostFaintReviveAbAttr extends PreDefendFullHpEndureAbAttr {
  private readonly hpFraction: number;
  private readonly requireTerrain: readonly TerrainType[] | null;
  private readonly requireWeather: readonly WeatherType[] | null;

  constructor(options: PostFaintReviveOptions) {
    if (options.hpFraction <= 0 || options.hpFraction > 1) {
      throw new Error("[PostFaintReviveAbAttr] hpFraction must be in (0, 1]");
    }
    super();
    this.hpFraction = options.hpFraction;
    this.requireTerrain = options.requireTerrain ?? null;
    this.requireWeather = options.requireWeather ?? null;
  }

  public override canApply(params: PreDefendModifyDamageAbAttrParams): boolean {
    const { pokemon, damage } = params;
    if ((pokemon as unknown as Record<symbol, boolean>)[USED_FLAG]) {
      return false;
    }
    if (pokemon.getMaxHp() <= 1 || damage.value < pokemon.hp) {
      return false;
    }
    if (this.requireTerrain !== null) {
      const t = globalScene.arena.terrain?.terrainType ?? TerrainType.NONE;
      if (!this.requireTerrain.includes(t)) {
        return false;
      }
    }
    if (this.requireWeather !== null) {
      const w = globalScene.arena.weather?.weatherType;
      if (w === undefined || !this.requireWeather.includes(w)) {
        return false;
      }
    }
    return true;
  }

  public override apply(params: PreDefendModifyDamageAbAttrParams): void {
    const { pokemon, damage, simulated } = params;
    if (simulated) {
      damage.value = Math.max(0, pokemon.hp - 1);
      return;
    }
    // Clamp damage so the holder survives at 1 HP (mirrors STURDY).
    damage.value = Math.max(0, pokemon.hp - 1);
    pokemon.addTag(BattlerTagType.STURDY, 1);
    // Mark used.
    (pokemon as unknown as Record<symbol, boolean>)[USED_FLAG] = true;
    // Heal to fraction in a follow-up phase.
    const targetHp = Math.max(1, Math.floor(pokemon.getMaxHp() * this.hpFraction));
    const delta = Math.max(0, targetHp - 1);
    if (delta > 0) {
      globalScene.phaseManager.unshiftNew(
        "PokemonHealPhase",
        pokemon.getBattlerIndex(),
        delta,
        null,
        true,
        true,
        false,
      );
    }
  }
}
