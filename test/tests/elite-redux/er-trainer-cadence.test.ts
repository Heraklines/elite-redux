/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite/Hell trainer cadence. ER forces a trainer on a difficulty cadence
// (Elite every 4th eligible wave — eased from 3rd in #346 — Hell every 2nd) so
// the run plays as a dense gauntlet. Two suppressors used to silently gut this
// once the run left a `trainerChance: 0` biome (Town → Plains ~wave 10):
//   1. the biome's *random* anti-clustering rolls, and
//   2. the ±2 proximity guard around gyms / fixed battles — which blanked the
//      cadence waves flanking every rival (e.g. the wave-25 rival killed forced
//      trainers on 24 AND 27, leaving waves 20–30 nearly empty).
// `isWaveTrainer` now lets the forced cadence bypass both (skipping only the
// exact gym/fixed wave). Ace is untouched.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { BiomeId } from "#enums/biome-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function countBattles(gm: { isWaveTrainer: (w: number) => boolean; isFixedBattle: (w: number) => boolean }): number {
  let n = 0;
  for (let w = 2; w <= 60; w++) {
    if (gm.isWaveTrainer(w) || gm.isFixedBattle(w)) {
      n++;
    }
  }
  return n;
}

describe.skipIf(!RUN)("ER Elite/Hell trainer cadence is dense and not gutted near rivals", () => {
  let phaserGame: Phaser.Game;
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

  it("Elite forces trainers on cadence waves near the wave-25 rival (24 & 28)", async () => {
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);
    game.scene.newArena(BiomeId.PLAINS); // trainerChance > 0, so the old code would suppress
    setErDifficulty("elite");
    const gm = game.scene.gameMode;
    // 24 and 28 are %4 cadence waves around the wave-25 rival — 24 sits inside
    // the old ±2 proximity guard the cadence must bypass.
    expect(gm.isWaveTrainer(24)).toBe(true);
    expect(gm.isWaveTrainer(28)).toBe(true);
  });

  it("Elite yields far more battles than Ace over waves 2–60 (Ace unchanged)", async () => {
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);
    game.scene.newArena(BiomeId.PLAINS);
    const gm = game.scene.gameMode;

    setErDifficulty("ace");
    const aceCount = countBattles(gm);

    setErDifficulty("elite");
    const eliteCount = countBattles(gm);

    expect(eliteCount).toBeGreaterThan(aceCount + 8);
  });

  it("Elite forces generic %4 cadence waves (32/36/44)", async () => {
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);
    game.scene.newArena(BiomeId.PLAINS);
    setErDifficulty("elite");
    const gm = game.scene.gameMode;
    // On Elite these mid waves (no nearby fixed battle) are forced…
    expect(gm.isWaveTrainer(32)).toBe(true);
    expect(gm.isWaveTrainer(36)).toBe(true);
    expect(gm.isWaveTrainer(44)).toBe(true);
  });
});
