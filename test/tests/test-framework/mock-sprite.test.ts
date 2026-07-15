import type { BattleScene } from "#app/battle-scene";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("MockSprite", () => {
  let phaserGame: Phaser.Game;
  let scene: BattleScene;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  beforeEach(() => {
    scene = new GameManager(phaserGame).scene;
  });

  it("preserves the atlas frame used by battle-stat labels", () => {
    const sprite = scene.add
      .sprite(0, 0, "pbinfo_stat", "SPD")
      .setName("icon_stat_label_5");

    expect(sprite.name).toBe("icon_stat_label_5");
    expect(sprite.frame.name).toBe("SPD");

    sprite.setFrame("ATK");
    expect(sprite.frame.name).toBe("ATK");
  });
});
