import { GameManager } from "#test/framework/game-manager";
import { FunAbilityReviewUiHandler } from "#ui/handlers/fun-ability-review-ui-handler";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("UI - Fun ability review", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("moves focus to START after reroll and confirms the run", async () => {
    const onContinue = vi.fn();
    const handler = game.scene.ui.handlers.find(
      candidate => candidate instanceof FunAbilityReviewUiHandler,
    ) as FunAbilityReviewUiHandler;
    const state = handler as unknown as {
      cursor: number;
      onContinue: () => void;
      confirmSelection: () => boolean;
    };
    state.cursor = 6;
    state.onContinue = onContinue;
    vi.spyOn(game.scene.ui, "revertMode").mockResolvedValue(true);

    expect(handler.getCursor()).toBe(6);
    expect(state.confirmSelection()).toBe(true);
    expect(handler.getCursor()).toBe(7);

    expect(state.confirmSelection()).toBe(true);
    await vi.waitFor(() => expect(onContinue).toHaveBeenCalledOnce());
  });
});
