/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER (#427): infatuation works like the ER ROM, not vanilla. Vanilla gives a
// 50% chance to be immobilized each turn; ER instead cuts the infatuated
// Pokemon's Attack AND Sp. Atk in HALF while it lasts (every ER ability that
// infatuates - Cute Charm, Pure Love, Yuki Onna, Entrance... - describes it as
// "cuts their Attack and Special Attack in half"). The mon always acts.
// =============================================================================

import { Gender } from "#data/gender";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("ER #427 - infatuation halves Atk/SpAtk, never immobilizes", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .ability(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE])
      .startingLevel(50)
      .enemyLevel(50);
  });

  it("cuts the infatuated holder's Attack and Sp. Atk in half", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;
    player.gender = Gender.MALE;
    enemy.gender = Gender.FEMALE;

    const atkBefore = player.getEffectiveStat(Stat.ATK);
    const spatkBefore = player.getEffectiveStat(Stat.SPATK);
    const defBefore = player.getEffectiveStat(Stat.DEF);

    player.addTag(BattlerTagType.INFATUATED, 1, MoveId.ATTRACT, enemy.id);
    expect(player.getTag(BattlerTagType.INFATUATED)).toBeDefined();

    expect(player.getEffectiveStat(Stat.ATK)).toBe(Math.floor(atkBefore / 2));
    expect(player.getEffectiveStat(Stat.SPATK)).toBe(Math.floor(spatkBefore / 2));
    // Defenses untouched.
    expect(player.getEffectiveStat(Stat.DEF)).toBe(defBefore);
  });

  it("an infatuated Pokemon ALWAYS acts (no 50% immobilize)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;
    player.gender = Gender.MALE;
    enemy.gender = Gender.FEMALE;
    player.addTag(BattlerTagType.INFATUATED, 5, MoveId.ATTRACT, enemy.id);

    // Three consecutive turns: with vanilla's 50% roll the odds of all three
    // landing would be 12.5%; in ER the move fires every time, deterministically.
    for (let turn = 0; turn < 3; turn++) {
      const hpBefore = enemy.hp;
      game.move.select(MoveId.TACKLE);
      await game.toNextTurn();
      expect(enemy.hp).toBeLessThan(hpBefore);
    }
  });
});
