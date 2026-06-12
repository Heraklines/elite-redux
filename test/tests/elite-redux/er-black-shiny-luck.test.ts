/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER (#432): Black Shinies grant a flat LUCK 5 (regular shinies cap at 3 via
// variant+1). The value is DERIVED in Pokemon.getLuck() from the existing
// customPokemonData.erBlackShiny flag - nothing stored changes, so old saves
// pick the new luck up automatically and nothing can corrupt.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("ER #432 - Black Shiny luck is 5", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.enemySpecies(SpeciesId.MAGIKARP).enemyAbility(AbilityId.BALL_FETCH).ability(AbilityId.BALL_FETCH);
  });

  it("a black shiny reads Luck 5; a plain mon keeps its normal luck", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.scene.getPlayerPokemon()!;
    const plainLuck = player.getLuck();
    expect(plainLuck).toBeLessThanOrEqual(3);

    player.customPokemonData.erBlackShiny = true;
    expect(player.getLuck()).toBe(5);

    player.customPokemonData.erBlackShiny = false;
    expect(player.getLuck()).toBe(plainLuck);
  });
});
