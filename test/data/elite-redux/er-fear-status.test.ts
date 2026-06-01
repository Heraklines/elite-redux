/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — ER_FEAR status faithfulness (v2.65.3b ROM):
//   "Fear traps the target for 2 turns and they take 50% more damage. If forced
//    out by moves like Whirlwind, the target loses Fear."
//
// Previously ER_FEAR was a do-nothing marker tag.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("ER status — Fear", () => {
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
      .startingLevel(100)
      .enemyLevel(100)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SHUCKLE)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH]);
  });

  test("traps the bearer (cannot switch out)", async () => {
    await game.classicMode.startBattle(SpeciesId.RATTATA);
    const player = game.field.getPlayerPokemon();
    expect(player.isTrapped()).toBe(false);
    player.addTag(BattlerTagType.ER_FEAR);
    expect(player.isTrapped()).toBe(true);
  });

  test("does not trap a Ghost-type (vanilla trap rules)", async () => {
    await game.classicMode.startBattle(SpeciesId.GASTLY);
    const player = game.field.getPlayerPokemon();
    player.addTag(BattlerTagType.ER_FEAR);
    expect(player.isTrapped()).toBe(false);
  });

  test("makes the bearer take ~50% more damage", async () => {
    await game.classicMode.startBattle(SpeciesId.RATTATA);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const move = allMoves[MoveId.TACKLE];

    const baseline = enemy.getAttackDamage({ source: player, move, simulated: true }).damage;
    enemy.addTag(BattlerTagType.ER_FEAR);
    const feared = enemy.getAttackDamage({ source: player, move, simulated: true }).damage;

    // ×1.5 with the ±(0.85..1.0) random roll on each call → ratio in [1.275, 1.77].
    expect(feared).toBeGreaterThan(baseline);
    expect(feared / baseline).toBeGreaterThanOrEqual(1.27);
    expect(feared / baseline).toBeLessThanOrEqual(1.78);
  });
});
