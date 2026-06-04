/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Desert Cloak — "Protects its side from status and secondary effects in sand."
// Driven via trySetStatus directly (the enemy move-id mapping is unstable under
// ER, so we exercise the status-application hook deterministically).
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("ER Ability - Desert Cloak", () => {
  let pg: Phaser.Game;
  let game: GameManager;
  beforeAll(() => {
    pg = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(pg);
    game.override.battleStyle("single").enemySpecies(SpeciesId.SNORLAX).enemyAbility(AbilityId.BALL_FETCH);
  });

  test("blocks status application while sand is active", async () => {
    game.override.ability(ErAbilityId.DESERT_CLOAK as unknown as AbilityId).weather(WeatherType.SANDSTORM);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    // Enemy tries to paralyze the player while sand is up.
    const applied = player.trySetStatus(StatusEffect.PARALYSIS, enemy);
    expect(applied).toBe(false);
    expect(player.status?.effect ?? undefined).toBeUndefined();
  });

  test("does NOT block status when there is no sand", async () => {
    game.override.ability(ErAbilityId.DESERT_CLOAK as unknown as AbilityId).weather(WeatherType.NONE);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const applied = player.trySetStatus(StatusEffect.PARALYSIS, enemy);
    expect(applied).toBe(true);
  });
});
