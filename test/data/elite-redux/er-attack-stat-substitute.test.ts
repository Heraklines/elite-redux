/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ER attack-stat substitution: Ancient Idol (physical uses Def), Momentum
// (contact uses Speed). Asserts the damage actually scales with the substituted
// stat, not Attack.

import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("ER attack-stat substitution", () => {
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
      .moveset([MoveId.TACKLE]);
  });

  test("Ancient Idol — physical damage scales with Def, not Attack", async () => {
    // Shuckle: Def 230, Atk 10 — substitution should massively raise damage.
    game.override.ability(ErAbilityId.ANCIENT_IDOL as unknown as AbilityId);
    await game.classicMode.startBattle(SpeciesId.SHUCKLE);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const move = allMoves[MoveId.TACKLE];

    const withIdol = enemy.getAttackDamage({
      source: player,
      move,
      simulated: true,
      ignoreSourceAbility: false,
    }).damage;
    const noAbility = enemy.getAttackDamage({
      source: player,
      move,
      simulated: true,
      ignoreSourceAbility: true,
    }).damage;

    // Def(230) >> Atk(~10), so the Def-substituted hit must dwarf the Atk hit.
    expect(player.getStat(Stat.DEF, false)).toBeGreaterThan(player.getStat(Stat.ATK, false));
    expect(withIdol).toBeGreaterThan(noAbility * 3);
  });
});
