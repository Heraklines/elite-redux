/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Bug repro (tester): "Flygon Redux B and Flygon Redux B Mega have two separate
// Candy counts" - the Mega is a battle FORM of its base but ER builds it as a
// standalone custom species (pk 10760) with no prevolution, so getRootSpeciesId
// returned itself and its starterData (candy/passive/ability) pooled under a
// SEPARATE bucket. Fix: erMegaTargetToBaseSpeciesId resolves a mega-target id to
// its base, consulted in getStarterDataEntry (new candy pools on the base) and
// consolidateStarterDataToRoots (an already-split save heals to base = X+Y).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { erMegaTargetToBaseSpeciesId } from "#data/elite-redux/er-generic-pool-bans";
import { ErSpeciesId } from "#enums/er-species-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const BASE = ErSpeciesId.FLYGON_REDUX_B; // 10759
const MEGA = ErSpeciesId.FLYGON_REDUX_B_MEGA; // 10760

describe("ER mega candy merge (Flygon Redux B Mega shares its base's candy)", () => {
  beforeAll(() => {
    // Boots init (ER_ID_MAP + the gameData instance). No battle.
    void new GameManager(new Phaser.Game({ type: Phaser.HEADLESS }));
  });

  it("resolves a mega-target custom id to its base, and nothing else", () => {
    expect(erMegaTargetToBaseSpeciesId(MEGA)).toBe(BASE);
    // The base itself is not a mega target.
    expect(erMegaTargetToBaseSpeciesId(BASE)).toBeUndefined();
    // Vanilla species are never remapped.
    expect(erMegaTargetToBaseSpeciesId(SpeciesId.PIKACHU)).toBeUndefined();
    expect(erMegaTargetToBaseSpeciesId(SpeciesId.FLYGON)).toBeUndefined();
  });

  it("getStarterDataEntry pools the Mega onto the SAME bucket as its base", () => {
    const gd = globalScene.gameData;
    // Same object reference => candy/passive/ability all share one bucket.
    expect(gd.getStarterDataEntry(MEGA)).toBe(gd.getStarterDataEntry(BASE));
  });

  it("consolidate heals an already-split save (base X + mega Y => base X+Y, stray gone)", () => {
    const gd = globalScene.gameData;
    // Simulate a pre-fix save: a standalone Mega bucket with its own candy.
    gd.getStarterDataEntry(BASE).candyCount = 5;
    gd.starterData[MEGA] = {
      moveset: null,
      eggMoves: 0,
      candyCount: 7,
      friendship: 0,
      abilityAttr: 0,
      passiveAttr: 0,
      valueReduction: 0,
      classicWinCount: 0,
    };

    // consolidateStarterDataToRoots is private; bracket access keeps it unit-testable.
    (gd as unknown as { consolidateStarterDataToRoots: () => void }).consolidateStarterDataToRoots();

    expect(gd.starterData[BASE].candyCount).toBe(12);
    expect(gd.starterData[MEGA]).toBeUndefined();

    // Idempotent: a second pass is a no-op (no stray left to double-count).
    (gd as unknown as { consolidateStarterDataToRoots: () => void }).consolidateStarterDataToRoots();
    expect(gd.starterData[BASE].candyCount).toBe(12);
  });
});
