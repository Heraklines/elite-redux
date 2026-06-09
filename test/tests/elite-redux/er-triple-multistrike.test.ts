/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// #313 — Triple Axel / Triple Kick must hit up to 3× with ramping power
// (base, 2×base, 3×base). Regression guard: wiring is
// MultiHitAttr(THREE) + MultiHitPowerIncrementAttr(3) + checkAllHits().

import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("ER Triple Axel / Triple Kick multi-strike ramp (#313)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      // Slow enemy (Shuckle, base SPD 5) so the player always moves first and
      // forceHit() lands on the player's multi-hit move.
      .enemySpecies(SpeciesId.SHUCKLE)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(100)
      .startingLevel(100)
      .criticalHits(false);
  });

  it("Triple Axel hits 3× with ramping power 20/40/60", async () => {
    const axel = allMoves[MoveId.TRIPLE_AXEL];
    expect(axel.power).toBe(20);
    vi.spyOn(axel, "calculateBattlePower");

    game.override.moveset(MoveId.TRIPLE_AXEL);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    game.move.select(MoveId.TRIPLE_AXEL);
    await game.move.forceHit(); // guarantee all 3 strikes land
    await game.phaseInterceptor.to("TurnEndPhase");

    const returned = (axel.calculateBattlePower as ReturnType<typeof vi.fn>).mock.results.map(r => r.value);
    // Three strikes, ramping: 20, 40, 60.
    expect(returned).toEqual([20, 40, 60]);
  });

  it("Triple Kick hits 3× with ramping power 25/50/75", async () => {
    const kick = allMoves[MoveId.TRIPLE_KICK];
    // ER c-source correction sets Triple Kick base power to 25.
    expect(kick.power).toBe(25);
    vi.spyOn(kick, "calculateBattlePower");

    game.override.moveset(MoveId.TRIPLE_KICK);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    game.move.select(MoveId.TRIPLE_KICK);
    await game.move.forceHit();
    await game.phaseInterceptor.to("TurnEndPhase");

    const returned = (kick.calculateBattlePower as ReturnType<typeof vi.fn>).mock.results.map(r => r.value);
    expect(returned).toEqual([25, 50, 75]);
  });
});
