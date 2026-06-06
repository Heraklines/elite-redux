/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Repro for "trainers repeat every run": the per-type ER pool is 1-2 trainers
// for common early types, so the run-seed selection window had nothing to
// rotate and two different runs fielded the SAME team at the same wave. The fix
// makes non-boss waves draw from the whole tier pool, so each run fields a
// different cast. Gated behind ER_SCENARIO=1.

import { globalScene } from "#app/global-scene";
import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import {
  clearErTrainerCacheForTests,
  getErTrainerForTrainer,
  resetErRunTrainerTracking,
} from "#data/elite-redux/er-trainer-runtime-hook";
import { TrainerType } from "#enums/trainer-type";
import type { Trainer } from "#field/trainer";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER trainer cross-run variety", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.classicMode.startBattle();
    setErDifficulty("hell");
  });

  /** Minimal Trainer stub — getErTrainerForTrainer only reads these fields. */
  function stubTrainer(type: TrainerType): Trainer {
    return {
      config: { trainerType: type, isBoss: false },
      getPartyTemplate: () => ({ size: 2 }),
    } as unknown as Trainer;
  }

  it("fields many DISTINCT trainers at the same wave across different run seeds", () => {
    globalScene.currentBattle.waveIndex = 5;
    const picks = new Set<string>();
    for (let i = 0; i < 30; i++) {
      resetErRunTrainerTracking(); // each iteration = a fresh run
      clearErTrainerCacheForTests();
      globalScene.seed = `cross-run-seed-${i}`;
      const choice = getErTrainerForTrainer(stubTrainer(TrainerType.YOUNGSTER));
      if (choice) {
        picks.add(choice.stableKey);
      }
    }
    // Before the fix this was ~1 (the lone "big enough" Youngster). Now it draws
    // from the whole tier pool, so the run-seed rotates a genuinely varied cast.
    expect(picks.size).toBeGreaterThan(5);
  });

  it("never repeats a trainer WITHIN a single run (consecutive waves differ)", () => {
    resetErRunTrainerTracking();
    clearErTrainerCacheForTests();
    globalScene.seed = "single-run-no-repeat";
    const keys: string[] = [];
    for (let wave = 2; wave <= 9; wave++) {
      globalScene.currentBattle.waveIndex = wave;
      const choice = getErTrainerForTrainer(stubTrainer(TrainerType.YOUNGSTER));
      if (choice) {
        keys.push(choice.stableKey);
      }
    }
    expect(keys.length).toBeGreaterThan(3);
    expect(new Set(keys).size).toBe(keys.length); // all distinct → no within-run repeat
  });
});
