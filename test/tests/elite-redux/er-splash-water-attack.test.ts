/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Elite Redux reworks Splash from the vanilla "nothing happens" status move
// into a WATER-type PHYSICAL attack whose power scales with how much the user
// outweighs the target (Heavy-Slam curve), 100% accuracy, targeting the foe.
// (ER move id 150: type Water, split physical, "Does more damage if the user
// outweighs the foe.") This guards that conversion.

import { allMoves } from "#data/data-lists";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import { PokemonType } from "#enums/pokemon-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

describe("ER Splash is a Water physical weight attack", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  it("is Water-type, physical, 100% accuracy, targets the foe, weight-scaled", () => {
    const m = allMoves[MoveId.SPLASH];
    expect(m.type).toBe(PokemonType.WATER);
    expect(m.category).toBe(MoveCategory.PHYSICAL);
    expect(m.accuracy).toBe(100);
    expect(m.moveTarget).toBe(MoveTarget.NEAR_OTHER);
    // Heavy-Slam-style weight power attr is present...
    expect(m.attrs.some(a => a.constructor.name === "CompareWeightPowerAttr")).toBe(true);
    // ...and the do-nothing "But nothing happened!" message attr is gone.
    expect(m.attrs.some(a => a.constructor.name === "MessageAttr")).toBe(false);
  });
});
