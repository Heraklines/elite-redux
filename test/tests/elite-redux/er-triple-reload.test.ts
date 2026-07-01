/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Reloading a Triples Only battle mid-fight must restore ALL THREE player field slots (and the
// triple arrangement), not just the leftmost lead ("1v3" bug). ER_SCENARIO=1.

import { globalScene } from "#app/global-scene";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { Challenges } from "#enums/challenges";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER triple reload", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleType(BattleType.WILD)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .startingLevel(50)
      .enemyLevel(50);
  });

  it("restores all 3 player field slots after reload", async () => {
    game.challengeMode.addChallenge(Challenges.TRIPLES_ONLY, 1, 0);
    await game.challengeMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE);
    expect(globalScene.getPlayerField().filter(p => p.isOnField())).toHaveLength(3); // 3v3 before reload

    await game.reload.reloadSession();

    // Bug: only the LEFT lead came back ("1v3"). All three player field slots must be restored.
    expect(globalScene.currentBattle.arrangement.playerCapacity).toBe(3);
    expect(globalScene.getPlayerField().filter(p => p.isOnField())).toHaveLength(3);
    expect(globalScene.getEnemyField().filter(p => p.isOnField())).toHaveLength(3);
  });
});
