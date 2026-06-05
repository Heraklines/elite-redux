/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// "Daily run just freezes." Confirmed via a live console log: a daily party
// member (an ER custom) had a move whose charge-anim key resolved to "" →
// fetch of `battle-anims/.json` → CDN 403 with a non-JSON body. initMoveChargeAnim
// had NO ok/content-type check, NO .catch, and only resolve()d on success, so it
// threw an unhandled rejection AND never resolved — hanging the run.
//
// Fix: initMoveChargeAnim now guards an undefined ChargeAnim key and treats any
// load failure as "no charge anim" (placeholder + resolve). This verifies it
// resolves (rather than hanging/throwing) for an invalid charge anim, and that
// daily starter generation still runs clean (customs are allowed again).
// =============================================================================

import { getGameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import { speciesStarterCosts } from "#balance/starters";
import { initMoveChargeAnim } from "#data/battle-anims";
import { getDailyRunStarters } from "#data/daily-seed/daily-run";
import { GameModes } from "#enums/game-modes";
import type { ChargeAnim } from "#enums/move-anims-common";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

describe("ER daily-run freeze (charge-anim loader)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  it("initMoveChargeAnim resolves (does not hang/throw) for an invalid charge anim", async () => {
    // An out-of-range ChargeAnim => ChargeAnim[x] is undefined => the old code
    // fetched `battle-anims/.json`, 403'd, threw on .json(), and never resolved.
    // The guard must short-circuit to a resolved promise.
    await expect(initMoveChargeAnim(99999 as ChargeAnim)).resolves.toBeUndefined();
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
    for (let i = 0; i < 200; i++) {
      const seed = `daily-seed-${i}`;
      globalScene.setSeed(seed);
      globalScene.resetSeed();
      try {
        const starters = getDailyRunStarters();
        for (const s of starters) {
          if (s == null || s.speciesId == null) {
            failures.push(`seed ${seed}: null starter`);
          }
        }
      } catch (e) {
        failures.push(`seed ${seed}: ${(e as Error).message}`);
      }
    }
    expect(failures, `daily generation failures:\n${failures.slice(0, 20).join("\n")}`).toEqual([]);
  });
});
