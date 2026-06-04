/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Desert Spirit — "Summons sand on entry. Ground moves hit airborne in sand."
import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveCategory } from "#enums/move-category";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("ER Ability - Desert Spirit", () => {
  let pg: Phaser.Game;
  let game: GameManager;
  beforeAll(() => {
    pg = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(pg);
    // PIDGEOT is Normal/Flying → normally immune (0x) to Ground.
    game.override.battleStyle("single").enemySpecies(SpeciesId.PIDGEOT).enemyAbility(AbilityId.KEEN_EYE);
  });

  // A damaging Ground-type move (resolved by type to dodge ER move-id remaps).
  const groundMove = () =>
    allMoves.find(m => m && m.type === PokemonType.GROUND && m.category !== MoveCategory.STATUS)!;

  test("Ground moves hit a Flying foe for neutral damage while sand is up", async () => {
    game.override.ability(ErAbilityId.DESERT_SPIRIT as unknown as AbilityId);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    // Desert Spirit auto-summons sand on entry.
    expect(enemy.getMoveEffectiveness(player, groundMove())).toBe(1);
  });

  test("without Desert Spirit, a Flying foe is immune (0x) to Ground", async () => {
    game.override.ability(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    expect(enemy.getMoveEffectiveness(player, groundMove())).toBe(0);
  });
});
