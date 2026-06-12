/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #416 - faster game-speed tiers: Hyper (7x) and Ludicrous (10x) join the
// vanilla 2-5x options. The speed only divides tween/timer durations
// (initGameSpeed); audio playback rate and music are untouched. These tests
// pin the new options and prove a battle still resolves turns at 10x (every
// duration passes through Math.ceil(value / gameSpeed), so nothing collapses
// to a 0ms/NaN tween). Gated behind ER_SCENARIO=1.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Setting, SettingKeys } from "#system/settings/settings";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER faster game speed (#416)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.HARDEN)
      .enemyLevel(100)
      .startingLevel(100)
      .ability(AbilityId.BALL_FETCH);
  });

  it("the Game Speed setting offers the 7x and 10x tiers above Turbo", () => {
    const speedSetting = Setting.find(s => s.key === SettingKeys.Game_Speed)!;
    const values = speedSetting.options.map(o => o.value);
    expect(values).toEqual(["2", "3", "4", "5", "7", "10"]);
  });

  it("a battle resolves turns normally at 10x speed", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    game.scene.gameSpeed = 10;
    const enemy = game.scene.getEnemyPokemon()!;

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    const afterFirst = enemy.getInverseHp();
    expect(afterFirst).toBeGreaterThan(0);

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    expect(enemy.getInverseHp()).toBeGreaterThan(afterFirst);
  });
});
