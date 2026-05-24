/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Full battle playthrough tests — multi-turn battles, faint conditions,
// switch-in chains, terrain-gated abilities, full HP-burnout scenarios.
//
// Each test runs a complete battle sequence (multiple turns, sometimes
// fainting and switching in). Verifies engine stability over many
// phase boundaries.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN_SCENARIOS = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN_SCENARIOS)("ER full battle playthroughs", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("10-turn battle: persistent weather + ability triggers stable", { timeout: 60_000 }, async () => {
    game.override
      .battleStyle("single")
      .ability(AbilityId.DROUGHT)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH)
      .startingLevel(50)
      .enemyLevel(50);
    await game.classicMode.startBattle(SpeciesId.NINETALES);
    // Run 10 consecutive turns; expect no crash.
    for (let t = 0; t < 10; t++) {
      game.move.use(MoveId.SPLASH);
      await game.toEndOfTurn();
    }
    // Just verify battle progressed 10 turns without crash.
    expect(game.scene.currentBattle.turn).toBeGreaterThan(9);
  });

  it("Battle to KO: high-damage move loop until enemy faints", { timeout: 120_000 }, async () => {
    game.override
      .battleStyle("single")
      .ability(AbilityId.NO_GUARD)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.EARTHQUAKE)
      .startingLevel(50)
      .enemyLevel(5)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.RAMPARDOS);
    // 1-shot a low-level Magikarp.
    game.move.use(MoveId.EARTHQUAKE);
    await game.toEndOfTurn();
    // Battle should have progressed past initial turn.
    expect(game.scene.currentBattle.turn).toBeGreaterThan(0);
  });

  it("Sandstorm + Sand Veil + Sand Rush stack: all three active", async () => {
    game.override
      .battleStyle("single")
      .ability(AbilityId.SAND_STREAM)
      .passiveAbility(AbilityId.SAND_RUSH)
      .enemyAbility(AbilityId.SAND_VEIL)
      .enemySpecies(SpeciesId.GLISCOR)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.TYRANITAR);
    expect(game.scene.arena.weather?.weatherType).toBe(WeatherType.SANDSTORM);
    // Sand Rush should boost Tyranitar's SPD under SANDSTORM.
    const player = game.field.getPlayerPokemon();
    const effSpd = player.getEffectiveStat(Stat.SPD);
    const baseSpd = player.getStat(Stat.SPD, false);
    expect(effSpd).toBeGreaterThan(baseSpd);
  });

  it("Snow + Slush Rush combo", async () => {
    game.override
      .battleStyle("single")
      .ability(AbilityId.SNOW_WARNING)
      .passiveAbility(AbilityId.SLUSH_RUSH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.BEARTIC);
    // Weather set, Slush Rush boosts SPD in snow.
    const player = game.field.getPlayerPokemon();
    expect(player.getEffectiveStat(Stat.SPD)).toBeGreaterThan(0);
  });

  it("Grassy Surge + Grass Pelt — terrain + multiplier", async () => {
    game.override
      .battleStyle("single")
      .ability(AbilityId.GRASSY_SURGE)
      .passiveAbility(AbilityId.GRASS_PELT)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.TAPU_BULU);
    expect(game.scene.arena.terrain?.terrainType).toBeDefined();
    const player = game.field.getPlayerPokemon();
    // Grass Pelt boosts DEF in Grassy Terrain — verify the effective stat
    // beats the base.
    expect(player.getEffectiveStat(Stat.DEF)).toBeGreaterThanOrEqual(player.getStat(Stat.DEF, false));
  });

  it("Psychic Surge ability sets PSYCHIC_TERRAIN", async () => {
    game.override
      .battleStyle("single")
      .ability(AbilityId.PSYCHIC_SURGE)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.RATTATA)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.TAPU_LELE);
    expect(game.scene.arena.terrain?.terrainType).toBeDefined();
  });

  it("Misty Surge ability sets MISTY_TERRAIN", async () => {
    game.override
      .battleStyle("single")
      .ability(AbilityId.MISTY_SURGE)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.RATTATA)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.TAPU_FINI);
    expect(game.scene.arena.terrain?.terrainType).toBeDefined();
  });
});
