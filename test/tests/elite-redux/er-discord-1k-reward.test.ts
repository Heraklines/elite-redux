/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { DexAttr } from "#enums/dex-attr";
import { notificationManager } from "#system/notifications/notification-manager";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const TIER_2 = DexAttr.SHINY | DexAttr.VARIANT_2;

describe.skipIf(!RUN)("Discord 1k one-time tier-2 shiny", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.scene.gameData.discord1kT2ShinySpeciesId = null;
    notificationManager.clear();
  });

  afterEach(() => vi.restoreAllMocks());

  it("grants and persists exactly one tier-2 shiny", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const gd = game.scene.gameData;
    const speciesId = gd.grantDiscord1kT2ShinyOnce();

    expect(speciesId).not.toBeNull();
    expect(gd.dexData[speciesId!].caughtAttr & TIER_2).toBe(TIER_2);
    expect(gd.grantDiscord1kT2ShinyOnce()).toBe(speciesId);
    expect(gd.getSystemSaveData().discord1kT2ShinySpeciesId).toBe(speciesId);

    const notification = notificationManager.list().find(n => n.id === "reward:discord-1k-t2-shiny");
    expect(notification?.data).toMatchObject({
      body: expect.stringContaining("Discord reached 1k, thanks for playing this silly game. Enjoy your free stuff"),
      payload: { species: speciesId, shiny: true, variant: 1, miniIcon: true },
    });
  });

  it("filters an already-owned tier-2 shiny out of the random pool", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const gd = game.scene.gameData;
    const first = gd.grantDiscord1kT2ShinyOnce();
    expect(first).not.toBeNull();

    gd.discord1kT2ShinySpeciesId = null;
    const second = gd.grantDiscord1kT2ShinyOnce();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });

  it("immediately saves an existing account's newly granted reward", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const gd = game.scene.gameData;
    const systemData = JSON.stringify(gd.getSystemSaveData(), (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    const saveSpy = vi.spyOn(gd, "saveSystem").mockResolvedValue(true);

    await expect(gd.initSystem(systemData)).resolves.toBe(true);
    expect(gd.discord1kT2ShinySpeciesId).not.toBeNull();
    expect(saveSpy).toHaveBeenCalledOnce();
    expect(saveSpy).toHaveBeenCalledWith(true);
  });
});
