/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Parroting — copies SOUND-based moves used by other battlers (generalized
// Dancer). Verifies it copies a sound move and ignores a non-sound move.

import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("ER Ability - Parroting", () => {
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
      .enemyLevel(20)
      .ability(ErAbilityId.PARROTING as unknown as AbilityId)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .moveset([MoveId.SPLASH]);
  });

  test("copies an enemy's sound move (Hyper Voice), damaging the enemy", async () => {
    game.override.enemyMoveset(MoveId.HYPER_VOICE);
    await game.classicMode.startBattle(SpeciesId.CHATOT);
    const enemy = game.field.getEnemyPokemon();
    const enemyHpBefore = enemy.hp;

    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("BerryPhase");

    // Enemy's Hyper Voice doesn't hurt itself; any enemy HP loss is Parroting's
    // copied Hyper Voice striking back.
    expect(enemy.hp).toBeLessThan(enemyHpBefore);
  });

  test("does NOT copy a non-sound move (Tackle)", async () => {
    game.override.enemyMoveset(MoveId.TACKLE);
    await game.classicMode.startBattle(SpeciesId.CHATOT);
    const enemy = game.field.getEnemyPokemon();
    const enemyHpBefore = enemy.hp;

    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("BerryPhase");

    expect(enemy.hp).toBe(enemyHpBefore);
  });
});
