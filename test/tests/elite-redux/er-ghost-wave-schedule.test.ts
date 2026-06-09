/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression (#363/#364) — ghost gauntlet visibility:
//  - Elite/Hell now have MID-RUN ghost waves (not just the 176+/192+ finale),
//    none of which collide with rivals / bosses / gyms / E4 / champion;
//  - Ace stays ghost-free (#345);
//  - a ghost trainer displays the SOURCE PLAYER's account name.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { ghostWavesForCurrentRun, markTrainerAsGhost } from "#data/elite-redux/er-ghost-teams";
import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import type { Trainer } from "#field/trainer";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const RIVAL_WAVES = new Set([8, 16, 25, 42, 55, 76, 95, 122, 145, 195]);
const FIXED_LATE = new Set([182, 184, 186, 188, 190, 200]);

describe.skipIf(!RUN)("ER ghost wave schedule + ghost trainer naming (#363/#364)", () => {
  let phaserGame: Phaser.Game;
  // biome-ignore lint/correctness/noUnusedVariables: side-effectful full init
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
  });
  afterEach(() => {
    setErDifficulty("ace");
  });

  it("Elite and Hell have mid-run ghost waves; Ace has none", () => {
    setErDifficulty("elite");
    const elite = ghostWavesForCurrentRun();
    expect(elite.some(w => w < 150)).toBe(true);
    setErDifficulty("hell");
    const hell = ghostWavesForCurrentRun();
    expect(hell.some(w => w < 100)).toBe(true);
    setErDifficulty("ace");
    expect(ghostWavesForCurrentRun()).toHaveLength(0);
  });

  it("no ghost wave collides with rivals / bosses / x1 / gyms / late fixed battles", () => {
    for (const difficulty of ["elite", "hell"] as const) {
      setErDifficulty(difficulty);
      for (const w of ghostWavesForCurrentRun()) {
        expect(w % 10, `${difficulty} wave ${w} is a boss wave`).not.toBe(0);
        expect(w % 10, `${difficulty} wave ${w} is an x1 wave`).not.toBe(1);
        expect(w % 30, `${difficulty} wave ${w} is a gym wave`).not.toBe(20);
        expect(RIVAL_WAVES.has(w), `${difficulty} wave ${w} is a rival wave`).toBe(false);
        expect(FIXED_LATE.has(w), `${difficulty} wave ${w} is a fixed late battle`).toBe(false);
      }
    }
  });

  it("markTrainerAsGhost shows the source player's account name (and skips anonymous fallbacks)", () => {
    const stub = () => ({ name: "Randy", getPartyTemplate: () => null }) as unknown as Trainer;
    const named = stub();
    markTrainerAsGhost(named, {
      id: "x",
      trainerName: "CoolPlayer42",
      difficulty: "hell",
      waveReached: 200,
      isVictory: true,
      timestamp: 1,
      party: [{} as never],
    });
    expect(named.name).toBe("CoolPlayer42");

    const anon = stub();
    markTrainerAsGhost(anon, {
      id: "y",
      trainerName: "Trainer",
      difficulty: "hell",
      waveReached: 200,
      isVictory: true,
      timestamp: 1,
      party: [{} as never],
    });
    expect(anon.name).toBe("Randy");
  });
});
