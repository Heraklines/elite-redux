/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Status } from "#data/status-effect";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Abilities - Unburden (Elite Redux replacement)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .ability(AbilityId.UNBURDEN)
      .moveset([MoveId.SPLASH, MoveId.CLOSE_COMBAT])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset([MoveId.SCARY_FACE, MoveId.SPLASH])
      .startingLevel(50)
      .enemyLevel(50);
  });

  it("provides a persistent 1.2x Speed boost without losing an item", async () => {
    await game.classicMode.startBattle(SpeciesId.TREECKO);
    const pokemon = game.field.getPlayerPokemon();

    expect(pokemon.getEffectiveStat(Stat.SPD)).toBe(Math.floor(pokemon.getStat(Stat.SPD) * 1.2));
  });

  it("blocks incoming and self-inflicted Speed stage drops", async () => {
    await game.classicMode.startBattle(SpeciesId.TREECKO);
    const pokemon = game.field.getPlayerPokemon();

    game.move.select(MoveId.SPLASH);
    await game.move.selectEnemyMove(MoveId.SCARY_FACE);
    await game.toNextTurn();
    expect(pokemon.getStatStage(Stat.SPD)).toBe(0);

    pokemon.setStatStage(Stat.SPD, -4);
    expect(pokemon.getEffectiveStat(Stat.SPD)).toBe(Math.floor(pokemon.getStat(Stat.SPD) * 1.2));
  });

  it("allows paralysis but ignores its Speed penalty", async () => {
    await game.classicMode.startBattle(SpeciesId.TREECKO);
    const pokemon = game.field.getPlayerPokemon();
    pokemon.status = new Status(StatusEffect.PARALYSIS);

    expect(pokemon.status?.effect).toBe(StatusEffect.PARALYSIS);
    expect(pokemon.getEffectiveStat(Stat.SPD)).toBe(Math.floor(pokemon.getStat(Stat.SPD) * 1.2));
  });

  it("stops applying while the ability is suppressed", async () => {
    game.override.enemyAbility(AbilityId.NEUTRALIZING_GAS);
    await game.classicMode.startBattle(SpeciesId.TREECKO);
    const pokemon = game.field.getPlayerPokemon();

    expect(pokemon.getEffectiveStat(Stat.SPD)).toBe(pokemon.getStat(Stat.SPD));
  });
});
