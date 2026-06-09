/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression (#347) — ER Battle-Factory sets season the Elite/Hell trainer pool:
//  - the 1932-set dump resolves cleanly through ER_ID_MAP (species + moves);
//  - a seeded fraction of REGULAR Elite/Hell waves fields a factory team that
//    is wave/BST-appropriate, with distinct species and full party size;
//  - Ace NEVER fields a factory team (#345); rival/boss waves are exempt;
//  - the decision is deterministic per run seed + wave.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import {
  clearErFactoryCacheForTests,
  getErFactoryTeamForTrainer,
  resolvedFactorySets,
} from "#data/elite-redux/er-trainer-runtime-hook";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import type { Trainer } from "#field/trainer";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER factory sets (#347)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
  });
  afterEach(() => {
    setErDifficulty("ace");
  });

  function stubTrainer(size = 4): Trainer {
    return {
      config: { trainerType: TrainerType.YOUNGSTER, isBoss: false },
      getPartyTemplate: () => ({ size }),
    } as unknown as Trainer;
  }

  it("the dump resolves nearly fully (species + moves through ER_ID_MAP)", () => {
    const pool = resolvedFactorySets();
    expect(pool.length).toBeGreaterThan(1700);
    // sorted weakest → strongest, and every set has at least one usable move
    for (let i = 1; i < pool.length; i++) {
      expect(pool[i].bst).toBeGreaterThanOrEqual(pool[i - 1].bst);
    }
    expect(pool.every(s => s.moves.length > 0)).toBe(true);
  });

  it("Elite fields factory teams on a seeded fraction of regular waves; teams are full-size with distinct species", () => {
    setErDifficulty("elite");
    let teams = 0;
    let checked = 0;
    for (let i = 0; i < 30; i++) {
      globalScene.seed = `factory-${i}`;
      for (const wave of [13, 27, 44, 63, 86]) {
        clearErFactoryCacheForTests();
        globalScene.currentBattle.waveIndex = wave;
        const team = getErFactoryTeamForTrainer(stubTrainer(4));
        checked++;
        if (team) {
          teams++;
          expect(team.length).toBe(4);
          expect(new Set(team.map(m => m.speciesId)).size).toBe(4);
        }
      }
    }
    // ~15% chance: across 150 rolls expect a healthy band, not 0 and not most.
    expect(teams).toBeGreaterThan(5);
    expect(teams).toBeLessThan(checked / 2);
  });

  it("factory teams are wave/BST-appropriate (late-wave teams outclass early-wave teams)", () => {
    setErDifficulty("hell");
    const avgBstAt = (wave: number): number => {
      let total = 0;
      let n = 0;
      for (let i = 0; i < 60 && n < 10; i++) {
        globalScene.seed = `factory-bst-${i}`;
        clearErFactoryCacheForTests();
        globalScene.currentBattle.waveIndex = wave;
        const team = getErFactoryTeamForTrainer(stubTrainer(3));
        if (team) {
          total += team.reduce((s, m) => s + m.bst, 0) / team.length;
          n++;
        }
      }
      expect(n).toBeGreaterThan(0);
      return total / n;
    };
    expect(avgBstAt(173)).toBeGreaterThan(avgBstAt(8));
  });

  it("Ace never fields a factory team; boss waves are exempt", () => {
    setErDifficulty("ace");
    for (let i = 0; i < 40; i++) {
      globalScene.seed = `factory-ace-${i}`;
      clearErFactoryCacheForTests();
      globalScene.currentBattle.waveIndex = 13 + i;
      expect(getErFactoryTeamForTrainer(stubTrainer(4))).toBeNull();
    }
    setErDifficulty("hell");
    for (let i = 0; i < 40; i++) {
      globalScene.seed = `factory-boss-${i}`;
      clearErFactoryCacheForTests();
      globalScene.currentBattle.waveIndex = 30; // boss wave (%10)
      expect(getErFactoryTeamForTrainer(stubTrainer(4))).toBeNull();
    }
  });
});
