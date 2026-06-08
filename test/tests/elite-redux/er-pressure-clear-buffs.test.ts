/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Bug repro (#321): "Pressure doesn't correctly clear stat changes." ER Pressure
// = vanilla 2× foe PP usage + "clears all positive stat stages on entry". The
// rider (ClearOpponentStatBuffsOnSummonAbAttr) should, when a Pressure holder
// switches in, zero each opponent's POSITIVE stat stages while leaving negatives
// (and the holder's own stages) untouched.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("ER Pressure — clears opponents' positive stat stages on entry", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .enemySpecies(SpeciesId.RATTATA)
      .enemyAbility(AbilityId.BALL_FETCH)
      .ability(AbilityId.PRESSURE)
      .passiveAbility(AbilityId.NO_GUARD)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH);
  });

  it("zeroes the enemy's positive stages when a Pressure mon switches in (negatives survive)", async () => {
    await game.classicMode.startBattle(SpeciesId.MIGHTYENA, SpeciesId.POOCHYENA);

    const enemy = game.field.getEnemyPokemon();
    enemy.setStatStage(Stat.ATK, 4);
    enemy.setStatStage(Stat.SPD, 2);
    enemy.setStatStage(Stat.DEF, -1); // a debuff — must be left alone
    expect(enemy.getStatStage(Stat.ATK)).toBe(4);

    game.doSwitchPokemon(1);
    await game.toNextTurn();

    expect(game.scene.getPlayerParty()[0]).toHaveAbilityApplied(AbilityId.PRESSURE);
    expect(enemy.getStatStage(Stat.ATK)).toBe(0);
    expect(enemy.getStatStage(Stat.SPD)).toBe(0);
    expect(enemy.getStatStage(Stat.DEF)).toBe(-1);
  });
});
