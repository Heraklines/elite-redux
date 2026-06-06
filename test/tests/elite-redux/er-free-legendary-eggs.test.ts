/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// One-time gift: every player receives 2 free Legendary eggs exactly once.
// The grant is guarded by a persisted flag (freeLegendaryEggsGranted) so it
// never re-triggers. Gated behind ER_SCENARIO=1.

import { EggTier } from "#enums/egg-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER one-time free Legendary eggs", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    // Start from the "never granted" state.
    game.scene.gameData.freeLegendaryEggsGranted = false;
    game.scene.gameData.eggs = [];
  });

  it("grants exactly 2 Legendary eggs and sets the flag", () => {
    const gd = game.scene.gameData;
    gd.grantFreeLegendaryEggsOnce();
    expect(gd.eggs.length).toBe(2);
    expect(gd.eggs.every(e => e.tier === EggTier.LEGENDARY)).toBe(true);
    expect(gd.freeLegendaryEggsGranted).toBe(true);
  });

  it("never re-triggers (idempotent across repeated calls)", () => {
    const gd = game.scene.gameData;
    gd.grantFreeLegendaryEggsOnce();
    gd.grantFreeLegendaryEggsOnce();
    gd.grantFreeLegendaryEggsOnce();
    expect(gd.eggs.length).toBe(2); // still just the original 2
  });

  it("does not grant when the flag is already set (e.g. loaded save)", () => {
    const gd = game.scene.gameData;
    gd.freeLegendaryEggsGranted = true; // simulate a save that already received it
    gd.grantFreeLegendaryEggsOnce();
    expect(gd.eggs.length).toBe(0);
  });

  it("persists the flag in the system save data", () => {
    const gd = game.scene.gameData;
    gd.grantFreeLegendaryEggsOnce();
    expect(gd.getSystemSaveData().freeLegendaryEggsGranted).toBe(true);
  });
});
