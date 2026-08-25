/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { speciesEggMoves } from "#balance/moves/egg-moves";
import { pokemonEvolutions } from "#balance/pokemon-evolutions";
import type { PokemonSpecies } from "#data/pokemon-species";
import { Nature } from "#enums/nature";
import type { SpeciesId } from "#enums/species-id";
import type { DexEntry } from "#types/dex-data";
import type { Starter, StarterDataEntry } from "#types/save-data";
import { getPokemonSpecies } from "#utils/pokemon-utils";

export const FUN_DEBUG_STARTER_VALUE_LIMIT = 999;

export interface FunDebugStarterStage {
  speciesId: SpeciesId;
  formIndex: number;
  label: string;
}

/**
 * Every fieldable evolution and form reachable from a starter line. This uses
 * the same evolution graph and species form registry as runtime evolution/form
 * changes, while excluding forms explicitly marked unobtainable.
 */
export function listFunDebugStarterStages(rootSpeciesId: SpeciesId): FunDebugStarterStage[] {
  const stages: FunDebugStarterStage[] = [];
  const seenSpecies = new Set<number>();
  const queue: SpeciesId[] = [rootSpeciesId];

  while (queue.length > 0) {
    const speciesId = queue.shift()!;
    if (seenSpecies.has(speciesId)) {
      continue;
    }
    seenSpecies.add(speciesId);

    const species = getPokemonSpecies(speciesId);
    if (species.forms.length === 0) {
      stages.push({ speciesId, formIndex: 0, label: species.name });
    } else {
      species.forms.forEach((form, formIndex) => {
        if (!form.isUnobtainable) {
          stages.push({
            speciesId,
            formIndex,
            label: form.formName ? `${species.name} ${form.formName}` : species.name,
          });
        }
      });
    }

    for (const evolution of pokemonEvolutions[speciesId] ?? []) {
      if (!seenSpecies.has(evolution.speciesId)) {
        queue.push(evolution.speciesId);
      }
    }
  }

  return stages;
}

/** Resolve the concrete Pokemon that a temporary Debug starter should field. */
export function resolveFunDebugStarterStage(
  starter: Starter,
  debugModeActive: boolean,
): Pick<FunDebugStarterStage, "speciesId" | "formIndex"> {
  if (debugModeActive && starter.funDebugSpeciesId != null) {
    return {
      speciesId: starter.funDebugSpeciesId,
      formIndex: starter.funDebugFormIndex ?? 0,
    };
  }
  return { speciesId: starter.speciesId, formIndex: starter.formIndex };
}

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
  const eggMoveCount = Number(speciesEggMoves[species.speciesId as keyof typeof speciesEggMoves]?.length ?? 0);
  starterDataEntry.eggMoves = eggMoveCount === 0 ? 0 : (1 << eggMoveCount) - 1;
  starterDataEntry.valueReduction = 2;
  starterDataEntry.erBlackShiny = true;
}
