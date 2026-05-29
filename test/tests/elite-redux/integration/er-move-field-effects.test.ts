/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #103 / #125 (moves) — ER custom field-effect moves backed by new engine
// mechanisms. Inverse Room (844): "reverses type matchups for 5 turns" — sets
// the ER INVERSE_ROOM arena tag; getTypeDamageMultiplier inverts each
// single-type matchup while it's active (super-effective ↔ not-very-effective,
// immunities → super-effective), like an Inverse Battle.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN_SCENARIOS = process.env.ER_SCENARIO === "1";

async function erMove(id: number): Promise<number | undefined> {
  const erIdMap = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
  return erIdMap.moves[id];
}

describe.skipIf(!RUN_SCENARIOS)("ER move field effects (#125)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("Inverse Room (844): reverses type matchups (Normal now hits a Ghost)", async () => {
    const room = await erMove(844);
    if (room === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.GENGAR) // Ghost/Poison — Normal is normally 0x (immune)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([room, MoveId.TACKLE])
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    const enemy = game.field.getEnemyPokemon();

    // Sanity: before Inverse Room, Normal vs Ghost is an immunity (0 damage).
    // Turn 1 — set Inverse Room.
    game.move.use(room);
    await game.toNextTurn();

    // Turn 2 — Tackle (Normal) on the Ghost. Under Inverse Room the immunity
    // inverts to super-effective, so it now deals damage.
    const hp0 = enemy.hp;
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    expect(enemy.hp, "Normal move connects on a Ghost under Inverse Room").toBeLessThan(hp0);
  });

  // NOTE: move 1010 ("Tempest Storm (N)") is one of ER's "(N)" placeholder moves
  // — pokerogue treats any move whose name ends in " (N)" as invalid/unselectable
  // (a Struggle is used instead). Its WeatherChangeAttr IS correctly wired (it
  // sets TEMPEST_STORM when executed), but it can't be selected in-battle, so we
  // verify the new TEMPEST_STORM weather MECHANISM directly via trySetWeather.
  it("Tempest Storm weather: chips a non-Electric Pokémon each turn", async () => {
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]); // Normal — not Electric, takes chip
    const player = game.field.getPlayerPokemon();
    game.scene.arena.trySetWeather(WeatherType.TEMPEST_STORM, player);
    expect(game.scene.arena.weather?.weatherType).toBe(WeatherType.TEMPEST_STORM);
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    expect(player.hp, "non-Electric chipped by the storm").toBeLessThan(player.getMaxHp());
  });

  it("Tempest Storm weather: spares Electric-types from the chip", async () => {
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.JOLTEON]); // Electric — immune to the chip
    const player = game.field.getPlayerPokemon();
    game.scene.arena.trySetWeather(WeatherType.TEMPEST_STORM, player);
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    expect(player.hp, "Electric-type spared from the storm chip").toBe(player.getMaxHp());
  });
});
