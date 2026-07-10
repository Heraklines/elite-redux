/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER "Eerie Fog" weather (#328). Covered here: each turn, non-Ghost/non-Psychic
// mons lose one stage off every POSITIVE stat boost (decays to +0) while
// Ghost/Psychic are immune; and Ominous Wind deals 2× power in fog. (Other
// effects — 20% dmg reduction for Ghost/Psychic, halved recovery, Ghost-type
// Curse, and the removed accuracy penalty — are wired/tested elsewhere.)
// =============================================================================

import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("ER Eerie Fog — per-turn stat-buff decay", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .weather(WeatherType.FOG)
      .criticalHits(false)
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.RATTATA)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH);
  });

  it("a non-Ghost/Psychic mon loses one positive stage/turn (debuffs survive)", async () => {
    await game.classicMode.startBattle(SpeciesId.MIGHTYENA); // Dark
    const player = game.field.getPlayerPokemon();
    player.setStatStage(Stat.ATK, 2);
    player.setStatStage(Stat.SPD, 1);
    player.setStatStage(Stat.DEF, -1); // a debuff — fog must NOT touch it

    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("TurnEndPhase");

    expect(player.getStatStage(Stat.ATK)).toBe(1);
    expect(player.getStatStage(Stat.SPD)).toBe(0);
    expect(player.getStatStage(Stat.DEF)).toBe(-1);
  });

  it("a Ghost/Psychic mon keeps its buffs in fog", async () => {
    await game.classicMode.startBattle(SpeciesId.GASTLY); // Ghost/Poison
    const player = game.field.getPlayerPokemon();
    player.setStatStage(Stat.ATK, 2);

    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("TurnEndPhase");

    expect(player.getStatStage(Stat.ATK)).toBe(2);
  });

  it("Ominous Wind deals double power in fog", async () => {
    const ominousWind = allMoves[MoveId.OMINOUS_WIND];
    vi.spyOn(ominousWind, "calculateBattlePower");

    // Enemy must NOT be Normal/Dark (those are immune to Ghost), else no
    // damage calc runs and calculateBattlePower is never invoked.
    game.override.moveset(MoveId.OMINOUS_WIND).enemySpecies(SpeciesId.MAGIKARP);
    await game.classicMode.startBattle(SpeciesId.GASTLY);
    game.move.select(MoveId.OMINOUS_WIND);
    await game.phaseInterceptor.to("MoveEffectPhase");

    // Base power 55 -> doubled to 110 by Eerie Fog.
    expect(ominousWind.calculateBattlePower).toHaveReturnedWith(110);
  });

  it("Ominous Wind deals normal power without fog", async () => {
    const ominousWind = allMoves[MoveId.OMINOUS_WIND];
    vi.spyOn(ominousWind, "calculateBattlePower");

    game.override.weather(WeatherType.NONE).moveset(MoveId.OMINOUS_WIND).enemySpecies(SpeciesId.MAGIKARP);
    await game.classicMode.startBattle(SpeciesId.GASTLY);
    game.move.select(MoveId.OMINOUS_WIND);
    await game.phaseInterceptor.to("MoveEffectPhase");

    expect(ominousWind.calculateBattlePower).toHaveReturnedWith(55);
  });
});
