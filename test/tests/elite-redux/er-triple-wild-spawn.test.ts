/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Multi-format battles - VERTICAL SLICE: a flag-on TRIPLE WILD battle actually
// spawns 3v3 and reaches the command phase headlessly. Driven by the gated
// BATTLE_STYLE_OVERRIDE="triple" (dev/headless only); the encounter pipeline
// (resolver -> Battle format -> enemy placement + 3x SummonPhase + CheckSwitch)
// must field three on each side and not soft-lock during spawn. Gated ER_SCENARIO=1.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { TRIPLE_FORMAT } from "#data/battle-format";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER multi-format - a TRIPLE WILD battle spawns 3v3 headlessly", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("triple")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .startingLevel(20)
      .enemyLevel(20);
  });

  it("resolves to TRIPLE_FORMAT and fields three active Pokemon on each side", async () => {
    // If the spawn pipeline soft-locked, startBattle would time out here.
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE);

    const battle = globalScene.currentBattle;
    expect(battle.format).toBe(TRIPLE_FORMAT);
    expect(battle.getBattlerCount()).toBe(3);
    expect(battle.double).toBe(false);

    // 3v3 actually on the field and active.
    expect(globalScene.getPlayerField(true).length).toBe(3);
    expect(globalScene.getEnemyField(true).length).toBe(3);

    // Flat battler indices: players 0,1,2 / enemies 3,4,5.
    expect(globalScene.getPlayerField()[0].getBattlerIndex()).toBe(0);
    expect(globalScene.getPlayerField()[2].getBattlerIndex()).toBe(2);
    expect(globalScene.getEnemyField()[0].getBattlerIndex()).toBe(3);
    expect(globalScene.getEnemyField()[2].getBattlerIndex()).toBe(5);
  });
});
