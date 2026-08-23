/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { getGameMode } from "#app/game-mode";
import { pokemonEvolutions } from "#balance/pokemon-evolutions";
import { DEFAULT_FUN_MODE_CONFIG, resetFunModeConfig, setFunModeConfig } from "#data/elite-redux/er-fun-mode";
import { DexAttr } from "#enums/dex-attr";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Fun Mode shuffled-evolution account progression", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  afterEach(() => {
    resetFunModeConfig();
  });

  it("keeps the evolved run mon black without unlocking the unrelated shuffled target line", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    game.scene.gameMode = getGameMode(GameModes.FUN);
    setFunModeConfig({ ...DEFAULT_FUN_MODE_CONFIG, shuffleEvolutions: true });

    const pokemon = game.scene.getPlayerPokemon()!;
    pokemon.level = 60;
    pokemon.shiny = true;
    pokemon.variant = 2;
    pokemon.customPokemonData.erBlackShiny = true;

    const sourceRoot = game.scene.gameData.getRootStarterSpeciesId(pokemon.species.speciesId);
    game.scene.gameData.starterData[sourceRoot].erBlackShiny = true;

    const evolution = pokemon.getEvolution();
    expect(evolution).not.toBeNull();
    const targetRoot = game.scene.gameData.getRootStarterSpeciesId(evolution!.speciesId);
    expect(targetRoot).not.toBe(sourceRoot);

    const ordinaryCaughtAttr = DexAttr.NON_SHINY | DexAttr.MALE | DexAttr.DEFAULT_VARIANT | DexAttr.DEFAULT_FORM;
    const targetDex = game.scene.gameData.dexData[targetRoot];
    targetDex.caughtAttr = ordinaryCaughtAttr;
    targetDex.seenAttr = ordinaryCaughtAttr;
    targetDex.ivs = [1, 2, 3, 4, 5, 6];
    game.scene.gameData.starterData[targetRoot].erBlackShiny = false;

    const before = {
      caughtAttr: targetDex.caughtAttr,
      seenAttr: targetDex.seenAttr,
      ivs: [...targetDex.ivs],
    };
    const preEvolution = pokemon.getSpeciesForm();
    await pokemon.evolve(evolution, preEvolution);

    expect(pokemon.species.speciesId).toBe(evolution!.speciesId);
    expect(pokemon.customPokemonData.erBlackShiny).toBe(true);
    expect(game.scene.gameData.starterData[targetRoot].erBlackShiny).toBe(false);
    expect(targetDex.caughtAttr).toBe(before.caughtAttr);
    expect(targetDex.seenAttr).toBe(before.seenAttr);
    expect(targetDex.ivs).toEqual(before.ivs);
  });

  it("still records account progression for an ordinary evolution", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);

    const pokemon = game.scene.getPlayerPokemon()!;
    const updateIvs = vi.spyOn(game.scene.gameData, "updateSpeciesDexIvs");
    const setSeen = vi.spyOn(game.scene.gameData, "setPokemonSeen");
    const setCaught = vi.spyOn(game.scene.gameData, "setPokemonCaught");

    await pokemon.evolve(pokemonEvolutions[SpeciesId.BULBASAUR][0], pokemon.getSpeciesForm());

    expect(updateIvs).toHaveBeenCalledOnce();
    expect(setSeen).toHaveBeenCalledOnce();
    expect(setCaught).toHaveBeenCalledOnce();
  });
});
