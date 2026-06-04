/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Taekkyeon — "all attacks are dances": the holder's non-status moves count as
// dance moves, so they trigger an opposing Dancer.
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("ER Ability - Taekkyeon", () => {
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
      .ability(ErAbilityId.TAEKKYEON as unknown as AbilityId)
      .enemyAbility(AbilityId.DANCER)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE]);
  });
  test("the holder's Tackle triggers the opponent's Dancer", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    const playerHpBefore = player.hp;
    game.move.select(MoveId.TACKLE);
    await game.phaseInterceptor.to("BerryPhase");
    // Dancer copies the (now-dance) Tackle back onto the player → player takes damage.
    expect(player.hp).toBeLessThan(playerHpBefore);
  });
});
