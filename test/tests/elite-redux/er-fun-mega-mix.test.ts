/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { getGameMode } from "#app/game-mode";
import { getFunMegaMixEffects } from "#data/elite-redux/er-fun-mega-mode";
import {
  DEFAULT_FUN_MODE_CONFIG,
  getFunModeConfig,
  resetFunModeConfig,
  setFunModeConfig,
} from "#data/elite-redux/er-fun-mode";
import { FormChangeItem } from "#enums/form-change-item";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { PokemonFormChangeItemModifier } from "#modifiers/modifier";
import { FormChangeItemModifierType } from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("Fun Mode Full Mix pseudo-Megas", () => {
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

  test("adds one Mega type and replaces innate slots 1 and 3 only in Full Mix", async () => {
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    game.scene.gameMode = getGameMode(GameModes.FUN);
    setFunModeConfig({
      ...DEFAULT_FUN_MODE_CONFIG,
      randomizePokemon: false,
      randomizeTypes: false,
      randomizeAbilities: false,
      randomizeLevelUpMoves: false,
      megaMode: true,
      megaMixMode: true,
    });

    const pokemon = game.scene.getPlayerPokemon()!;
    const stone = FormChangeItem.SWAMPERTITE;
    const originalTypes = pokemon.getTypes();
    const originalInnates = pokemon
      .getPassiveAbilities()
      .slice(0, 3)
      .map(ability => ability?.id ?? null);
    const expected = getFunMegaMixEffects(stone, originalTypes)!;
    const type = new FormChangeItemModifierType(stone);
    type.id = "FORM_CHANGE_ITEM";
    game.scene.addModifier(new PokemonFormChangeItemModifier(type, pokemon.id, stone, true), true, false, false, true);

    expect(pokemon.isFunPseudoMega()).toBe(true);
    if (expected.addedType != null) {
      expect(pokemon.getTypes()).toContain(expected.addedType);
    }
    expect(pokemon.getPassiveAbilities()[0]?.id ?? null).toBe(expected.innate1);
    expect(pokemon.getPassiveAbilities()[2]?.id ?? null).toBe(expected.innate3);

    setFunModeConfig({ ...getFunModeConfig(), megaMixMode: false });
    expect(pokemon.getTypes()).toEqual(originalTypes);
    expect(
      pokemon
        .getPassiveAbilities()
        .slice(0, 3)
        .map(ability => ability?.id ?? null),
    ).toEqual(originalInnates);
  });

  test("can disable a pseudo-Mega stone and replace it with another stone", async () => {
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    game.scene.gameMode = getGameMode(GameModes.FUN);
    setFunModeConfig({
      ...DEFAULT_FUN_MODE_CONFIG,
      randomizePokemon: false,
      randomizeTypes: false,
      randomizeAbilities: false,
      randomizeLevelUpMoves: false,
      megaMode: true,
    });

    const pokemon = game.scene.getPlayerPokemon()!;
    const firstType = new FormChangeItemModifierType(FormChangeItem.SWAMPERTITE);
    firstType.id = "FORM_CHANGE_ITEM";
    const first = new PokemonFormChangeItemModifier(firstType, pokemon.id, FormChangeItem.SWAMPERTITE, true);
    expect(game.scene.addModifier(first, true, false, false, true)).toBe(true);
    expect(pokemon.getFunMegaStone()).toBe(FormChangeItem.SWAMPERTITE);

    first.active = false;
    expect(first.apply(pokemon, false)).toBe(true);
    expect(pokemon.getFunMegaStone()).toBeUndefined();
    expect(pokemon.isFunPseudoMega()).toBe(false);

    const secondType = new FormChangeItemModifierType(FormChangeItem.GYARADOSITE);
    secondType.id = "FORM_CHANGE_ITEM";
    const second = new PokemonFormChangeItemModifier(secondType, pokemon.id, FormChangeItem.GYARADOSITE, true);
    expect(game.scene.addModifier(second, true, false, false, true)).toBe(true);
    expect(pokemon.getFunMegaStone()).toBe(FormChangeItem.GYARADOSITE);
    expect(
      game.scene.getModifiers(PokemonFormChangeItemModifier).filter(modifier => modifier.pokemonId === pokemon.id),
    ).toEqual([second]);
  });
});
