/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { speciesEggMoves } from "#balance/moves/egg-moves";
import { applyFunDebugStarterUnlocks, FUN_DEBUG_STARTER_VALUE_LIMIT } from "#data/elite-redux/er-fun-debug";
import { SpeciesId } from "#enums/species-id";
import { RibbonData } from "#system/ribbons/ribbon-data";
import type { DexEntry } from "#types/dex-data";
import type { StarterDataEntry } from "#types/save-data";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { describe, expect, it } from "vitest";

describe("Fun Debug starter overlay", () => {
  it("unlocks the complete temporary starter surface without mutating source records", () => {
    const species = getPokemonSpecies(SpeciesId.BULBASAUR);
    const sourceDex: DexEntry = {
      seenAttr: 0n,
      caughtAttr: 0n,
      natureAttr: 0,
      seenCount: 3,
      caughtCount: 2,
      hatchedCount: 1,
      ivs: [1, 2, 3, 4, 5, 6],
      ribbons: new RibbonData(0n),
    };
    const sourceStarter: StarterDataEntry = {
      moveset: null,
      eggMoves: 0,
      candyCount: 17,
      friendship: 9,
      abilityAttr: 1,
      passiveAttr: 0,
      valueReduction: 0,
      classicWinCount: 0,
      erBlackShiny: false,
    };
    const copiedDex = { ...sourceDex, ivs: [...sourceDex.ivs] };
    const copiedStarter = { ...sourceStarter };

    applyFunDebugStarterUnlocks(species, copiedDex, copiedStarter);

    expect(FUN_DEBUG_STARTER_VALUE_LIMIT).toBe(999);
    expect(copiedDex.seenAttr).toBe(species.getFullUnlocksData());
    expect(copiedDex.caughtAttr).toBe(species.getFullUnlocksData());
    expect(copiedDex.natureAttr).toBe(67_108_862);
    expect(copiedDex.ivs).toEqual([31, 31, 31, 31, 31, 31]);
    expect(copiedStarter.abilityAttr).toBe(0b111);
    expect(copiedStarter.passiveAttr).toBe(0b111111);
    expect(copiedStarter.eggMoves).toBe((1 << speciesEggMoves[SpeciesId.BULBASAUR].length) - 1);
    expect(copiedStarter.valueReduction).toBe(2);
    expect(copiedStarter.erBlackShiny).toBe(true);

    expect(sourceDex).toMatchObject({ seenAttr: 0n, caughtAttr: 0n, natureAttr: 0, ivs: [1, 2, 3, 4, 5, 6] });
    expect(sourceStarter).toMatchObject({ abilityAttr: 1, passiveAttr: 0, eggMoves: 0, erBlackShiny: false });
  });
});
