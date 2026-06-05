/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Elite Redux buffs candy gain across the board by ~35% (ER_CANDY_GAIN_MULTIPLIER)
// and, during a challenge run, by the favour candy multiplier (same curve as
// shiny, up to 3x). Both apply at the single chokepoint GameData.addStarterCandy.
// Outside a run there are no challenges, so the favour multiplier is 1x and only
// the flat 35% applies.

import { globalScene } from "#app/global-scene";
import { ER_CANDY_GAIN_MULTIPLIER } from "#data/elite-redux/er-shiny-favour";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("ER candy-gain buff", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single");
  });

  it("flat 35% multiplier is 1.35", () => {
    expect(ER_CANDY_GAIN_MULTIPLIER).toBeCloseTo(1.35, 5);
  });

  it("addStarterCandy applies the flat ~35% buff (no challenge → 1x favour)", async () => {
    await game.classicMode.startBattle([SpeciesId.BULBASAUR]);
    const gd = globalScene.gameData;
    const id = SpeciesId.BULBASAUR;

    const gain = (base: number): number => {
      const before = gd.getStarterDataEntry(id).candyCount;
      gd.addStarterCandy(id, base);
      return gd.getStarterDataEntry(id).candyCount - before;
    };

    // round(base * 1.35 * 1): 10→14, 4→5, 2→3, 1→1 (never below 1 for a gain).
    expect(gain(10)).toBe(14);
    expect(gain(4)).toBe(5);
    expect(gain(2)).toBe(3);
    expect(gain(1)).toBe(1);
  });
});
