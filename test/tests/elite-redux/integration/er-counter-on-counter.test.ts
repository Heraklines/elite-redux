/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// A normal hit may trigger one automatic counter, but that INDIRECT counter
// must never trigger the defender's own counter ability. The old behavior made
// Deflect and Wind Chimes bounce attacks forever and freeze the battle.

import type { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER counter-on-counter recursion", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("Deflect's indirect Vacuum Wave does not trigger Wind Chimes", { timeout: 10_000 }, async () => {
    game.override
      .battleStyle("single")
      .ability(ErAbilityId.DEFLECT as unknown as AbilityId)
      .enemyAbility(ErAbilityId.WIND_CHIMES as unknown as AbilityId)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.TACKLE)
      .moveset(MoveId.SPLASH)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.LUCARIO);

    const enemy = game.field.getEnemyPokemon();
    const enemyHpBefore = enemy.hp;

    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();

    expect(enemy.hp, "Deflect still fired its one Vacuum Wave counter").toBeLessThan(enemyHpBefore);
    expect(game.field.getPlayerPokemon().isFainted(), "the counter chain terminated").toBe(false);
  });
});
