import { GachaType } from "#enums/gacha-types";
import { EggLapsePhase } from "#phases/egg-lapse-phase";
import { VoucherType } from "#system/voucher";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("EggLapsePhase auto-restock", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    game = new GameManager(phaserGame);
  });

  beforeEach(async () => {
    await game.importData("./test/utils/saves/everything.prsv");
    // Wipe any pre-existing eggs from the imported save so test arithmetic is predictable.
    game.scene.gameData.eggs = [];
  });

  it("does nothing when auto-restock is disabled", () => {
    game.scene.gameData.autoEggRestock.enabled = false;
    game.scene.gameData.voucherCounts[VoucherType.REGULAR] = 100;
    const phase = new EggLapsePhase();
    // biome-ignore lint/suspicious/noExplicitAny: testing private method
    (phase as any).autoRestockIfEnabled();
    expect(game.scene.gameData.eggs.length).toBe(0);
    expect(game.scene.gameData.voucherCounts[VoucherType.REGULAR]).toBe(100);
  });

  it("refills the egg queue and consumes vouchers when enabled", () => {
    game.scene.gameData.autoEggRestock = {
      enabled: true,
      targetCount: 10,
      gachaType: GachaType.LEGENDARY,
      perVoucher: {
        [VoucherType.REGULAR]: true,
        [VoucherType.PLUS]: false,
        [VoucherType.PREMIUM]: false,
        [VoucherType.GOLDEN]: false,
      },
    };
    game.scene.gameData.voucherCounts[VoucherType.REGULAR] = 100;

    const phase = new EggLapsePhase();
    // biome-ignore lint/suspicious/noExplicitAny: testing private method
    (phase as any).autoRestockIfEnabled();

    expect(game.scene.gameData.eggs.length).toBe(10);
    expect(game.scene.gameData.voucherCounts[VoucherType.REGULAR]).toBe(90);
  });

  it("does not exceed the target", () => {
    game.scene.gameData.autoEggRestock = {
      enabled: true,
      targetCount: 5,
      gachaType: GachaType.LEGENDARY,
      perVoucher: {
        [VoucherType.REGULAR]: true,
        [VoucherType.PLUS]: false,
        [VoucherType.PREMIUM]: false,
        [VoucherType.GOLDEN]: false,
      },
    };
    game.scene.gameData.voucherCounts[VoucherType.REGULAR] = 100;
    // Already at target; phase should be a no-op.
    for (let i = 0; i < 5; i++) {
      // biome-ignore lint/suspicious/noExplicitAny: shortcut for stub eggs
      game.scene.gameData.eggs.push({ id: i, hatchWaves: 99 } as any);
    }

    const phase = new EggLapsePhase();
    // biome-ignore lint/suspicious/noExplicitAny: testing private method
    (phase as any).autoRestockIfEnabled();

    expect(game.scene.gameData.eggs.length).toBe(5);
    expect(game.scene.gameData.voucherCounts[VoucherType.REGULAR]).toBe(100);
  });
});
