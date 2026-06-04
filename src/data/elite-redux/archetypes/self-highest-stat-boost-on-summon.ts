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
import type { AbAttrBaseParams } from "#types/ability-types";
import { globalScene } from "#app/global-scene";
import type { EffectiveStat } from "#enums/stat";
import type { WeatherType } from "#enums/weather-type";
import type { TerrainType } from "#enums/terrain-type";

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
  private readonly weathers?: readonly WeatherType[];
  private readonly terrains?: readonly TerrainType[];

  constructor(opts: SelfHighestStatBoostOnSummonOptions) {
    super(true);
    if (opts.candidates.length === 0) {
      throw new Error("[SelfHighestStatBoostOnSummonAbAttr] candidates must be non-empty");
    }
    if (opts.stages === 0) {
      throw new Error("[SelfHighestStatBoostOnSummonAbAttr] stages must be non-zero");
    }
    this.candidates = opts.candidates;
    this.stages = opts.stages;
    this.weathers = opts.weathers;
    this.terrains = opts.terrains;
  }

  override canApply(_params: AbAttrBaseParams): boolean {
    if (this.weathers !== undefined) {
      const active = globalScene.arena.weather?.weatherType;
      if (active === undefined || !this.weathers.includes(active)) {
        return false;
      }
    }
    if (this.terrains !== undefined) {
      const active = globalScene.arena.terrain?.terrainType;
      if (active === undefined || !this.terrains.includes(active)) {
        return false;
      }
    }
    return true;
  }

  override apply(params: AbAttrBaseParams): void {
    const { pokemon, simulated } = params;
    if (simulated) return;
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
