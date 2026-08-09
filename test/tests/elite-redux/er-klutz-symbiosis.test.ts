/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("Klutz and Symbiosis", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .enemyAbility(AbilityId.BALL_FETCH);
  });

  const giveItem = (pokemon: Pokemon, key: "LEFTOVERS" | "WIDE_LENS") => {
    const typeFunc = modifierTypes[key];
    const item = typeFunc().withIdFromFunc(typeFunc).newModifier(pokemon) as PokemonHeldItemModifier;
    game.scene.addModifier(item, true, false, false, true);
    return item;
  };

  it("Klutz suppresses its holder's normal item effects", async () => {
    game.override.ability(AbilityId.KLUTZ);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const holder = game.field.getPlayerPokemon();
    const leftovers = giveItem(holder, "LEFTOVERS");

    expect(leftovers.stackCount).toBe(1);
    expect(leftovers.shouldApply(holder)).toBe(false);
  });

  it("Symbiosis transfers one item to an adjacent ally after item loss", async () => {
    game.override.battleStyle("double").ability(AbilityId.SYMBIOSIS);
    await game.classicMode.startBattle(SpeciesId.FLORGES, SpeciesId.FLORGES);
    const [recipient, donor] = game.scene.getPlayerField();
    const spent = giveItem(recipient, "WIDE_LENS");
    const donated = giveItem(donor, "LEFTOVERS");

    recipient.loseHeldItem(spent);

    expect(recipient.getHeldItems().map(item => item.type.id)).toContain("LEFTOVERS");
    expect(donor.getHeldItems().map(item => item.type.id)).not.toContain("LEFTOVERS");
    expect(donated.stackCount).toBe(0);
  });
});
