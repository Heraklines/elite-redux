/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { getGameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import { speciesEggMoves } from "#balance/moves/egg-moves";
import { pokemonSpeciesLevelMoves } from "#balance/pokemon-level-moves";
import { speciesTmMoves } from "#balance/tms";
import { FreshStartChallenge } from "#data/challenge";
import { allSpecies } from "#data/data-lists";
import { erBalanceNum } from "#data/elite-redux/er-balance-tuning";
import { ER_BLACK_SHINY_LUCK, isErBlackShiny } from "#data/elite-redux/er-black-shinies";
import { ER_LILLIGANT_VERDANT_SPECIES_ID } from "#data/elite-redux/er-fakemon-pitch-species";
import { ER_WEBBED_BRUISER_SPECIES_ID } from "#data/elite-redux/er-newcomer-species";
import { resolveErSpeciesConstId } from "#data/elite-redux/er-type-nativization";
import { pokemonFormChanges } from "#data/pokemon-forms";
import { Button } from "#enums/buttons";
import { DexAttr } from "#enums/dex-attr";
import { GameModes } from "#enums/game-modes";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import type { StarterAttributes } from "#types/save-data";
import { PokedexPageUiHandler } from "#ui/pokedex-page-ui-handler";
import type { PokedexUiHandler } from "#ui/pokedex-ui-handler";
import type { StarterSelectUiHandler } from "#ui/starter-select-ui-handler";
import { speciesFormTypes } from "#ui/type-icon-strip";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("reported player UI regressions", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  afterAll(() => {
    phaserGame.destroy(true);
  });

  function markCaught(speciesId: number): void {
    const dexEntry = game.scene.gameData.dexData[speciesId];
    dexEntry.caughtAttr = DexAttr.NON_SHINY | DexAttr.MALE | DexAttr.DEFAULT_VARIANT | DexAttr.DEFAULT_FORM;
    dexEntry.seenAttr = dexEntry.caughtAttr;
    game.scene.gameData.starterData[speciesId].abilityAttr = 1;
  }

  it("Webbed Bruiser inherits complete Ariados-family move data", () => {
    const levelMoves = (pokemonSpeciesLevelMoves as Record<number, [number, number][]>)[ER_WEBBED_BRUISER_SPECIES_ID];
    const ariadosLevelMoves = pokemonSpeciesLevelMoves[SpeciesId.ARIADOS];
    const eggMoves = (speciesEggMoves as Record<number, number[]>)[ER_WEBBED_BRUISER_SPECIES_ID];
    const tmMoves = (speciesTmMoves as Record<number, unknown[]>)[ER_WEBBED_BRUISER_SPECIES_ID];

    expect(levelMoves).toEqual(ariadosLevelMoves);
    expect(levelMoves.length).toBeGreaterThan(0);
    expect(eggMoves).toEqual(speciesEggMoves[SpeciesId.SPINARAK]);
    expect(eggMoves).toHaveLength(4);
    expect(tmMoves.length).toBeGreaterThan(0);
  });

  it("opens Webbed Bruiser's real Level Moves menu without trapping input", async () => {
    await game.runToTitle();
    markCaught(ER_WEBBED_BRUISER_SPECIES_ID);
    const species = allSpecies.find(s => (s.speciesId as number) === ER_WEBBED_BRUISER_SPECIES_ID);
    expect(species).toBeDefined();

    await game.scene.ui.setOverlayMode(UiMode.POKEDEX_PAGE, species!, {});
    const handler = game.scene.ui.getHandler() as PokedexPageUiHandler;
    expect(handler).toBeInstanceOf(PokedexPageUiHandler);

    const internals = handler as unknown as {
      levelMoves: [number, number][];
      blockInput: boolean;
      moveInfoOverlay: { show(value: unknown): void; clear(): void };
    };
    vi.spyOn(internals.moveInfoOverlay, "show").mockImplementation(() => {});
    vi.spyOn(internals.moveInfoOverlay, "clear").mockImplementation(() => {});
    const optionSpy = vi.spyOn(globalScene.ui, "setModeWithoutClear");

    handler.setCursor(2); // BASE_STATS, ABILITIES, LEVEL_MOVES
    expect(handler.processInput(Button.ACTION)).toBe(true);
    await vi.waitFor(() => {
      expect(optionSpy.mock.calls.some(call => call[0] === UiMode.OPTION_SELECT)).toBe(true);
    });

    expect(internals.levelMoves.length).toBeGreaterThan(0);
    expect(internals.blockInput).toBe(false);
  });

  it("lists Verdant Lilligant in the Pokédex with its Water/Fairy/Ghost typing", async () => {
    await game.runToTitle();
    await game.scene.ui.setOverlayMode(UiMode.POKEDEX);
    const handler = game.scene.ui.getHandler() as PokedexUiHandler;
    const entries = (handler as unknown as { filteredPokemonData: { species: { speciesId: number } }[] })
      .filteredPokemonData;
    expect(entries.some(entry => entry.species.speciesId === ER_LILLIGANT_VERDANT_SPECIES_ID)).toBe(true);

    const species = getPokemonSpecies(ER_LILLIGANT_VERDANT_SPECIES_ID as SpeciesId);
    expect(speciesFormTypes(species)).toEqual([PokemonType.WATER, PokemonType.FAIRY, PokemonType.GHOST]);
    expect(species.forms.some(form => form.formKey === "mega")).toBe(true);
    expect(pokemonFormChanges[ER_LILLIGANT_VERDANT_SPECIES_ID]?.some(change => change.formKey === "mega")).toBe(true);
  });

  it("opens Webbed Bruiser's real Egg Moves menu with all four moves", async () => {
    await game.runToTitle();
    markCaught(ER_WEBBED_BRUISER_SPECIES_ID);
    const species = allSpecies.find(s => (s.speciesId as number) === ER_WEBBED_BRUISER_SPECIES_ID);
    expect(species).toBeDefined();

    await game.scene.ui.setOverlayMode(UiMode.POKEDEX_PAGE, species!, {});
    const handler = game.scene.ui.getHandler() as PokedexPageUiHandler;
    const internals = handler as unknown as {
      eggMoves: number[];
      blockInput: boolean;
      moveInfoOverlay: { show(value: unknown): void; clear(): void };
    };
    vi.spyOn(internals.moveInfoOverlay, "show").mockImplementation(() => {});
    vi.spyOn(internals.moveInfoOverlay, "clear").mockImplementation(() => {});
    const optionSpy = vi.spyOn(globalScene.ui, "setModeWithoutClear");

    handler.setCursor(3); // EGG_MOVES
    expect(handler.processInput(Button.ACTION)).toBe(true);
    await vi.waitFor(() => {
      expect(optionSpy.mock.calls.some(call => call[0] === UiMode.OPTION_SELECT)).toBe(true);
    });

    expect(internals.eggMoves).toHaveLength(4);
    expect(internals.blockInput).toBe(false);
  });

  it("opens starter select when the editor configures more than five Pokerus starters", async () => {
    await game.runToTitle();
    const handler = game.scene.ui.handlers[UiMode.STARTER_SELECT] as StarterSelectUiHandler;
    const internals = handler as unknown as {
      pokerusCursorObjs: Phaser.GameObjects.Image[];
      pokerusSpecies: unknown[];
    };
    const configuredCount = erBalanceNum("vanilla.pokerusCount");

    expect(configuredCount).toBeGreaterThan(5);
    expect(() => handler.show([() => {}])).not.toThrow();
    expect(internals.pokerusSpecies).toHaveLength(configuredCount);
    expect(internals.pokerusCursorObjs).toHaveLength(configuredCount);
  });

  it("cycles Larvesta Redux through its native Ghost third type", async () => {
    await game.runToTitle();
    const larvestaId = resolveErSpeciesConstId("SPECIES_LARVESTA_REDUX");
    expect(larvestaId).toBeDefined();
    markCaught(larvestaId!);
    const species = getPokemonSpecies(larvestaId! as SpeciesId);

    const handler = game.scene.ui.handlers[UiMode.STARTER_SELECT] as StarterSelectUiHandler;
    expect(handler.show([() => {}])).toBe(true);
    const internals = handler as unknown as {
      allowTera: boolean;
      canCycleTera: boolean;
      teraCursor: PokemonType;
      starterPreferences: Record<number, StarterAttributes>;
      originalStarterPreferences: Record<number, StarterAttributes>;
    };
    internals.allowTera = true;
    internals.starterPreferences[larvestaId!] = { tera: species.type1 };
    internals.originalStarterPreferences[larvestaId!] = { tera: species.type1 };
    handler.setSpecies(species);

    const restored = handler.initStarterPrefs(species, { [larvestaId!]: { tera: PokemonType.GHOST } }, true);
    expect(restored.tera).toBe(PokemonType.GHOST);

    expect(internals.canCycleTera).toBe(true);
    const cycled: PokemonType[] = [];
    for (let i = 0; i < 3; i++) {
      expect(handler.processInput(Button.CYCLE_TERA)).toBe(true);
      cycled.push(internals.teraCursor);
    }
    expect(cycled).toContain(PokemonType.GHOST);
    expect(internals.starterPreferences[larvestaId!].tera).toBe(species.type1);
  });

  it("keeps a selected Black Shiny black after Fresh Start modifies starters", async () => {
    await game.runToTitle();
    game.scene.gameMode = getGameMode(GameModes.CHALLENGE);
    const freshStart = new FreshStartChallenge();
    freshStart.value = 1;
    game.scene.gameMode.challenges = [freshStart];

    const starters = generateStarters(game.scene, [SpeciesId.BULBASAUR]);
    starters[0].shiny = true;
    starters[0].variant = 2;
    starters[0].erBlackShiny = true;

    game.scene.phaseManager.pushNew("EncounterPhase", false);
    new SelectStarterPhase().initBattleFromCurrentPhase(starters);
    await game.phaseInterceptor.to("EncounterPhase");

    const pokemon = game.scene.getPlayerParty()[0];
    expect(isErBlackShiny(pokemon)).toBe(true);
    expect(pokemon.shiny).toBe(true);
    expect(pokemon.variant).toBe(2);
    expect(pokemon.luck).toBe(ER_BLACK_SHINY_LUCK);
    expect(pokemon.getSpriteKey()).toMatch(/-erblack$/);
    expect(pokemon.getBattleSpriteKey(true)).toMatch(/-erblack$/);
  });
});
