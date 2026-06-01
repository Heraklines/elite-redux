/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Swamp Thing (Grass+Water pledge / swamp) and Deep Fried (Fire+Grass pledge /
// sea of fire) drop a pledge field tag on the FOES' side of the field on entry.
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("ER Ability - pledge-on-entry (Swamp Thing / Deep Fried)", () => {
  let pg: Phaser.Game;
  let game: GameManager;
  beforeAll(() => {
    pg = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(pg);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH])
      .enemyAbility(AbilityId.BALL_FETCH);
  });

  test("Deep Fried sets the sea-of-fire (FIRE_GRASS_PLEDGE) on the enemy side", async () => {
    game.override.ability(ErAbilityId.DEEP_FRIED as unknown as AbilityId);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    expect(game.scene.arena.getTagOnSide(ArenaTagType.FIRE_GRASS_PLEDGE, ArenaTagSide.ENEMY)).toBeDefined();
    // Not on the holder's own side.
    expect(game.scene.arena.getTagOnSide(ArenaTagType.FIRE_GRASS_PLEDGE, ArenaTagSide.PLAYER)).toBeUndefined();
  });

  test("Swamp Thing sets the swamp (GRASS_WATER_PLEDGE) on the enemy side", async () => {
    game.override.ability(ErAbilityId.SWAMP_THING as unknown as AbilityId);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    expect(game.scene.arena.getTagOnSide(ArenaTagType.GRASS_WATER_PLEDGE, ArenaTagSide.ENEMY)).toBeDefined();
  });

  test("no pledge tag without the ability", async () => {
    game.override.ability(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    expect(game.scene.arena.getTagOnSide(ArenaTagType.FIRE_GRASS_PLEDGE, ArenaTagSide.ENEMY)).toBeUndefined();
    expect(game.scene.arena.getTagOnSide(ArenaTagType.GRASS_WATER_PLEDGE, ArenaTagSide.ENEMY)).toBeUndefined();
  });
});
