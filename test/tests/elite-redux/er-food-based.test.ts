/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { MovePowerBoostAbAttr, ReceivedMoveDamageMultiplierAbAttr } from "#abilities/ab-attrs";
import { speciesEggTiers } from "#balance/species-egg-tiers";
import { allAbilities, allSpecies } from "#data/data-lists";
import { Egg } from "#data/egg";
import {
  ER_SUGAR_RUSH_ABILITY_ID,
  ER_UPCYCLE_ABILITY_ID,
  isErFoodPokemon,
} from "#data/elite-redux/abilities/food-based";
import { EggTier } from "#enums/egg-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Food tag and Fidough abilities", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    game = new GameManager(phaserGame);
  });

  const spawn = (speciesId: SpeciesId, formKey?: string) => {
    const species = getPokemonSpecies(speciesId);
    const formIndex = formKey === undefined ? undefined : species.forms.findIndex(form => form.formKey === formKey);
    return game.scene.addPlayerPokemon(species, 50, 0, formIndex);
  };

  const spawnCustom = (name: string) => {
    const species = allSpecies.find(candidate => candidate.name === name);
    expect(species, `${name} is registered`).toBeDefined();
    return game.scene.addPlayerPokemon(species!, 50);
  };

  it("tags full Food families while respecting explicit exclusions", () => {
    expect(isErFoodPokemon(spawn(SpeciesId.VANILLUXE))).toBe(true);
    expect(isErFoodPokemon(spawn(SpeciesId.BLAZIKEN))).toBe(true);
    expect(isErFoodPokemon(spawn(SpeciesId.CHERRIM))).toBe(false);
    expect(isErFoodPokemon(spawn(SpeciesId.TOGEKISS))).toBe(false);
    expect(isErFoodPokemon(spawnCustom("Amphybuzz"))).toBe(true);
    expect(isErFoodPokemon(spawnCustom("Cormoth"))).toBe(true);
    expect(isErFoodPokemon(spawnCustom("Mamoswine Redux"))).toBe(true);
    expect(isErFoodPokemon(spawnCustom("Tsareena Redux"))).toBe(false);
  });

  it("replaces old Sugar Rush and registers Upcycle", () => {
    const sugarRush = allAbilities[ER_SUGAR_RUSH_ABILITY_ID];
    const upcycle = allAbilities[ER_UPCYCLE_ABILITY_ID];
    expect(sugarRush.description).toContain("1.5x");
    expect(upcycle.name).toBe("Upcycle");
    const powerAttrs = sugarRush.attrs.filter(attr => attr instanceof MovePowerBoostAbAttr);
    expect(powerAttrs.map(attr => attr.getPowerMultiplier())).toEqual([1.5, 2]);
    expect(sugarRush.attrs.filter(attr => attr instanceof ReceivedMoveDamageMultiplierAbAttr)).toHaveLength(1);
  });

  it("hatches Partner Fidough and keeps the approved Alpha forms in Legendary eggs", () => {
    const fidough = new Egg({ scene: game.scene, species: SpeciesId.FIDOUGH }).generatePlayerPokemon();
    expect(fidough.getFormKey()).toBe("partner");
    expect(fidough.getSpeciesForm().isStarterSelectable).toBe(true);

    for (const name of ["Burmy Eterna", "Calyrex Cloud Rider"]) {
      const species = allSpecies.find(candidate => candidate.name === name);
      expect(species, `${name} is registered`).toBeDefined();
      expect(speciesEggTiers[species!.speciesId]).toBe(EggTier.LEGENDARY);
    }
  });
});
