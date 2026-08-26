/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { isSlotActive, unlockSlot } from "#utils/passive-utils";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("Raichu family innate unlock ownership", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("reads Raichu innate unlocks from the canonical Pichu starter bucket", async () => {
    const game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    const rootEntry = game.scene.gameData.getStarterDataEntry(SpeciesId.PICHU);
    rootEntry.passiveAttr = unlockSlot(unlockSlot(unlockSlot(0, 0), 1), 2);

    await game.classicMode.startBattle(SpeciesId.RAICHU);
    const raichu = game.scene.getPlayerPokemon()!;

    expect(game.scene.gameData.getRootStarterSpeciesId(SpeciesId.RAICHU)).toBe(SpeciesId.PICHU);
    for (const slot of [0, 1, 2] as const) {
      expect(isSlotActive(raichu.innateSlotPassiveAttr(slot), slot)).toBe(true);
      expect(raichu.canApplyAbility(true, slot)).toBe(true);
    }
  });
});
