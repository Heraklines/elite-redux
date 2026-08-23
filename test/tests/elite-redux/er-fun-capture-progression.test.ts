/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Fun Mode capture account progression", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

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
});
