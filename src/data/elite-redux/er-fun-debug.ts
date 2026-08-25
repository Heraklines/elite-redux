/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { speciesEggMoves } from "#balance/moves/egg-moves";
import type { PokemonSpecies } from "#data/pokemon-species";
import { Nature } from "#enums/nature";
import type { DexEntry } from "#types/dex-data";
import type { StarterDataEntry } from "#types/save-data";

export const FUN_DEBUG_STARTER_VALUE_LIMIT = 999;

const ALL_NATURES_ATTR = Object.values(Nature)
  .filter((nature): nature is Nature => typeof nature === "number")
  .reduce((attr, nature) => attr | (1 << (nature + 1)), 0);

/**
 * Applies the Debug unlock overlay to caller-owned copies only. The live
 * account dex and starter records must never be passed to this function.
 */
export function applyFunDebugStarterUnlocks(
  species: PokemonSpecies,
  dexEntry: DexEntry,
  starterDataEntry: StarterDataEntry,
): void {
  dexEntry.seenAttr = species.getFullUnlocksData();
  dexEntry.caughtAttr = species.getFullUnlocksData();
  dexEntry.natureAttr = ALL_NATURES_ATTR;
  dexEntry.ivs = dexEntry.ivs.map(() => 31);

  starterDataEntry.abilityAttr = 0b111;
  starterDataEntry.passiveAttr = 0b111111;
  const eggMoveCount = speciesEggMoves[species.speciesId as keyof typeof speciesEggMoves]?.length ?? 0;
  starterDataEntry.eggMoves = eggMoveCount === 0 ? 0 : (1 << eggMoveCount) - 1;
  starterDataEntry.valueReduction = 2;
  starterDataEntry.erBlackShiny = true;
}
