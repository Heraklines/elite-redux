/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Bug repro (tester): "Liquid Voice turns ALL sound moves into Water-type, not
// just Normal-type sound moves." ER Liquid Voice (dex 218): "Sound moves get a
// 1.2x boost and become Water if Normal." So ONLY Normal-type sound moves convert
// to Water; non-Normal sound moves keep their type (and every sound move gets the
// 1.2x boost). The old port converted EVERY sound move to Water.
// =============================================================================

import { allAbilities, allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("ER Liquid Voice — only Normal-type sound moves become Water", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .ability(AbilityId.LIQUID_VOICE)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH]);
  });

  test("the ability carries BOTH the type-change and the 1.2x sound boost", () => {
    const names = allAbilities[AbilityId.LIQUID_VOICE].attrs.map(a => a.constructor.name);
    expect(names).toContain("MoveTypeChangeAbAttr");
    expect(names).toContain("MovePowerBoostAbAttr");
  });

  test("Normal-type sound moves (Hyper Voice, Boomburst) become Water", async () => {
    await game.classicMode.startBattle(SpeciesId.EXPLOUD);
    const player = game.field.getPlayerPokemon();
    expect(player.getMoveType(allMoves[MoveId.HYPER_VOICE])).toBe(PokemonType.WATER);
    expect(player.getMoveType(allMoves[MoveId.BOOMBURST])).toBe(PokemonType.WATER);
  });

  test("non-Normal sound moves KEEP their type (the bug: they used to turn Water)", async () => {
    await game.classicMode.startBattle(SpeciesId.EXPLOUD);
    const player = game.field.getPlayerPokemon();
    expect(player.getMoveType(allMoves[MoveId.BUG_BUZZ])).toBe(PokemonType.BUG);
    expect(player.getMoveType(allMoves[MoveId.SNARL])).toBe(PokemonType.DARK);
  });

  test("a Normal NON-sound move (Tackle) is untouched", async () => {
    await game.classicMode.startBattle(SpeciesId.EXPLOUD);
    const player = game.field.getPlayerPokemon();
    expect(player.getMoveType(allMoves[MoveId.TACKLE])).toBe(PokemonType.NORMAL);
  });
});
