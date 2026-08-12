import { getGameMode } from "#app/game-mode";
import { getFunModeConfig, resetFunModeConfig, setFunModeConfig } from "#data/elite-redux/er-fun-mode";
import { resetMoodyEnemyBoonLoadout, setMoodyEnemyBoonLoadout } from "#data/elite-redux/moody/moody-enemy";
import { queryMoodySceneEffects } from "#data/elite-redux/moody/moody-scene-adapter";
import {
  createMoodyModeState,
  getMoodyModeSaveData,
  resetMoodyModeState,
  restoreMoodyModeState,
} from "#data/elite-redux/moody/moody-state";
import { AbilityId } from "#enums/ability-id";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Moody real-engine release harness", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .moveset([MoveId.TACKLE, MoveId.SPLASH])
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset([MoveId.TACKLE, MoveId.SPLASH])
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .startingLevel(50)
      .enemyLevel(50);
  });

  afterEach(() => {
    resetMoodyEnemyBoonLoadout();
    resetMoodyModeState();
    resetFunModeConfig();
  });

  it("executes player and enemy ownership against live battlers and survives the session wire format", async () => {
    await game.classicMode.startBattle(SpeciesId.CHARIZARD);
    game.scene.gameMode = getGameMode(GameModes.FUN);
    setFunModeConfig({
      ...getFunModeConfig(),
      randomizePokemon: false,
      randomizeTypes: false,
      randomizeAbilities: false,
      randomizeLevelUpMoves: false,
      moodyMode: true,
    });

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const state = createMoodyModeState("real-engine-release");
    state.acquisitionRolls = 1;
    state.boons = [
      {
        instanceId: "player:crowned-vanguard",
        boonId: "crowned-vanguard",
        rank: 1,
        target: { pokemonIds: [player.id], partySlots: [0] },
        acquiredAtWave: 10,
      },
    ];
    expect(restoreMoodyModeState(state)).toBe(true);
    setMoodyEnemyBoonLoadout({
      waveIndex: game.scene.currentBattle.waveIndex,
      boons: [
        {
          instanceId: "enemy:crowned-vanguard",
          boonId: "crowned-vanguard",
          rank: 1,
          target: { pokemonIds: [enemy.id], partySlots: [0] },
          acquiredAtWave: 10,
        },
      ],
    });

    const playerEffects = queryMoodySceneEffects({
      actor: player,
      target: enemy,
      move: player.getMoveset()[0].getMove(),
      flags: { firstDamagingMove: true },
    });
    const enemyEffects = queryMoodySceneEffects({
      actor: enemy,
      target: player,
      move: enemy.getMoveset()[0].getMove(),
      flags: { firstDamagingMove: true },
    });

    expect(playerEffects?.priorityDelta).toBe(1);
    expect(playerEffects?.applications).toContainEqual(
      expect.objectContaining({ effectId: "crowned-vanguard", output: "priorityDelta", value: 1 }),
    );
    expect(enemyEffects?.priorityDelta).toBe(1);
    expect(enemyEffects?.applications).toContainEqual(
      expect.objectContaining({ effectId: "crowned-vanguard", output: "priorityDelta", value: 1 }),
    );

    const serialized = JSON.stringify(game.scene.gameData.getSessionSaveData());
    const parsed = game.scene.gameData.parseSessionData(serialized);
    expect(parsed.funModeConfig?.moodyMode).toBe(true);
    expect(parsed.moodyModeState).toEqual(getMoodyModeSaveData());
  });
});
