/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-summon-clear-terrain` archetype.
//
// PostSummon hook that clears the active terrain and optionally applies
// stat-stage changes to the holder if a terrain was cleared.
//
// Wires:
//   - 602 Lawnmower — "Removes terrain on switch-in. Stat up if terrain
//     removed." (Set terrain to NONE, +1 ATK if a terrain was present.)
// =============================================================================

import { type AbAttrBaseParams, PostSummonAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { TerrainType } from "#data/terrain";
import type { BattleStat } from "#enums/stat";

export interface PostSummonClearTerrainOptions {
  /** Stat-stage changes applied to the holder if ANY terrain was cleared. */
  readonly onCleared?: ReadonlyArray<{ stat: BattleStat; stages: number }>;
  /**
   * Stat-stage changes keyed by the SPECIFIC terrain cleared (read before
   * reset). Lawnmower: Def+1 for Grassy/Electric, SpDef+1 for Misty/Psychic/Toxic.
   */
  readonly byTerrain?: ReadonlyArray<{ terrain: TerrainType; stat: BattleStat; stages: number }>;
}

export class PostSummonClearTerrainAbAttr extends PostSummonAbAttr {
  private readonly onCleared: ReadonlyArray<{ stat: BattleStat; stages: number }>;
  private readonly byTerrain: ReadonlyArray<{ terrain: TerrainType; stat: BattleStat; stages: number }>;

  constructor(options: PostSummonClearTerrainOptions = {}) {
    super(true);
    this.onCleared = options.onCleared ?? [];
    this.byTerrain = options.byTerrain ?? [];
  }

  override canApply(_params: AbAttrBaseParams): boolean {
    return (
      globalScene.arena.terrain?.terrainType !== undefined && globalScene.arena.terrain.terrainType !== TerrainType.NONE
    );
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const cleared = globalScene.arena.terrain?.terrainType;
    globalScene.arena.trySetTerrain(TerrainType.NONE, false);
    const changes = [...this.onCleared, ...this.byTerrain.filter(c => c.terrain === cleared)];
    for (const change of changes) {
      globalScene.phaseManager.unshiftNew(
        "StatStageChangePhase",
        pokemon.getBattlerIndex(),
        true,
        [change.stat],
        change.stages,
      );
    }
  }
}
