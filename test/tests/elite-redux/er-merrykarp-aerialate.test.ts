/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ErSpeciesId } from "#enums/er-species-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("Merrykarp Aerialate", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("converts Tackle to Flying and is super-effective against Grass", async () => {
    game.override
      .startingWave(102)
      .startingLevel(100)
      .enemyLevel(100)
      .moveset(MoveId.TACKLE)
      .ability(AbilityId.AERILATE)
      .enemySpecies(SpeciesId.TANGELA)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(ErSpeciesId.MERRYKARP as unknown as SpeciesId);

    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;
    const tackle = allMoves[MoveId.TACKLE];

    expect(player.hasAbility(AbilityId.AERILATE)).toBe(true);
    expect(player.getMoveType(tackle)).toBe(PokemonType.FLYING);
    expect(enemy.getAttackTypeEffectiveness(player.getMoveType(tackle), { source: player, move: tackle })).toBe(2);
  });
});
