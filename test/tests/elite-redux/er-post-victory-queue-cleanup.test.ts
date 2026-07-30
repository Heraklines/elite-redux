import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { removeQueuedPostVictoryCombatPhases } from "#phases/victory-phase";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("post-victory combat queue cleanup", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  it("drops the stale turn tail while preserving the queued wave transition", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const queue = game.scene.phaseManager;
    queue.pushNew("TurnInitPhase");
    queue.pushNew("WeatherEffectPhase");
    queue.pushNew("NewBattlePhase");

    expect(queue.getQueuedPhaseNames()).toEqual(
      expect.arrayContaining(["TurnInitPhase", "WeatherEffectPhase", "NewBattlePhase"]),
    );

    removeQueuedPostVictoryCombatPhases();

    expect(queue.getQueuedPhaseNames()).not.toContain("TurnInitPhase");
    expect(queue.getQueuedPhaseNames()).not.toContain("WeatherEffectPhase");
    expect(queue.getQueuedPhaseNames()).toContain("NewBattlePhase");
  });
});
