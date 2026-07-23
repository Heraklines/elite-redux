/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import {
  resetErCustomTrainerTracking,
  setErCustomTrainerDevForce,
  setErCustomTrainersForTesting,
} from "#data/elite-redux/er-custom-trainers";
import { resetErDifficulty, setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { AbilityId } from "#enums/ability-id";
import { Challenges } from "#enums/challenges";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("custom trainer preserves resolved battle formats", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    setErCustomTrainersForTesting({
      SPARSE_FORMAT_REGRESSION: {
        id: 70998,
        name: "Sparse Format",
        trainerClass: "SCHOOL_KID",
        battleType: "single",
        difficulties: ["youngster"],
        minWave: 2,
        maxWave: 2,
        team: [{ species: SpeciesId.MAGIKARP, moves: [MoveId.SPLASH] }],
      },
      AUTHORED_DOUBLE_REGRESSION: {
        id: 70999,
        name: "Authored Double",
        trainerClass: "SCHOOL_KID",
        battleType: "double",
        difficulties: ["youngster"],
        minWave: 2,
        maxWave: 2,
        team: [
          { species: SpeciesId.MAGIKARP, moves: [MoveId.SPLASH] },
          { species: SpeciesId.FEEBAS, moves: [MoveId.SPLASH] },
        ],
      },
    } as never);
    setErDifficulty("youngster");
    game.override
      .startingWave(1)
      .disableTrainerWaves()
      .startingLevel(50)
      .enemyLevel(5)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.DAZZLING_GLEAM]);
  });

  afterEach(() => {
    setErCustomTrainerDevForce(null);
    setErCustomTrainersForTesting(undefined);
    resetErCustomTrainerTracking();
    resetErDifficulty();
  });

  it("does not collapse a one-member custom trainer to 1v1 in Doubles Only", async () => {
    game.challengeMode.addChallenge(Challenges.DOUBLES_ONLY, 1, 0);
    await game.challengeMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU);
    setErCustomTrainerDevForce("SPARSE_FORMAT_REGRESSION");
    globalScene.getEnemyField().forEach(pokemon => {
      pokemon.hp = 1;
    });
    game.move.select(MoveId.DAZZLING_GLEAM, 0);
    game.move.select(MoveId.DAZZLING_GLEAM, 1);
    await game.toNextWave();

    expect(globalScene.currentBattle.waveIndex).toBe(2);
    expect(globalScene.currentBattle.trainer?.erCustomTrainerName).toBe("Sparse Format");
    expect(globalScene.currentBattle.arrangement.playerCapacity).toBe(2);
    expect(globalScene.currentBattle.arrangement.enemyCapacity).toBe(2);
    expect(globalScene.getPlayerField().filter(pokemon => pokemon.isOnField())).toHaveLength(2);
    expect(globalScene.getEnemyField().filter(pokemon => pokemon.isOnField())).toHaveLength(2);
  });

  it("does not collapse a one-member custom trainer to 1v1 in Triples Only", async () => {
    game.challengeMode.addChallenge(Challenges.TRIPLES_ONLY, 1, 0);
    await game.challengeMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE);
    setErCustomTrainerDevForce("SPARSE_FORMAT_REGRESSION");
    globalScene.getEnemyField().forEach(pokemon => {
      pokemon.hp = 1;
    });
    game.move.select(MoveId.DAZZLING_GLEAM, 0);
    game.move.select(MoveId.DAZZLING_GLEAM, 1);
    game.move.select(MoveId.DAZZLING_GLEAM, 2);
    await game.toNextWave();

    expect(globalScene.currentBattle.waveIndex).toBe(2);
    expect(globalScene.currentBattle.trainer?.erCustomTrainerName).toBe("Sparse Format");
    expect(globalScene.currentBattle.arrangement.playerCapacity).toBe(3);
    expect(globalScene.currentBattle.arrangement.enemyCapacity).toBe(3);
    expect(globalScene.getPlayerField().filter(pokemon => pokemon.isOnField())).toHaveLength(3);
    expect(globalScene.getEnemyField().filter(pokemon => pokemon.isOnField())).toHaveLength(3);
  });

  it("does not collapse an already-resolved dev double battle to 1v1", async () => {
    game.override.battleStyle("double");
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU);
    setErCustomTrainerDevForce("SPARSE_FORMAT_REGRESSION");
    globalScene.getEnemyField().forEach(pokemon => {
      pokemon.hp = 1;
    });
    game.move.select(MoveId.DAZZLING_GLEAM, 0);
    game.move.select(MoveId.DAZZLING_GLEAM, 1);
    await game.toNextWave();

    expect(globalScene.currentBattle.waveIndex).toBe(2);
    expect(globalScene.currentBattle.trainer?.erCustomTrainerName).toBe("Sparse Format");
    expect(globalScene.currentBattle.arrangement.playerCapacity).toBe(2);
    expect(globalScene.currentBattle.arrangement.enemyCapacity).toBe(2);
    expect(globalScene.getPlayerField().filter(pokemon => pokemon.isOnField())).toHaveLength(2);
    expect(globalScene.getEnemyField().filter(pokemon => pokemon.isOnField())).toHaveLength(2);
  });

  it("does not collapse an already-resolved dev triple battle to 1v1", async () => {
    game.override.battleStyle("triple");
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE);
    setErCustomTrainerDevForce("SPARSE_FORMAT_REGRESSION");
    globalScene.getEnemyField().forEach(pokemon => {
      pokemon.hp = 1;
    });
    game.move.select(MoveId.DAZZLING_GLEAM, 0);
    game.move.select(MoveId.DAZZLING_GLEAM, 1);
    game.move.select(MoveId.DAZZLING_GLEAM, 2);
    await game.toNextWave();

    expect(globalScene.currentBattle.waveIndex).toBe(2);
    expect(globalScene.currentBattle.trainer?.erCustomTrainerName).toBe("Sparse Format");
    expect(globalScene.currentBattle.arrangement.playerCapacity).toBe(3);
    expect(globalScene.currentBattle.arrangement.enemyCapacity).toBe(3);
    expect(globalScene.getPlayerField().filter(pokemon => pokemon.isOnField())).toHaveLength(3);
    expect(globalScene.getEnemyField().filter(pokemon => pokemon.isOnField())).toHaveLength(3);
  });

  it("still lets authored trainer metadata upgrade a single battle to doubles", async () => {
    game.override.battleStyle("single");
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU);
    setErCustomTrainerDevForce("AUTHORED_DOUBLE_REGRESSION");
    globalScene.getEnemyField().forEach(pokemon => {
      pokemon.hp = 1;
    });
    game.move.select(MoveId.DAZZLING_GLEAM);
    await game.toNextWave();

    expect(globalScene.currentBattle.waveIndex).toBe(2);
    expect(globalScene.currentBattle.trainer?.erCustomTrainerName).toBe("Authored Double");
    expect(globalScene.currentBattle.arrangement.playerCapacity).toBe(2);
    expect(globalScene.currentBattle.arrangement.enemyCapacity).toBe(2);
    expect(globalScene.getPlayerField().filter(pokemon => pokemon.isOnField())).toHaveLength(2);
    expect(globalScene.getEnemyField().filter(pokemon => pokemon.isOnField())).toHaveLength(2);
  });
});
