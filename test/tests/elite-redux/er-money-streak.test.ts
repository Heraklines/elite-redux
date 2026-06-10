/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression (#348) — money streak system:
//  +1% wave money per party mon per 3 consecutive FAINT-FREE waves, capped at
//  +10% per mon (+60% for a full team). A faint resets that mon's streak.
//  Streaks persist via the session save and scale getWaveMoneyAmount.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { globalScene } from "#app/global-scene";
import {
  advanceErMoneyStreaks,
  erStreakBonusPercent,
  erTeamMoneyBonusPercent,
  getErMoneyStreakEntries,
  recordErStreakFaint,
  resetErMoneyStreaks,
  restoreErMoneyStreaks,
} from "#data/elite-redux/er-money-streak";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER money streak (#348)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.GYARADOS);
    resetErMoneyStreaks();
  });

  it("+1% per mon per 3 faint-free waves, capped at +10% per mon", () => {
    const [a, b] = globalScene.getPlayerParty();
    expect(erTeamMoneyBonusPercent()).toBe(0);

    for (let i = 0; i < 3; i++) {
      advanceErMoneyStreaks();
    }
    expect(erStreakBonusPercent(a.id)).toBe(1);
    expect(erStreakBonusPercent(b.id)).toBe(1);
    expect(erTeamMoneyBonusPercent()).toBe(2);

    for (let i = 0; i < 60; i++) {
      advanceErMoneyStreaks();
    }
    expect(erStreakBonusPercent(a.id)).toBe(10); // capped
    expect(erTeamMoneyBonusPercent()).toBe(20);
  });

  it("a faint resets that mon's streak (the wave it fainted in stays broken)", () => {
    const [a, b] = globalScene.getPlayerParty();
    for (let i = 0; i < 9; i++) {
      advanceErMoneyStreaks();
    }
    expect(erStreakBonusPercent(a.id)).toBe(3);

    recordErStreakFaint(a);
    advanceErMoneyStreaks(); // the faint wave: a stays 0, b advances
    expect(erStreakBonusPercent(a.id)).toBe(0);
    expect(erStreakBonusPercent(b.id)).toBe(3); // 10 waves
  });

  it("wave money scales with the team bonus", () => {
    resetErMoneyStreaks();
    const base = globalScene.getWaveMoneyAmount(1);
    for (let i = 0; i < 60; i++) {
      advanceErMoneyStreaks();
    }
    const boosted = globalScene.getWaveMoneyAmount(1);
    expect(erTeamMoneyBonusPercent()).toBe(20);
    expect(boosted).toBeGreaterThan(base);
    // ~+20%, allowing for the floor-to-10 rounding.
    expect(boosted).toBeGreaterThanOrEqual(Math.floor((base * 1.2) / 10) * 10 - 10);
  });

  it("streak entries round-trip through the session-save channel", () => {
    const [a] = globalScene.getPlayerParty();
    for (let i = 0; i < 12; i++) {
      advanceErMoneyStreaks();
    }
    const saved = getErMoneyStreakEntries();
    resetErMoneyStreaks();
    expect(erStreakBonusPercent(a.id)).toBe(0);
    restoreErMoneyStreaks(saved);
    expect(erStreakBonusPercent(a.id)).toBe(4);
  });
});
