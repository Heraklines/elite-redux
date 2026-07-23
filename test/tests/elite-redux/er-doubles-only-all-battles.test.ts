/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER (#8): the Doubles Only challenge used to force doubles ONLY in TRAINER
// battles - wild and mystery-encounter waves stayed single (reported "event
// won't allow doubles"). It now forces doubles in every regular battle (wild +
// trainer), exactly like co-op; the finale / endless-boss / ME edge cases stay
// single. Since every battle is then already a double, lures (which only boost
// the double CHANCE) are stripped from the reward pool, like co-op - otherwise
// they'd be dead reward slots.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { Challenges } from "#enums/challenges";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { SpeciesId } from "#enums/species-id";
import { DoubleBattleChanceBoosterModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import { getModifierPoolForType } from "#utils/modifier-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("ER Doubles Only challenge - forces doubles in all regular battles", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.challengeMode.addChallenge(Challenges.DOUBLES_ONLY, 1, 1);
    game.override.startingWave(5).enemySpecies(SpeciesId.MAGIKARP);
  });

  it("makes a WILD battle a double battle (was single without the fix)", async () => {
    await game.challengeMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.FEEBAS);
    expect(globalScene.currentBattle.double).toBe(true);
    expect(globalScene.getEnemyField()).toHaveLength(2);
  });

  it("remains a 2v2 after reloading the active battle", async () => {
    await game.challengeMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.FEEBAS);
    await game.reload.reloadSession();

    expect(globalScene.currentBattle.double).toBe(true);
    expect(globalScene.currentBattle.arrangement.playerCapacity).toBe(2);
    expect(globalScene.currentBattle.arrangement.enemyCapacity).toBe(2);
    expect(globalScene.getPlayerField().filter(p => p.isOnField())).toHaveLength(2);
    expect(globalScene.getEnemyField().filter(p => p.isOnField())).toHaveLength(2);
  });

  it("strips lures from the reward pool (every battle is already double)", async () => {
    await game.challengeMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.FEEBAS);

    const party = globalScene.getPlayerParty();
    const lureWeights = Object.values(getModifierPoolForType(ModifierPoolType.PLAYER))
      .flat()
      .filter(m => m.modifierType?.constructor?.name === "DoubleBattleChanceBoosterModifierType")
      .map(m => (typeof m.weight === "function" ? m.weight(party, 0) : m.weight));

    expect(lureWeights.length).toBeGreaterThan(0); // the lure entries do exist in the pool
    expect(lureWeights.every(w => w === 0)).toBe(true); // ...but all weigh 0 under DOUBLES_ONLY
    expect(globalScene.findModifier(mod => mod instanceof DoubleBattleChanceBoosterModifier)).toBeUndefined();
  });
});
