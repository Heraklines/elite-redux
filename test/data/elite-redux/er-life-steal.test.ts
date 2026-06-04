/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Life Steal — drains 1/10 of each foe's max HP at turn end and heals the holder.
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("ER Ability - Life Steal", () => {
  let pg: Phaser.Game;
  let game: GameManager;
  beforeAll(() => {
    pg = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(pg);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(100)
      .ability(ErAbilityId.LIFE_STEAL as unknown as AbilityId)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH]);
  });
  test("drains the foe 1/10 max HP and heals the holder", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    player.hp = Math.floor(player.getMaxHp() / 2);
    const playerBefore = player.hp;
    const enemyBefore = enemy.hp;
    const expectedDrain = Math.max(Math.floor(enemy.getMaxHp() / 10), 1);
    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("PokemonHealPhase");
    expect(enemyBefore - enemy.hp).toBe(expectedDrain);
    expect(player.hp).toBeGreaterThan(playerBefore);
  });
});
