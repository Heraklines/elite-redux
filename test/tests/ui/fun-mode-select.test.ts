import {
  DEFAULT_FUN_MODE_CONFIG,
  type FunModeConfig,
  getFunModeConfig,
  resetFunModeConfig,
} from "#data/elite-redux/er-fun-mode";
import { Button } from "#enums/buttons";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import { FUN_MODE_OPTION_COUNT, type FunModeSelectUiHandler } from "#ui/handlers/fun-mode-select-ui-handler";
import { saveLastFunModeConfig } from "#utils/data";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("UI - Fun Mode select", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    resetFunModeConfig();
    if (game.scene.ui.getMode() === UiMode.FUN_MODE_SELECT) {
      game.scene.ui.getHandler().clear();
    }
    await game.scene.ui.setMode(UiMode.FUN_MODE_SELECT);
  });

  afterEach(() => {
    resetFunModeConfig();
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index);
      if (key?.startsWith("lastFunMode_")) {
        localStorage.removeItem(key);
      }
    }
  });

  it("shows a fresh configuration with every modifier disabled", () => {
    expect(getFunModeConfig()).toEqual(DEFAULT_FUN_MODE_CONFIG);
  });

  it("uses Enter to focus START without rotating the selected rule", () => {
    const handler = game.scene.ui.getHandler<FunModeSelectUiHandler>();
    const state = handler as unknown as { config: FunModeConfig; startRegionOption: number };
    const difficulty = state.config.difficulty;

    expect(handler.getCursor()).toBe(0);
    expect(handler.processInput(Button.SUBMIT)).toBe(true);
    expect(handler.getCursor()).toBe(FUN_MODE_OPTION_COUNT);
    expect(state.config.difficulty).toBe(difficulty);
    expect(state.startRegionOption).toBe(0);
  });

  it("still focuses literal START when a saved setup exists", () => {
    saveLastFunModeConfig({ ...DEFAULT_FUN_MODE_CONFIG, randomizePokemon: true });
    const handler = game.scene.ui.getHandler<FunModeSelectUiHandler>();
    const state = handler as unknown as { startRegionOption: number; startText: Phaser.GameObjects.Text };

    expect(handler.processInput(Button.SUBMIT)).toBe(true);
    expect(handler.getCursor()).toBe(FUN_MODE_OPTION_COUNT);
    expect(state.startRegionOption).toBe(0);
    expect(state.startText.text).toBe("START");
  });

  it("uses a compact caption when switching to Last Setup", () => {
    saveLastFunModeConfig({ ...DEFAULT_FUN_MODE_CONFIG, randomizePokemon: true });
    const handler = game.scene.ui.getHandler<FunModeSelectUiHandler>();
    const state = handler as unknown as { startRegionOption: number; startText: Phaser.GameObjects.Text };

    expect(handler.processInput(Button.SUBMIT)).toBe(true);
    expect(handler.processInput(Button.RIGHT)).toBe(true);
    expect(state.startRegionOption).toBe(1);
    expect(state.startText.text).toBe("LAST SETUP");
  });

  it("keeps the action button assigned to changing rules", () => {
    const handler = game.scene.ui.getHandler<FunModeSelectUiHandler>();
    const state = handler as unknown as { config: FunModeConfig };

    expect(handler.processInput(Button.ACTION)).toBe(true);
    expect(handler.getCursor()).toBe(0);
    expect(state.config.difficulty).toBe("hell");
    expect(handler.processInput(Button.SUBMIT)).toBe(true);
    expect(handler.getCursor()).toBe(FUN_MODE_OPTION_COUNT);
  });
});
