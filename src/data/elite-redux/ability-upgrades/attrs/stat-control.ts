/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { type BattleStat, Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import type { StatStageChangeCallback } from "#phases/stat-stage-change-phase";

export type SuccessfulStatDropCallback = (
  target: Pokemon,
  changed: readonly BattleStat[],
  relativeChanges: readonly number[],
) => void;

export function selectHigherOffenseStat(pokemon: Pokemon): Stat.ATK | Stat.SPATK {
  return pokemon.getStat(Stat.SPATK, false) > pokemon.getStat(Stat.ATK, false) ? Stat.SPATK : Stat.ATK;
}

export function selectHigherDefenseStat(pokemon: Pokemon): Stat.DEF | Stat.SPDEF {
  return pokemon.getStat(Stat.SPDEF, false) > pokemon.getStat(Stat.DEF, false) ? Stat.SPDEF : Stat.DEF;
}

export function onSuccessfulStatDrop(callback: SuccessfulStatDropCallback): StatStageChangeCallback {
  return (target, changed, relativeChanges) => {
    if (!target) {
      return;
    }

    const droppedStats: BattleStat[] = [];
    const actualDrops: number[] = [];
    for (let index = 0; index < changed.length; index++) {
      const relativeChange = relativeChanges[index] ?? 0;
      if (relativeChange < 0) {
        droppedStats.push(changed[index]);
        actualDrops.push(relativeChange);
      }
    }

    if (droppedStats.length > 0) {
      callback(target, droppedStats, actualDrops);
    }
  };
}
