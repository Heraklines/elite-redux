/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Repro: "Daily run just freezes." getDailyRunStarters() picks species by exact
// starter-cost bucket; ER recosted starters, so a bucket may now be empty ->
// randSeedItem([]) returns undefined -> getPokemonSpecies(undefined) throws ->
// the offline daily path (no try/catch) freezes the run. Also surfaces whether
// daily starters resolve to ER custom species (id >= 10000) that may have a
// broken sprite (loadAssets() hang). Sweeps many seeds to catch the bad bucket.
// =============================================================================

import { getGameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import { speciesStarterCosts } from "#balance/starters";
import { getDailyRunStarters } from "#data/daily-seed/daily-run";
import { GameModes } from "#enums/game-modes";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

describe("ER daily-run starter generation (freeze repro)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  it("every starter-cost bucket 1..8 has at least one species (else daily throws)", () => {
    const emptyBuckets: number[] = [];
    for (let cost = 1; cost <= 8; cost++) {
      const inBucket = Object.keys(speciesStarterCosts).filter(s => speciesStarterCosts[Number(s)] === cost);
      if (inBucket.length === 0) {
        emptyBuckets.push(cost);
      }
    }
    expect(emptyBuckets, `starter-cost buckets with NO species: ${emptyBuckets.join(", ")}`).toEqual([]);
  });

  it("generates daily starters without throwing across many seeds", () => {
    globalScene.gameMode = getGameMode(GameModes.DAILY);
    const failures: string[] = [];
    const customStarters: number[] = [];
    for (let i = 0; i < 400; i++) {
      const seed = `daily-seed-${i}`;
      globalScene.setSeed(seed);
      globalScene.resetSeed();
      try {
        const starters = getDailyRunStarters();
        for (const s of starters) {
          if (s == null || s.speciesId == null) {
            failures.push(`seed ${seed}: null starter`);
          } else if (s.speciesId >= 10000) {
            customStarters.push(s.speciesId);
          }
        }
      } catch (e) {
        failures.push(`seed ${seed}: ${(e as Error).message}`);
      }
    }
    expect(failures, `daily generation failures:\n${failures.slice(0, 20).join("\n")}`).toEqual([]);
    // ER fix: daily runs must NOT field ER custom species (id >= 10000), whose
    // asset load can stall and freeze the (error-handling-free) daily boot.
    expect(
      [...new Set(customStarters)],
      `daily run produced ER-custom starters (freeze risk): ${[...new Set(customStarters)].join(", ")}`,
    ).toEqual([]);
  });
});
