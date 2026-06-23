/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// REPRO #607: player reports an evolved Accelgor keeps a pre-evolution ability
// (Shelmet's Damp). ER data: Shelmet abilities [6=Damp, 143, 29], innates
// [75, 68, 142]; Accelgor abilities [372, 84, 809], innates [68, 288, 168].
//
// On evolution PokeRogue keeps abilityIndex and re-derives the ACTIVE ability
// from the NEW species, so a Shelmet at index 0 (Damp) should become Accelgor's
// index-0 ability (372), NOT Damp. This test forces Damp active on Shelmet, then
// evolves and inspects the active ability + innates to see whether anything
// Shelmet-specific leaks through.
//
// Run: ER_SCENARIO=1 npx vitest run test/tools/repro-accelgor-evo-ability.test.ts

import { pokemonEvolutions } from "#balance/pokemon-evolutions";
import { AbilityId } from "#enums/ability-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const DAMP = AbilityId.DAMP; // 6

describe.skipIf(!RUN)("repro: Accelgor keeps pre-evo ability (#607)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("Shelmet (Damp, index 0) -> Accelgor must re-derive the active ability (not Damp)", async () => {
    const game = new GameManager(phaserGame);
    game.override.battleStyle("single").enemySpecies(SpeciesId.MAGIKARP).startingLevel(40);
    await game.classicMode.runToSummon(SpeciesId.SHELMET);

    const mon = game.field.getPlayerPokemon();
    mon.abilityIndex = 0; // force Damp active (Shelmet ER slot 0)
    const preActive = mon.getAbility();
    const preInnates = mon
      .getPassiveAbilities()
      .map(a => a?.id)
      .filter((id): id is number => id != null && id !== AbilityId.NONE);
    console.log(
      `Shelmet: active=${preActive.id} "${preActive.name}" (abilityIndex=${mon.abilityIndex}) innates=[${preInnates.join(", ")}]`,
    );
    expect(preActive.id, "Shelmet slot 0 is Damp").toBe(DAMP);

    await mon.evolve(pokemonEvolutions[SpeciesId.SHELMET][0], mon.species);

    const postActive = mon.getAbility();
    const postInnates = mon
      .getPassiveAbilities()
      .map(a => a?.id)
      .filter((id): id is number => id != null && id !== AbilityId.NONE);
    console.log(
      `Accelgor: species=${mon.species.speciesId} active=${postActive.id} "${postActive.name}" (abilityIndex=${mon.abilityIndex}) innates=[${postInnates.join(", ")}] customAbility=${mon.customPokemonData.ability}`,
    );

    expect(mon.species.speciesId, "evolved to Accelgor").toBe(SpeciesId.ACCELGOR);
    expect(postActive.id, "active ability must NOT still be Damp after evolution").not.toBe(DAMP);
    // Shelmet-only innates (75 Battle Armor, 142 not in Accelgor's set) must not persist.
    expect(postInnates, "Shelmet-only innate 75 must not persist").not.toContain(75);
    expect(postInnates, "Shelmet-only innate 142 must not persist").not.toContain(142);
  }, 120_000);

  it("a capsule-pinned pre-evo-only ability (Damp) must not persist onto Accelgor", async () => {
    const game = new GameManager(phaserGame);
    game.override.battleStyle("single").enemySpecies(SpeciesId.MAGIKARP).startingLevel(40);
    await game.classicMode.runToSummon(SpeciesId.SHELMET);

    const mon = game.field.getPlayerPokemon();
    // Simulate an Ability Capsule pinning the active ability to Damp (one of
    // Shelmet's own abilities). Accelgor has no Damp in its ability OR innate set.
    mon.customPokemonData.ability = DAMP;
    expect(mon.getAbility().id, "capsule pinned Damp").toBe(DAMP);

    await mon.evolve(pokemonEvolutions[SpeciesId.SHELMET][0], mon.species);

    const accelgorAbilities = mon.species.getAbilityCount();
    const validIds = [0, 1, 2].slice(0, accelgorAbilities).map(i => mon.species.getAbility(i));
    const postActive = mon.getAbility();
    console.log(
      `Accelgor (capsule sim): active=${postActive.id} "${postActive.name}" customAbility=${mon.customPokemonData.ability} validAbilityIds=[${validIds.join(", ")}]`,
    );
    expect(mon.species.speciesId).toBe(SpeciesId.ACCELGOR);
    expect(postActive.id, "Accelgor must NOT keep capsule'd Damp (not an Accelgor ability)").not.toBe(DAMP);
  }, 120_000);
});
