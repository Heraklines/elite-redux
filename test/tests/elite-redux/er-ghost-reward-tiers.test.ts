/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER (#217): a cross-player GHOST-team trainer victory rolls a per-victory reward
// TIER (60% Great, 30% Ultra, 10% Common) and sets it as the reward screen's
// `guaranteedModifierTiers` (BEFORE luck), reusing the rival/boss reward routine.
//
// This drives the exact reward-build seam VictoryPhase uses
// (buildErGhostRewardSettings) with a ghost-marked currentBattle.trainer, so it
// verifies BOTH the ghost detection AND the 60/30/10 tier distribution without
// having to fight an unpredictable (doubles / multi-mon) trainer to completion.
// A non-ghost trainer yields no guaranteed tiers. ER_SCENARIO=1.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { markTrainerAsGhost } from "#data/elite-redux/er-ghost-teams";
import { BattleType } from "#enums/battle-type";
import { ModifierTier } from "#enums/modifier-tier";
import { SpeciesId } from "#enums/species-id";
import { buildErGhostRewardSettings } from "#phases/victory-phase";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Minimal ghost snapshot so markTrainerAsGhost flags the live trainer. */
function ghostSnapshot() {
  return {
    id: "reward-tier-ghost",
    trainerName: "Ghost Tester",
    difficulty: "hell" as const,
    waveReached: 5,
    isVictory: false,
    timestamp: 0,
    party: [
      {
        speciesId: SpeciesId.MAGIKARP as number,
        formIndex: 0,
        abilityIndex: 0,
        ivs: [31, 31, 31, 31, 31, 31],
        nature: 0,
        level: 50,
        gender: 0,
        shiny: false,
        passive: false,
        variant: 0,
        moves: [],
      },
    ],
  };
}

describe.skipIf(!RUN)("ER ghost-trainer reward tiers (#217)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .battleType(BattleType.TRAINER)
      .startingWave(4) // a NON-x0 wave so the reward screen is the standard one
      .startingLevel(100)
      .enemyLevel(1)
      .criticalHits(false);
  });

  afterEach(() => vi.restoreAllMocks());

  it("a ghost-trainer victory sets guaranteedModifierTiers (the whole row at the rolled tier)", async () => {
    await game.classicMode.startBattle(SpeciesId.MACHAMP);
    const trainer = globalScene.currentBattle.trainer;
    expect(trainer, "the wave is a trainer battle").toBeTruthy();
    markTrainerAsGhost(trainer!, ghostSnapshot());

    const settings = buildErGhostRewardSettings();
    expect(settings, "a ghost trainer yields custom reward settings").toBeTruthy();
    const tiers = settings?.guaranteedModifierTiers;
    expect(tiers, "the ghost reward set guaranteedModifierTiers").toBeTruthy();
    expect(tiers!.length, "the whole base reward row (3 slots) is guaranteed").toBe(3);
    // One rolled tier fills the whole screen, and luck upgrades are NOT disabled
    // (allowLuckUpgrades is left default-true so luck still upgrades from there).
    expect(new Set(tiers!).size, "a single rolled tier for the whole screen").toBe(1);
    expect(settings?.allowLuckUpgrades, "luck still upgrades from the rolled tier").not.toBe(false);
  }, 120_000);

  it("the rolled tier is one of GREAT/ULTRA/COMMON and the distribution is ~60/30/10", async () => {
    await game.classicMode.startBattle(SpeciesId.MACHAMP);
    const trainer = globalScene.currentBattle.trainer!;
    markTrainerAsGhost(trainer, ghostSnapshot());

    const counts = new Map<ModifierTier, number>([
      [ModifierTier.GREAT, 0],
      [ModifierTier.ULTRA, 0],
      [ModifierTier.COMMON, 0],
    ]);
    const N = 400;
    for (let w = 1; w <= N; w++) {
      // The roll is seeded on the wave index, so vary it to sample the distribution.
      globalScene.currentBattle.waveIndex = w;
      const tier = buildErGhostRewardSettings()?.guaranteedModifierTiers?.[0];
      expect(tier, "every ghost victory produces a tier").toBeDefined();
      expect([ModifierTier.GREAT, ModifierTier.ULTRA, ModifierTier.COMMON]).toContain(tier!);
      counts.set(tier!, counts.get(tier!)! + 1);
    }
    const great = counts.get(ModifierTier.GREAT)! / N;
    const ultra = counts.get(ModifierTier.ULTRA)! / N;
    const common = counts.get(ModifierTier.COMMON)! / N;
    // ~60/30/10 with generous tolerance for the finite sample.
    expect(great, `GREAT share ${great}`).toBeGreaterThan(0.45);
    expect(great).toBeLessThan(0.75);
    expect(ultra, `ULTRA share ${ultra}`).toBeGreaterThan(0.18);
    expect(ultra).toBeLessThan(0.42);
    expect(common, `COMMON share ${common}`).toBeGreaterThan(0.02);
    expect(common).toBeLessThan(0.2);
  }, 120_000);

  it("a NON-ghost trainer victory does NOT set the ghost guaranteed tiers", async () => {
    await game.classicMode.startBattle(SpeciesId.MACHAMP);
    expect(globalScene.currentBattle.trainer, "the wave is a trainer battle").toBeTruthy();
    // Deliberately do NOT mark the trainer as a ghost.
    expect(buildErGhostRewardSettings(), "no ghost reward settings on a normal trainer win").toBeUndefined();
  }, 120_000);

  it("a WILD victory (no trainer) does NOT set ghost reward tiers", async () => {
    game.override.battleType(BattleType.WILD);
    await game.classicMode.startBattle(SpeciesId.MACHAMP);
    expect(globalScene.currentBattle.trainer, "this wave is wild (no trainer)").toBeFalsy();
    expect(buildErGhostRewardSettings(), "wild victories never get ghost reward tiers").toBeUndefined();
  }, 120_000);
});
