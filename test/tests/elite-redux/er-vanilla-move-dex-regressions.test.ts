/*
 * Regression tests for ER vanilla move rows where stale C-source/vanilla data
 * contradicted the ER 2.65 dex.
 *
 * Run: ER_SCENARIO=1 npx vitest run test/tests/elite-redux/er-vanilla-move-dex-regressions.test.ts
 */

import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER vanilla move dex regressions", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .criticalHits(false);
  });

  it("Horn Drill is a regular damaging move even when the user is lower level", async () => {
    game.override
      .battleStyle("single")
      .moveset(MoveId.HORN_DRILL)
      .startingLevel(50)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.WOBBUFFET);
    await game.classicMode.startBattle(SpeciesId.RHYDON);

    const enemy = game.field.getEnemyPokemon();
    game.move.select(MoveId.HORN_DRILL);
    await game.toEndOfTurn();

    expect(enemy.hp).toBeLessThan(enemy.getMaxHp());
    expect(enemy.isFainted()).toBe(false);
  });

  it("Dragon Breath burns at 100% per the ER dex", async () => {
    game.override
      .battleStyle("single")
      .moveset(MoveId.DRAGON_BREATH)
      .startingLevel(50)
      .enemyLevel(80)
      .enemySpecies(SpeciesId.WOBBUFFET);
    await game.classicMode.startBattle(SpeciesId.CHARIZARD);

    const enemy = game.field.getEnemyPokemon();
    game.move.select(MoveId.DRAGON_BREATH);
    await game.toEndOfTurn();

    expect(enemy.status?.effect).toBe(StatusEffect.BURN);
  });

  it("Confusion confuses at 100% per the ER dex", async () => {
    game.override
      .battleStyle("single")
      .moveset(MoveId.CONFUSION)
      .startingLevel(50)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.WOBBUFFET);
    await game.classicMode.startBattle(SpeciesId.ABRA);

    const enemy = game.field.getEnemyPokemon();
    game.move.select(MoveId.CONFUSION);
    await game.toEndOfTurn();

    expect(enemy.getTag(BattlerTagType.CONFUSED)).toBeDefined();
  });

  it("Ominous Wind hits both opposing Pokemon in doubles", async () => {
    game.override
      .battleStyle("double")
      .moveset([MoveId.OMINOUS_WIND, MoveId.SPLASH])
      .startingLevel(60)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.WOBBUFFET);
    await game.classicMode.startBattle(SpeciesId.GENGAR, SpeciesId.SNORLAX);

    const enemies = game.scene.getEnemyField();
    expect(enemies).toHaveLength(2);
    const [left, right] = enemies;

    game.move.select(MoveId.OMINOUS_WIND, BattlerIndex.PLAYER);
    game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
    await game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.PLAYER_2, BattlerIndex.ENEMY, BattlerIndex.ENEMY_2]);
    await game.toEndOfTurn();

    expect(left.hp).toBeLessThan(left.getMaxHp());
    expect(right.hp).toBeLessThan(right.getMaxHp());
  });
});
