/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Redux Up gacha (#409): the 4th machine's eggs (EggSourceType.GACHA_REDUX)
// weight ER customs (speciesId >= 10000) 10x in the species roll, and the
// enum mapping is save-safe (GACHA_REDUX appended as 5 - cursor 3 would have
// collided with SAME_SPECIES_EGG). Gated behind ER_SCENARIO=1.
// =============================================================================

import { Egg } from "#data/egg";
import { EggSourceType } from "#enums/egg-source-types";
import { EggTier } from "#enums/egg-type";
import { GachaType } from "#enums/gacha-types";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Redux Up gacha (#409)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    game = new GameManager(phaserGame);
  });

  it("GACHA_REDUX is appended save-safely (5) and never collides with SAME_SPECIES_EGG", () => {
    expect(EggSourceType.GACHA_REDUX).toBe(5);
    expect(EggSourceType.SAME_SPECIES_EGG).toBe(3);
    expect(GachaType.REDUX).toBe(3);
  });

  it("Redux Up eggs hatch ER customs far more often than Move Up eggs", () => {
    const count = (sourceType: EggSourceType): number => {
      let custom = 0;
      for (let i = 0; i < 60; i++) {
        const egg = new Egg({ sourceType, tier: EggTier.COMMON, scene: game.scene });
        if (egg.species >= 10000) {
          custom++;
        }
      }
      return custom;
    };
    const reduxCustoms = count(EggSourceType.GACHA_REDUX);
    const moveCustoms = count(EggSourceType.GACHA_MOVE);
    // 10x weighting makes this gap statistically certain over 60 rolls each.
    expect(reduxCustoms).toBeGreaterThan(moveCustoms);
    expect(reduxCustoms).toBeGreaterThan(20);
  });
});
