import { defaultDirectorState } from "#system/llm-director/director-state";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("LLM Director state save round-trip", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    game = new GameManager(phaserGame);
  });

  beforeEach(async () => {
    await game.importData("./test/utils/saves/everything.prsv");
  });

  it("starts with default director state (alignment 0, empty bible)", () => {
    expect(game.scene.gameData.llmDirectorState.alignment).toBe(0);
    expect(game.scene.gameData.llmDirectorState.beatHistory).toEqual([]);
    expect(game.scene.gameData.llmDirectorState.factionRep).toEqual({});
    expect(game.scene.gameData.llmDirectorState.lossRiskBudget.target).toBeGreaterThan(0);
  });

  it("persists director state through getSystemSaveData/initParsedSystem", () => {
    game.scene.gameData.llmDirectorState.alignment = 42;
    game.scene.gameData.llmDirectorState.factionRep.rebels = 12;
    game.scene.gameData.llmDirectorState.flags.trustedMariner = true;

    const saved = game.scene.gameData.getSystemSaveData();
    const savedDirector = JSON.parse(JSON.stringify(saved.llmDirectorState));

    // Mutate live to ensure load path is what restores values.
    game.scene.gameData.llmDirectorState = defaultDirectorState();

    // biome-ignore lint/suspicious/noExplicitAny: testing private save-init path
    (game.scene.gameData as any).initParsedSystem({ ...saved, llmDirectorState: savedDirector });

    expect(game.scene.gameData.llmDirectorState.alignment).toBe(42);
    expect(game.scene.gameData.llmDirectorState.factionRep.rebels).toBe(12);
    expect(game.scene.gameData.llmDirectorState.flags.trustedMariner).toBe(true);
  });

  it("loads pre-feature save with defaults (no llmDirectorState key)", () => {
    const saved = game.scene.gameData.getSystemSaveData();
    // biome-ignore lint/suspicious/noExplicitAny: simulating older save without the new field
    delete (saved as any).llmDirectorState;
    // biome-ignore lint/suspicious/noExplicitAny: testing private save-init path
    (game.scene.gameData as any).initParsedSystem(saved);
    expect(game.scene.gameData.llmDirectorState.alignment).toBe(0);
    expect(game.scene.gameData.llmDirectorState.beatHistory).toEqual([]);
  });
});
