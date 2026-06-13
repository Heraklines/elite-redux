/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #451 - Wishiwashi Schooling is a HP-gated FORM CHANGE (not an evolution):
// with the Schooling ability and level >= 20, it is in School form (1) while
// above 1/4 HP and reverts to Solo form (0) at or below 1/4 HP. Below level 20
// it stays Solo regardless. These tests pin that mechanic under the ER build.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const SOLO_FORM = 0;
const SCHOOL_FORM = 1;

describe("ER - Wishiwashi Schooling HP form change (#451)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .ability(AbilityId.SCHOOLING)
      .moveset([MoveId.SPLASH])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(30);
  });

  it("is in School form on summon at full HP and level >= 20", async () => {
    await game.classicMode.startBattle(SpeciesId.WISHIWASHI);
    const w = game.field.getPlayerPokemon();
    // The Schooling ability's PostSummon form change uses the same predicate as
    // its PostTurn revert (level < 20 || HP <= 1/4 -> Solo, else School). At
    // level 30 / full HP it qualifies for School form (1).
    expect(w.getAbility().id).toBe(AbilityId.SCHOOLING);
    expect(w.formIndex).toBe(SCHOOL_FORM);
  });

  it("stays Solo below level 20 even at full HP", async () => {
    game.override.startingLevel(10);
    await game.classicMode.startBattle(SpeciesId.WISHIWASHI);
    const w = game.field.getPlayerPokemon();
    expect(w.formIndex).toBe(SOLO_FORM);
  });
});
