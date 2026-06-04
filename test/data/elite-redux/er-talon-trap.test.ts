/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Talon Trap — 50% trap on contact (offense/defense), 100% if entered this turn.
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("ER Ability - Talon Trap", () => {
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
      .ability(ErAbilityId.TALON_TRAP as unknown as AbilityId)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE]);
  });
  test("a contact move on the first turn guarantees (100%) trapping the foe", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.field.getEnemyPokemon();
    game.move.select(MoveId.TACKLE);
    await game.phaseInterceptor.to("BerryPhase");
    expect(enemy.getTag(BattlerTagType.TRAPPED)).toBeDefined();
  });
});
