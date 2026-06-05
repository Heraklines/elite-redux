/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER trainer rosters are usually LARGER than the wave's party size. The engine
// asks for genPartyMember(0..size-1), and the hook used to return roster[index]
// — always the first N members, so a player saw the EXACT same Pokémon from a
// given trainer every run. The fix maps each slot through a wave-seeded shuffle
// of the roster, so the subset that appears:
//   - is STABLE within a battle / across a save-load (same wave seed), and
//   - ROTATES across runs (a different wave seed reshuffles).
//
// Gated behind ER_SCENARIO=1 (needs a real globalScene for executeWithSeedOffset
// + waveSeed).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { clearErTrainerCacheForTests, getRosterOrder } from "#data/elite-redux/er-trainer-runtime-hook";
import type { Trainer } from "#field/trainer";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER trainer roster rotation", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    // Need a live globalScene (executeWithSeedOffset + waveSeed live on it).
    await game.classicMode.startBattle();
  });

  /**
   * Fresh stub used purely as the WeakMap cache key — getRosterOrder never reads
   * any Trainer field, only its identity, so a real (heavy) Trainer isn't needed.
   */
  function newTrainer(): Trainer {
    return {} as unknown as Trainer;
  }

  function isPermutationOf(order: readonly number[], n: number): boolean {
    if (order.length !== n) {
      return false;
    }
    return [...order].sort((a, b) => a - b).every((v, i) => v === i);
  }

  it("returns a valid permutation of the roster indices", () => {
    clearErTrainerCacheForTests();
    globalScene.waveSeed = "seed-A";
    const order = getRosterOrder(newTrainer(), 8, "party");
    expect(isPermutationOf(order, 8)).toBe(true);
  });

  it("is stable within a battle (same trainer + seed reproduces the order)", () => {
    clearErTrainerCacheForTests();
    globalScene.waveSeed = "seed-stable";
    const t = newTrainer();
    const first = [...getRosterOrder(t, 8, "party")];
    const second = [...getRosterOrder(t, 8, "party")]; // cached → identical
    expect(second).toEqual(first);

    // Same seed, a fresh trainer (cold cache) must recompute the SAME order —
    // this is what makes a save/load reload reproduce the team.
    clearErTrainerCacheForTests();
    globalScene.waveSeed = "seed-stable";
    const reloaded = [...getRosterOrder(newTrainer(), 8, "party")];
    expect(reloaded).toEqual(first);
  });

  it("rotates across runs (different wave seeds give different subsets)", () => {
    // Compare the first-3 subset (a 6-member party from an 8-member roster) across
    // several seeds; at least one must differ, proving the team isn't fixed.
    const subsets = ["run-1", "run-2", "run-3", "run-4"].map(seed => {
      clearErTrainerCacheForTests();
      globalScene.waveSeed = seed;
      return getRosterOrder(newTrainer(), 8, "party").slice(0, 3).join(",");
    });
    const distinct = new Set(subsets);
    expect(distinct.size).toBeGreaterThan(1);
  });
});
