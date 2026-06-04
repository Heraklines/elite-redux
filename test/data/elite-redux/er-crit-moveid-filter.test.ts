/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Validates the per-move-id crit-stage filter added for Giant Shuriken
// ("Water Shuriken ... +1 crit").

import { allMoves } from "#data/data-lists";
import { CritStageBonusAbAttr } from "#data/elite-redux/archetypes/crit-mod";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("ER crit-stage move-id filter", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.SHUCKLE)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH]);
  });

  test("matchesFilter gates the bonus to the configured move ids", async () => {
    await game.classicMode.startBattle(SpeciesId.GRENINJA);
    const player = game.field.getPlayerPokemon();
    const filter = { moveIds: [MoveId.WATER_SHURIKEN] };
    expect(CritStageBonusAbAttr.matchesFilter(filter, player, allMoves[MoveId.WATER_SHURIKEN])).toBe(true);
    expect(CritStageBonusAbAttr.matchesFilter(filter, player, allMoves[MoveId.TACKLE])).toBe(false);
  });
});
