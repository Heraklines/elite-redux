import { resetErRunPacing, setErRunPacing } from "#data/elite-redux/er-run-pacing";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { SpeciesId } from "#enums/species-id";
import { removeQueuedPostVictoryCombatPhases } from "#phases/post-victory-queue-cleanup";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

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

  afterEach(() => {
    resetErRunPacing();
  });

  it("drops stale action phases while preserving settlement and wave transition phases", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const queue = game.scene.phaseManager;
    const pokemon = game.scene.getPlayerField()[0];
    queue.pushNew("MovePhase", pokemon, [], pokemon.moveset[0], MoveUseMode.NORMAL);
    queue.pushNew("TurnInitPhase");
    queue.pushNew("MoveEndPhase", pokemon.getBattlerIndex(), []);
    queue.pushNew("WeatherEffectPhase");
    queue.pushNew("TurnEndPhase");
    queue.pushNew("NewBattlePhase");

    expect(queue.hasPhaseOfType("MovePhase")).toBe(true);
    expect(queue.getQueuedPhaseNames()).toEqual(
      expect.arrayContaining(["TurnInitPhase", "MoveEndPhase", "WeatherEffectPhase", "TurnEndPhase", "NewBattlePhase"]),
    );

    removeQueuedPostVictoryCombatPhases();

    expect(queue.hasPhaseOfType("MovePhase")).toBe(false);
    expect(queue.getQueuedPhaseNames()).not.toContain("TurnInitPhase");
    expect(queue.getQueuedPhaseNames()).toContain("MoveEndPhase");
    expect(queue.getQueuedPhaseNames()).toContain("WeatherEffectPhase");
    expect(queue.getQueuedPhaseNames()).toContain("TurnEndPhase");
    expect(queue.getQueuedPhaseNames()).toContain("NewBattlePhase");
  });

  it("schedules one wave-clear tail when a spread move KOs both foes", async () => {
    game.override
      .battleStyle("double")
      .startingWave(2)
      .startingLevel(100)
      .enemyLevel(1)
      .enemySpecies(SpeciesId.MAGIKARP)
      .moveset([MoveId.SURF, MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.KYOGRE, SpeciesId.FEEBAS);

    game.move.select(MoveId.SURF, BattlerIndex.PLAYER);
    game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
    await game.phaseInterceptor.to("SelectModifierPhase");

    const queued = game.scene.phaseManager.getQueuedPhaseNames();
    expect(queued.filter(name => name === "SelectModifierPhase")).toHaveLength(0);
    expect(queued.filter(name => name === "NewBattlePhase")).toHaveLength(1);
  });

  it("heals a Sprint checkpoint even when the biome does not end there", async () => {
    setErRunPacing("sprint");
    game.override.startingWave(30).startingLevel(100).enemyLevel(1).moveset([MoveId.SURF]);
    await game.classicMode.startBattle(SpeciesId.KYOGRE);

    game.move.select(MoveId.SURF);
    await game.phaseInterceptor.to("SelectModifierPhase");

    expect(game.phaseInterceptor.log).toContain("PartyHealPhase");
  });
});
