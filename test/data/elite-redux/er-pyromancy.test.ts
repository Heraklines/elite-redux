/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Pyromancy — multiplies the BURN chance of burn-inflicting moves by 5x, and
// does NOT add burn to moves that never burned.

import { allMoves } from "#data/data-lists";
import type { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("ER Ability - Pyromancy", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .ability(ErAbilityId.PYROMANCY as unknown as AbilityId)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.EMBER, MoveId.TACKLE]);
  });

  test("Ember's 10% burn becomes 50%; Tackle gains no burn", async () => {
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    const ember = allMoves[MoveId.EMBER];
    const emberStatus = ember.getAttrs("StatusEffectAttr")[0];
    expect(emberStatus.getMoveChance(player, enemy, ember)).toBe(50);

    // Tackle has no burn effect — the multiplier must not invent one.
    const tackle = allMoves[MoveId.TACKLE];
    expect(tackle.getAttrs("StatusEffectAttr").length).toBe(0);
  });
});
