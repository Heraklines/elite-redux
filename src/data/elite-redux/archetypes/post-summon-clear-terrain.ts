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
//   - 886 Curse of Famine — "Eats terrain, restores HP, and boosts a defense."
//     (onCleared Def+1 + healFractionOnCleared 0.25.)
// =============================================================================

import { type AbAttrBaseParams, PostSummonAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { TerrainType } from "#data/terrain";
import type { BattleStat } from "#enums/stat";
import { toDmgValue } from "#utils/common";
import i18next from "i18next";

export interface PostSummonClearTerrainOptions {
  /** Stat-stage changes applied to the holder if ANY terrain was cleared. */
  readonly onCleared?: ReadonlyArray<{ stat: BattleStat; stages: number }>;
  /**
   * Stat-stage changes keyed by the SPECIFIC terrain cleared (read before
   * reset). Lawnmower: Def+1 for Grassy/Electric, SpDef+1 for Misty/Psychic/Toxic.
   */
  readonly byTerrain?: ReadonlyArray<{ terrain: TerrainType; stat: BattleStat; stages: number }>;
  /**
   * Fraction of the holder's max HP to restore when a terrain is cleared
   * ("eats" the terrain). Used by Curse of Famine 886.
   */
  readonly healFractionOnCleared?: number;
}

export class PostSummonClearTerrainAbAttr extends PostSummonAbAttr {
  private readonly onCleared: ReadonlyArray<{ stat: BattleStat; stages: number }>;
  private readonly byTerrain: ReadonlyArray<{ terrain: TerrainType; stat: BattleStat; stages: number }>;
  private readonly healFractionOnCleared: number;

  constructor(options: PostSummonClearTerrainOptions = {}) {
    super(true);
    this.onCleared = options.onCleared ?? [];
    this.byTerrain = options.byTerrain ?? [];
    this.healFractionOnCleared = options.healFractionOnCleared ?? 0;
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
    // "Eats" the terrain to restore HP (Curse of Famine 886).
    if (this.healFractionOnCleared > 0 && !pokemon.isFullHp()) {
      const healAmount = toDmgValue(pokemon.getMaxHp() * this.healFractionOnCleared);
      if (healAmount > 0) {
        globalScene.phaseManager.unshiftNew(
          "PokemonHealPhase",
          pokemon.getBattlerIndex(),
          healAmount,
          i18next.t("abilityTriggers:postAttackHeal", {
            pokemonNameWithAffix: getPokemonNameWithAffix(pokemon),
            abilityName: pokemon.getAbility()?.name ?? "",
          }),
          true,
        );
      }
    }
  }
}
