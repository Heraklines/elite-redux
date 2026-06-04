import { VoucherType } from "#system/voucher";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("autoEggRestock save round-trip", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    game = new GameManager(phaserGame);
  });

  beforeEach(async () => {
    await game.importData("./test/utils/saves/everything.prsv");
  });

  it("starts with default settings", () => {
    expect(game.scene.gameData.autoEggRestock.enabled).toBe(false);
    expect(game.scene.gameData.autoEggRestock.targetCount).toBe(50);
  });

  it("persists changed settings through getSystemSaveData/initParsedSystem", () => {
    game.scene.gameData.autoEggRestock.enabled = true;
    game.scene.gameData.autoEggRestock.targetCount = 200;
    game.scene.gameData.autoEggRestock.perVoucher[VoucherType.GOLDEN] = true;

    // Snapshot a deep copy of the relevant slice to mimic real persistence (JSON disk round-trip).
    const saved = game.scene.gameData.getSystemSaveData();
    const savedAutoEggRestock = JSON.parse(JSON.stringify(saved.autoEggRestock));

    // Mutate the live object to ensure the load path is what restores values.
    game.scene.gameData.autoEggRestock.enabled = false;
    game.scene.gameData.autoEggRestock.targetCount = 50;
    game.scene.gameData.autoEggRestock.perVoucher[VoucherType.GOLDEN] = false;

    // Replay only the autoEggRestock slice through the load path.
    // biome-ignore lint/suspicious/noExplicitAny: testing private save-init path
    (game.scene.gameData as any).initParsedSystem({ ...saved, autoEggRestock: savedAutoEggRestock });

    expect(game.scene.gameData.autoEggRestock.enabled).toBe(true);
    expect(game.scene.gameData.autoEggRestock.targetCount).toBe(200);
    expect(game.scene.gameData.autoEggRestock.perVoucher[VoucherType.GOLDEN]).toBe(true);
  });

  it("loads pre-feature save with defaults", () => {
    const saved = game.scene.gameData.getSystemSaveData();
    // biome-ignore lint/suspicious/noExplicitAny: simulating an older save without the new field
    delete (saved as any).autoEggRestock;
    // biome-ignore lint/suspicious/noExplicitAny: testing private save-init path
    (game.scene.gameData as any).initParsedSystem(saved);
    expect(game.scene.gameData.autoEggRestock.enabled).toBe(false);
    expect(game.scene.gameData.autoEggRestock.targetCount).toBe(50);
  });
});
