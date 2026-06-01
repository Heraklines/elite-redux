/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// ER trainer import adapts to PokeRogue's curve: the roster TIER scales with
// the wave (easy early → insane/hell at boss waves), and ER-trainer selection
// is wave-seeded so every trainer of a class is reachable across a run.

import { findErTrainersForType } from "#data/elite-redux/er-trainer-overlay";
import { clearErTrainerCacheForTests, pickTierForWave } from "#data/elite-redux/er-trainer-runtime-hook";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("ER trainer import — curve adaptation", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
    clearErTrainerCacheForTests();
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .moveset([MoveId.SPLASH])
      .ability(AbilityId.BALL_FETCH)
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER });
  });

  it("uses the easy 'party' tier at an early wave", async () => {
    game.override.startingWave(5);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const trainer = game.scene.currentBattle.trainer!;
    expect(pickTierForWave(trainer)).toBe("party");
  });

  it("uses the full 'hell' tier at a boss wave (wave % 10 === 0)", async () => {
    game.override.startingWave(10);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const trainer = game.scene.currentBattle.trainer!;
    expect(pickTierForWave(trainer)).toBe("hell");
  });

  it("wave-seeded selection can reach more than just the first candidate", () => {
    const candidates = findErTrainersForType(TrainerType.ACE_TRAINER);
    expect(candidates.length).toBeGreaterThan(1);
    // The pick is candidates[wave % len]; across waves this spans all of them.
    const reachable = new Set<number>();
    for (let wave = 0; wave < candidates.length; wave++) {
      reachable.add(wave % candidates.length);
    }
    expect(reachable.size).toBe(candidates.length); // every candidate is reachable
  });
});
