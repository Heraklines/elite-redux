/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { getGameMode } from "#app/game-mode";
import { DEFAULT_FUN_MODE_CONFIG, resetFunModeConfig, setFunModeConfig } from "#data/elite-redux/er-fun-mode";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { VoucherType } from "#enums/voucher-type";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Fun Mode capture account progression", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  afterEach(() => resetFunModeConfig());

  it("keeps a caught Pokemon usable and awards candy without unlocking starter-select data", async () => {
    const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.MEWTWO), 50);
    pokemon.shiny = true;
    pokemon.variant = 2;
    pokemon.customPokemonData.erBlackShiny = true;

    const rootSpeciesId = game.scene.gameData.getRootStarterSpeciesId(pokemon.species.speciesId);
    const dexEntry = game.scene.gameData.dexData[rootSpeciesId];
    const starterEntry = game.scene.gameData.getStarterDataEntry(rootSpeciesId);
    dexEntry.caughtAttr = 0n;
    dexEntry.caughtCount = 0;
    dexEntry.natureAttr = 0;
    starterEntry.abilityAttr = 0;
    starterEntry.erBlackShiny = false;
    const addCandy = vi.spyOn(game.scene.gameData, "addStarterCandy").mockReturnValue(true);

    const unlockedStarter = await game.scene.gameData.setPokemonCaught(pokemon, true, false, false, false);

    expect(unlockedStarter).toBe(false);
    expect(dexEntry.caughtAttr).toBe(0n);
    expect(dexEntry.caughtCount).toBe(0);
    expect(dexEntry.natureAttr).toBe(0);
    expect(starterEntry.abilityAttr).toBe(0);
    expect(starterEntry.erBlackShiny).toBe(false);
    expect(addCandy).toHaveBeenCalledWith(rootSpeciesId, 20);
  });

  it("blocks every persistent catch and candy write in Fun Debug", async () => {
    game.scene.gameMode = getGameMode(GameModes.FUN);
    setFunModeConfig({ ...DEFAULT_FUN_MODE_CONFIG, debugMode: true });
    const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.MEWTWO), 50);
    const rootSpeciesId = game.scene.gameData.getRootStarterSpeciesId(pokemon.species.speciesId);
    const dexEntry = game.scene.gameData.dexData[rootSpeciesId];
    const starterEntry = game.scene.gameData.getStarterDataEntry(rootSpeciesId);
    const caughtBefore = dexEntry.caughtAttr;
    const countBefore = dexEntry.caughtCount;
    const ivsBefore = [...dexEntry.ivs];
    const natureBefore = dexEntry.natureAttr;
    const candyBefore = starterEntry.candyCount;

    expect(await game.scene.gameData.setPokemonCaught(pokemon, true, false, false, true)).toBe(false);
    game.scene.gameData.updateSpeciesDexIvs(rootSpeciesId, [31, 31, 31, 31, 31, 31]);
    game.scene.gameData.unlockSpeciesNature(pokemon.species, pokemon.nature);
    expect(game.scene.gameData.addStarterCandy(rootSpeciesId, 100, false, false)).toBe(false);
    expect(dexEntry.caughtAttr).toBe(caughtBefore);
    expect(dexEntry.caughtCount).toBe(countBefore);
    expect(dexEntry.ivs).toEqual(ivsBefore);
    expect(dexEntry.natureAttr).toBe(natureBefore);
    expect(starterEntry.candyCount).toBe(candyBefore);
  });

  it("restores the account baseline after arbitrary in-memory debug mutations", () => {
    game.scene.gameMode = getGameMode(GameModes.FUN);
    setFunModeConfig({ ...DEFAULT_FUN_MODE_CONFIG, debugMode: true });
    const starterEntry = game.scene.gameData.getStarterDataEntry(SpeciesId.BULBASAUR);
    const candyBefore = starterEntry.candyCount;
    const vouchersBefore = game.scene.gameData.voucherCounts[VoucherType.GOLDEN];

    game.scene.gameData.beginFunDebugSystemIsolation();
    starterEntry.candyCount += 999;
    game.scene.gameData.voucherCounts[VoucherType.GOLDEN] += 99;
    game.scene.gameData.achvUnlocks.__DEBUG_ONLY__ = Date.now();
    game.scene.gameData.voucherUnlocks.__DEBUG_ONLY__ = Date.now();
    game.scene.gameData.restoreFunDebugSystemIsolation();

    expect(game.scene.gameData.getStarterDataEntry(SpeciesId.BULBASAUR).candyCount).toBe(candyBefore);
    expect(game.scene.gameData.voucherCounts[VoucherType.GOLDEN]).toBe(vouchersBefore);
    expect(game.scene.gameData.achvUnlocks.__DEBUG_ONLY__).toBeUndefined();
    expect(game.scene.gameData.voucherUnlocks.__DEBUG_ONLY__).toBeUndefined();
  });
});
