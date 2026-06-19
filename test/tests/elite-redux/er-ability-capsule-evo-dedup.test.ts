/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #445 - Ability Capsule sets a persistent ACTIVE-ability override
// (customPokemonData.ability). If evolution then introduces that exact ability
// as an INNATE of the evolved form, the override duplicates an innate (wasting
// the active slot - reported as a capsule'd Earthbound Dugtrio keeping Earthbound
// even though the evolved form has it as an innate). evolve() now drops the
// redundant override (active re-derives to a distinct ability) and re-arms the
// single-use capsule so the player can re-pick. A non-duplicating override is
// preserved. ER_SCENARIO=1.
// =============================================================================

import { pokemonEvolutions } from "#balance/pokemon-evolutions";
import { allAbilities } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Ability Capsule dedup on evolution (#445)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .startingLevel(40);
  });

  it("drops a capsule override that becomes a duplicate innate on evolution", async () => {
    await game.classicMode.runToSummon(SpeciesId.BULBASAUR);
    const bulba = game.field.getPlayerPokemon();
    // Simulate the capsule having set the active ability to something the
    // EVOLVED form (Ivysaur) carries as an innate.
    const ivyInnates = getPokemonSpecies(SpeciesId.IVYSAUR)
      .getPassiveAbilities()
      .filter(a => a !== AbilityId.NONE);
    expect(ivyInnates.length).toBeGreaterThan(0);
    const dupAbility = ivyInnates[0];
    bulba.customPokemonData.ability = dupAbility;

    await bulba.evolve(pokemonEvolutions[SpeciesId.BULBASAUR][0], bulba.species);

    expect(bulba.species.speciesId).toBe(SpeciesId.IVYSAUR);
    expect(bulba.customPokemonData.ability).toBe(-1); // redundant override dropped
  });

  it("keeps a capsule override that does NOT duplicate an innate", async () => {
    await game.classicMode.runToSummon(SpeciesId.BULBASAUR);
    const bulba = game.field.getPlayerPokemon();
    const ivyInnates = new Set<number>(getPokemonSpecies(SpeciesId.IVYSAUR).getPassiveAbilities());
    const nonDup = allAbilities.find(a => a && a.id !== AbilityId.NONE && !ivyInnates.has(a.id));
    expect(nonDup).toBeTruthy();
    bulba.customPokemonData.ability = nonDup!.id;

    await bulba.evolve(pokemonEvolutions[SpeciesId.BULBASAUR][0], bulba.species);

    expect(bulba.customPokemonData.ability).toBe(nonDup!.id); // preserved
  });
});
