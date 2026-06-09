/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression (#346) — Elite mode tuning:
//  (a) FULL POOL: Elite's regular waves draw from ALL unused trainers (895),
//      not just the ~429 that ship an "insane" roster — so party-only trainers
//      (weaker rosters) actually appear, mostly in the early/mid game.
//  (b) SLOWER RAMP: at the same wave, Elite's strength-window target sits no
//      higher than Hell's (progression span 230 vs 180), so Elite reaches the
//      top-end teams later in the run.
//  (Cadence easing 3 → 4 is covered in er-trainer-cadence.test.ts.)
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import {
  clearErTrainerCacheForTests,
  getErTrainerForTrainer,
  resetErRunTrainerTracking,
  teamStrength,
} from "#data/elite-redux/er-trainer-runtime-hook";
import { ER_TRAINER_REGISTRY } from "#data/elite-redux/init-elite-redux-trainers";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import type { Trainer } from "#field/trainer";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Elite tuning (#346)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
  });

  /** Minimal Trainer stub — getErTrainerForTrainer only reads these fields. */
  function stubTrainer(type: TrainerType): Trainer {
    return {
      config: { trainerType: type, isBoss: false },
      getPartyTemplate: () => ({ size: 2 }),
    } as unknown as Trainer;
  }

  const hasInsane = (key: string): boolean => {
    const t = ER_TRAINER_REGISTRY.find(e => e.stableKey === key);
    return (t?.insaneParty?.length ?? 0) > 0;
  };

  it("Elite regular waves field party-only trainers too (full 895 pool, not just the insane-roster 429)", () => {
    setErDifficulty("elite");
    const picked: string[] = [];
    // Simulate the trainer picks of many early/mid-game runs.
    for (let i = 0; i < 40; i++) {
      resetErRunTrainerTracking();
      clearErTrainerCacheForTests();
      globalScene.seed = `elite-full-pool-${i}`;
      for (const wave of [3, 7, 12, 18, 24]) {
        globalScene.currentBattle.waveIndex = wave;
        const choice = getErTrainerForTrainer(stubTrainer(TrainerType.YOUNGSTER));
        if (choice) {
          picked.push(choice.stableKey);
        }
        clearErTrainerCacheForTests(); // new Trainer instance per wave in reality
      }
    }
    const partyOnly = picked.filter(k => !hasInsane(k));
    // Before #346 this was ALWAYS 0 — the unusedTier filter excluded every
    // party-only trainer until the whole 429-trainer insane pool was spent.
    expect(picked.length).toBeGreaterThan(50);
    expect(partyOnly.length).toBeGreaterThan(0);
  });

  it("Elite's wave-strength target ramps no faster than Hell's (slower progression span)", () => {
    // Compare the picked trainer's team strength at the same mid-game wave under
    // both difficulties, averaged over several run seeds. Elite (span 230 + the
    // weaker full pool) must sit at or below Hell (span 180, insane/hell pool).
    const avgStrength = (difficulty: "elite" | "hell"): number => {
      setErDifficulty(difficulty);
      const tier = difficulty === "elite" ? "insane" : "hell";
      let total = 0;
      let n = 0;
      for (let i = 0; i < 25; i++) {
        resetErRunTrainerTracking();
        clearErTrainerCacheForTests();
        globalScene.seed = `ramp-cmp-${i}`;
        globalScene.currentBattle.waveIndex = 90;
        const choice = getErTrainerForTrainer(stubTrainer(TrainerType.YOUNGSTER));
        if (choice) {
          total += teamStrength(choice, tier);
          n++;
        }
      }
      return n > 0 ? total / n : 0;
    };
    const elite = avgStrength("elite");
    const hell = avgStrength("hell");
    expect(elite).toBeGreaterThan(0);
    expect(hell).toBeGreaterThan(0);
    expect(elite).toBeLessThanOrEqual(hell);
  });
});
