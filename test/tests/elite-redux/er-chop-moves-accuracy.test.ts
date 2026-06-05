/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Verify Karate Chop / Cross Chop match the authoritative ER ROM (v2.65.3b,
// vendor/elite-redux/rom-extracted/er-battle-moves.json):
//   KARATE_CHOP: 60 / 100 / 25 ; CROSS_CHOP: 100 / 80 / 5

import { allMoves } from "#data/data-lists";
import { MoveId } from "#enums/move-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

describe("ER chop moves match the ROM", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  it("Karate Chop = 60 / 100 / 25", () => {
    const m = allMoves[MoveId.KARATE_CHOP];
    console.log(`[chop] Karate Chop: power ${m.power}, acc ${m.accuracy}, pp ${m.pp}`);
    expect([m.power, m.accuracy, m.pp]).toEqual([60, 100, 25]);
  });

  it("Cross Chop = 100 / 80 / 5", () => {
    const m = allMoves[MoveId.CROSS_CHOP];
    console.log(`[chop] Cross Chop: power ${m.power}, acc ${m.accuracy}, pp ${m.pp}`);
    expect([m.power, m.accuracy, m.pp]).toEqual([100, 80, 5]);
  });
});
