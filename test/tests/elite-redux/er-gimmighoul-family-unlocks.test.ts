/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Gholdengo must share Gimmighoul's candy and three innate unlock slots. ER also
// imports Roaming Gimmighoul as a standalone custom species; because it evolves
// to Gholdengo too, the generic prevolution rebuild used to make that later edge
// win and split Gholdengo into the custom species' starter-data bucket.

import { pokemonPrevolutions, pokemonStarters } from "#balance/pokemon-evolutions";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { isSlotActive, unlockSlot } from "#utils/passive-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("Gimmighoul family candy and innate unlock ownership", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .moveset([MoveId.ASTONISH, MoveId.TACKLE, MoveId.PROTECT, MoveId.REST])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  it("uses vanilla Gimmighoul as Gholdengo's canonical starter root", () => {
    expect(pokemonPrevolutions[SpeciesId.GHOLDENGO]).toBe(SpeciesId.GIMMIGHOUL);
    expect(pokemonStarters[SpeciesId.GHOLDENGO]).toBe(SpeciesId.GIMMIGHOUL);
    expect(game.scene.gameData.getRootStarterSpeciesId(SpeciesId.GHOLDENGO)).toBe(SpeciesId.GIMMIGHOUL);
    expect(game.scene.gameData.getStarterDataEntry(SpeciesId.GHOLDENGO)).toBe(
      game.scene.gameData.getStarterDataEntry(SpeciesId.GIMMIGHOUL),
    );
  });

  it("carries Gimmighoul candy and all three innate unlocks onto Gholdengo", async () => {
    const rootEntry = game.scene.gameData.getStarterDataEntry(SpeciesId.GIMMIGHOUL);
    rootEntry.candyCount = 37;
    rootEntry.passiveAttr = unlockSlot(unlockSlot(unlockSlot(0, 0), 1), 2);

    await game.classicMode.startBattle(SpeciesId.GHOLDENGO);
    const gholdengo = game.scene.getPlayerPokemon()!;
    const evolvedEntry = game.scene.gameData.getStarterDataEntry(SpeciesId.GHOLDENGO);

    expect(evolvedEntry).toBe(rootEntry);
    expect(evolvedEntry.candyCount).toBe(37);
    for (const slot of [0, 1, 2] as const) {
      expect(isSlotActive(gholdengo.innateSlotPassiveAttr(slot), slot)).toBe(true);
      expect(gholdengo.canApplyAbility(true, slot)).toBe(true);
    }
  });

  it("heals a pre-fix Gholdengo bucket into Gimmighoul without losing progress", () => {
    const gd = game.scene.gameData;
    const root = gd.getStarterDataEntry(SpeciesId.GIMMIGHOUL);
    root.candyCount = 5;
    root.passiveAttr = unlockSlot(0, 0);
    gd.starterData[SpeciesId.GHOLDENGO] = {
      moveset: null,
      eggMoves: 0,
      candyCount: 7,
      friendship: 0,
      abilityAttr: 0,
      passiveAttr: unlockSlot(0, 2),
      valueReduction: 0,
      classicWinCount: 0,
    };

    (gd as unknown as { consolidateStarterDataToRoots: () => void }).consolidateStarterDataToRoots();

    expect(gd.starterData[SpeciesId.GIMMIGHOUL].candyCount).toBe(12);
    expect(isSlotActive(gd.starterData[SpeciesId.GIMMIGHOUL].passiveAttr, 0)).toBe(true);
    expect(isSlotActive(gd.starterData[SpeciesId.GIMMIGHOUL].passiveAttr, 2)).toBe(true);
    expect(gd.starterData[SpeciesId.GHOLDENGO]).toBeUndefined();
  });
});
