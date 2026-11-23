/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `self-highest-stat-boost-on-summon` primitive.
//
// On switch-in, find the holder's highest base stat (among configurable
// candidates) and apply a stat-stage change to it. Optionally gated on
// weather, terrain, or fog presence.
//
// Wires:
//   - 380 Sun Worship — highest stat +1 on entry when sunny
//   - 356 Sea Guardian — highest stat +1 on entry when raining
//   - 625 Greater Spirit — highest stat +1 on entry in fog
//   - 330 Majestic Moth — highest stat +1 on entry (always)
//   - 868 Lightning Aspect — highest stat +1 on entry (post-absorb)
//   - 910 Turf War — destroys terrain + highest stat +1 on entry
// =============================================================================

import { PostSummonAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import type { EffectiveStat } from "#enums/stat";
import type { TerrainType } from "#enums/terrain-type";
import type { WeatherType } from "#enums/weather-type";
import type { AbAttrBaseParams, AbAttrCondition } from "#types/ability-types";

export interface SelfHighestStatBoostOnSummonOptions {
  /** Candidate stats — whichever has the highest current value gets the boost. */
  readonly candidates: readonly EffectiveStat[];
  /** Stage delta to apply (typically +1). */
  readonly stages: number;
  /** Optional weather gate. Omit for "any weather". */
  readonly weathers?: readonly WeatherType[];
  /** Optional terrain gate. Omit for "any terrain". */
  readonly terrains?: readonly TerrainType[];
}

export class SelfHighestStatBoostOnSummonAbAttr extends PostSummonAbAttr {
  private readonly candidates: readonly EffectiveStat[];
  private readonly stages: number;
  /** Whether the boost may happen; read by the ability studio. */
  public readonly condition: AbAttrCondition;

  /**
   * @param opts - the stats, the stages and the weather / terrain lists of the default condition
   * @param condition - When the boost may happen, called with the holder. The default is "the active weather is one of
   *   `opts.weathers` and the active terrain is one of `opts.terrains`" (a list that is left out is not tested), so
   *   `new SelfHighestStatBoostOnSummonAbAttr({ ... })` behaves exactly as before; the ability studio hands in a replacement.
   */
  constructor(opts: SelfHighestStatBoostOnSummonOptions, condition?: AbAttrCondition) {
    super(true);
    if (opts.candidates.length === 0) {
      throw new Error("[SelfHighestStatBoostOnSummonAbAttr] candidates must be non-empty");
    }
    if (opts.stages === 0) {
      throw new Error("[SelfHighestStatBoostOnSummonAbAttr] stages must be non-zero");
    }
    this.candidates = opts.candidates;
    this.stages = opts.stages;
    const { weathers, terrains } = opts;
    this.condition =
      condition
      ?? (() => {
        if (weathers !== undefined) {
          const active = globalScene.arena.weather?.weatherType;
          if (active === undefined || !weathers.includes(active)) {
            return false;
          }
        }
        if (terrains !== undefined) {
          const active = globalScene.arena.terrain?.terrainType;
          if (active === undefined || !terrains.includes(active)) {
            return false;
          }
        }
        return true;
      });
  }

  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    return this.condition(pokemon);
  }

  override apply(params: AbAttrBaseParams): void {
    const { pokemon, simulated } = params;
    if (simulated) {
      return;
    }
    let bestStat: EffectiveStat = this.candidates[0];
    let bestValue = -1;
    for (const stat of this.candidates) {
      const value = pokemon.getStat(stat, false);
      if (value > bestValue) {
        bestValue = value;
        bestStat = stat;
      }
    }
    globalScene.phaseManager.unshiftNew(
      "StatStageChangePhase",
      pokemon.getBattlerIndex(),
      true,
      [bestStat],
      this.stages,
    );
  }
}
