/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER achievement rewards (Phase 1 infra). grantErAchievementReward(achvId)
// applies the mapped reward to the system save: CLASSIC_VICTORY -> candy to each
// team member (scaled by difficulty) + 2 Rare eggs. Verifies the grant lands on
// the save and that an unmapped id is a no-op (so cosmetic-only achievements stay
// cosmetic). The no-retroactive / one-time property is enforced by validateAchv's
// achvUnlocks dedupe (existing, tested) calling this only on a first unlock.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { grantErAchievementReward } from "#data/elite-redux/er-achievement-rewards";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER achievement rewards — grant on unlock", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("CLASSIC_VICTORY grants candy to every team member + 2 Rare eggs", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR, SpeciesId.CHARMANDER);
    const gd = game.scene.gameData;
    const party = game.scene.getPlayerParty();
    const roots = party.map(m => m.species.getRootSpeciesId());
    const candyBefore = roots.map(r => gd.starterData[r]?.candyCount ?? 0);
    const eggsBefore = gd.eggs.length;

    grantErAchievementReward("CLASSIC_VICTORY");

    // candy-to-team: every mon that finished the run gained candy.
    roots.forEach((r, i) => {
      expect(gd.starterData[r]?.candyCount ?? 0).toBeGreaterThan(candyBefore[i]);
    });
    // 2 Rare eggs were added.
    expect(gd.eggs.length).toBe(eggsBefore + 2);
  });

  it("an unmapped achievement id is a no-op (no throw, no grant)", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    const gd = game.scene.gameData;
    const eggsBefore = gd.eggs.length;

    grantErAchievementReward("__NOT_AN_ACHIEVEMENT__");

    expect(gd.eggs.length).toBe(eggsBefore);
  });

  it("INFERNO (apex on Hell) grants exactly one black shiny to the save", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    const gd = game.scene.gameData;
    const before = Object.values(gd.starterData).filter(s => s.erBlackShiny).length;

    grantErAchievementReward("INFERNO");

    const after = Object.values(gd.starterData).filter(s => s.erBlackShiny).length;
    expect(after).toBe(before + 1);
  });

  it("INFERNO's random black shiny is UNSEEDED (varies with Math.random, not the fixed battle seed)", async () => {
    // Bug: the reward used the battle-seeded RNG, which is at an identical reset state across
    // players when an achievement unlocks, so EVERY player rolled the same species (Scorbunny).
    // The pick now uses Math.random, so a different roll yields a different black shiny.
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    const gd = game.scene.gameData;
    const blackShinyKeys = () =>
      new Set(
        Object.entries(gd.starterData)
          .filter(([, s]) => s.erBlackShiny)
          .map(([k]) => k),
      );

    const grantWith = (rand: number): string | undefined => {
      const before = blackShinyKeys();
      const spy = vi.spyOn(Math, "random").mockReturnValue(rand);
      grantErAchievementReward("INFERNO");
      spy.mockRestore();
      return [...blackShinyKeys()].find(k => !before.has(k));
    };

    const first = grantWith(0); // pool[0]
    const second = grantWith(0.97); // a far-apart index -> a different species
    // Before the fix the seeded pick ignored Math.random entirely and handed both the SAME species.
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });
});
