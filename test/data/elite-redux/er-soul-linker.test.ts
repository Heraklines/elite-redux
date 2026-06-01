/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Soul Linker — the attacker takes back the exact damage it deals to the holder.

import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("ER Ability - Soul Linker", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(100)
      .ability(ErAbilityId.SOUL_LINKER as unknown as AbilityId)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.TACKLE)
      .moveset([MoveId.SPLASH]);
  });

  test("attacker takes back the damage it deals to the holder", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const enemyHpBefore = enemy.hp;

    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("TurnEndPhase");

    const dealtToPlayer = player.getMaxHp() - player.hp;
    const reflectedToEnemy = enemyHpBefore - enemy.hp;
    expect(dealtToPlayer).toBeGreaterThan(0);
    expect(reflectedToEnemy).toBe(dealtToPlayer);
  });
});
