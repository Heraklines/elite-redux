/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Battle Aura — while a holder is on the field, EVERY battler gets +2 crit stage.
import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("ER Ability - Battle Aura", () => {
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
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE])
      .enemyAbility(AbilityId.BALL_FETCH);
  });
  test("grants +2 crit stage to both the holder and the opponent", async () => {
    game.override.ability(ErAbilityId.BATTLE_AURA as unknown as AbilityId);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const tackle = allMoves[MoveId.TACKLE];
    // player attacking enemy: enemy.getCritStage(player) includes field +2
    expect(enemy.getCritStage(player, tackle)).toBeGreaterThanOrEqual(2);
    // enemy attacking player: also +2
    expect(player.getCritStage(enemy, tackle)).toBeGreaterThanOrEqual(2);
  });
  test("no bonus without Battle Aura on field", async () => {
    game.override.ability(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    expect(enemy.getCritStage(player, allMoves[MoveId.TACKLE])).toBe(0);
  });
});
