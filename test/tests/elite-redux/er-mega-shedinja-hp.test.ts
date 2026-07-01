/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - Shedinja (every form, including ER's Mega Shedinja) always has
// exactly 1 HP - its whole identity. Base Shedinja gets this via Wonder Guard,
// but Mega Shedinja's kit (Cheating Death / Magic Guard) REPLACES Wonder Guard,
// so it fell through to the normal HP formula: base HP 1 still yields ~95 at
// level 64 (floor((2+31)*64/100)+64+10 = 95 - the reported value). The 1-HP rule
// now keys on the Shedinja species line too, not only Wonder Guard.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Mega Shedinja - always 1 HP", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingLevel(64)
      .enemyLevel(64)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  it("Mega Shedinja has exactly 1 HP at level 64 (base Shedinja too; a normal mon does not)", async () => {
    await game.classicMode.startBattle(SpeciesId.SHEDINJA);
    const shedinja = game.field.getPlayerPokemon();

    // Base Shedinja: 1 HP via Wonder Guard (unchanged).
    expect(shedinja.getMaxHp()).toBe(1);

    // Switch to the Mega form (permanent in ER) and recompute its stats.
    const forms = getPokemonSpecies(SpeciesId.SHEDINJA).forms;
    const megaIndex = forms.findIndex(f => (f.formKey ?? "").includes("mega"));
    expect(megaIndex).toBeGreaterThanOrEqual(0);
    shedinja.formIndex = megaIndex;
    shedinja.calculateStats();

    // Mega Shedinja keeps the 1-HP identity (was ~95 before the fix).
    expect(shedinja.getMaxHp()).toBe(1);

    // Control: the level-64 Snorlax across from it is NOT forced to 1 HP.
    expect(game.field.getEnemyPokemon().getMaxHp()).toBeGreaterThan(1);
  });
});
