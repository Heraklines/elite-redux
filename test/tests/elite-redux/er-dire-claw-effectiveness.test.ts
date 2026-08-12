/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("Dire Claw effectiveness reports", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it.each([
    ["Oricorio", SpeciesId.ORICORIO, 1],
    ["Dragalge", SpeciesId.DRAGALGE, 0.5],
  ] as const)("is not unexpectedly super-effective against %s", async (_name, targetSpecies, expected) => {
    game.override
      .startingWave(102)
      .startingLevel(100)
      .enemyLevel(100)
      .moveset(MoveId.DIRE_CLAW)
      .enemySpecies(targetSpecies)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.SNEASLER);

    const user = game.scene.getPlayerPokemon()!;
    const target = game.scene.getEnemyPokemon()!;
    const move = allMoves[MoveId.DIRE_CLAW];

    expect(target.getAttackTypeEffectiveness(user.getMoveType(move), { source: user, move })).toBe(expected);
  });
});
