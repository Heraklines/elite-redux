/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Regression for the in-game "3v1": a TRIPLE that stages a 3-mon enemy party
// (setPendingDevEnemyParty, as the dev scenario does) must field all THREE foes.
// The enemy-gen loop is bounded by enemyLevels.length, which a small trainer party
// (or a wild override) could leave < the enemy capacity; encounter-phase now pads it
// up to enemyCapacity so every staged mon is generated. ER_SCENARIO=1.

import { setPendingDevEnemyParty } from "#app/dev-tools/registry";
import { globalScene } from "#app/global-scene";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER triple - a staged 3-mon enemy party fields three foes", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("triple").ability(AbilityId.BALL_FETCH).startingLevel(80).enemyLevel(80);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fields all three staged enemies (not 3v1)", async () => {
    setPendingDevEnemyParty([
      { speciesId: SpeciesId.GARCHOMP, level: 80, moveIds: [MoveId.EARTHQUAKE] },
      { speciesId: SpeciesId.SYLVEON, level: 80, moveIds: [MoveId.HYPER_VOICE] },
      { speciesId: SpeciesId.METAGROSS, level: 80, moveIds: [MoveId.METEOR_MASH] },
    ]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE);

    expect(globalScene.currentBattle.arrangement.enemyCapacity).toBe(3);
    expect(globalScene.getEnemyField(true).length).toBe(3);
    // The enemy level array was padded to at least the enemy capacity.
    expect(globalScene.currentBattle.enemyLevels?.length).toBeGreaterThanOrEqual(3);
  });
});
