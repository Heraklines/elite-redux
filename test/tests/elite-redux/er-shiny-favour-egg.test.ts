/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Regression test for the SHINY half of the egg-hatch / challenge-favour fix.
//
// Elite Redux grants a run-scoped "Favour" shiny multiplier (up to 3x) for the
// active challenges. That boost lives ONLY in Pokemon.trySetShiny. Eggs roll
// their shininess separately, at egg creation, via Egg.rollShiny() using fixed
// gacha rates and seeded RNG — they never go through trySetShiny. So a hatched
// Pokemon's shininess must be the egg's own pre-rolled value, completely
// independent of the run's challenge-favour multiplier (mirroring how egg-hatch
// candy excludes the favour bonus).
//
// These tests pin that invariant so a future change to trySetShiny / the egg
// path can't silently leak the run favour boost into egg hatches.

import { globalScene } from "#app/global-scene";
import { copyChallenge } from "#data/challenge";
import { Egg } from "#data/egg";
import { getRunShinyMultiplier } from "#data/elite-redux/er-shiny-favour";
import { Challenges } from "#enums/challenges";
import { EggSourceType } from "#enums/egg-source-types";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("ER shiny favour — egg hatches", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single");
  });

  /** Force a heavy favour-granting challenge onto the active run. */
  const activateHeavyFavour = (): void => {
    // HARDCORE grants 8 favour → 1 step → 1.5x shiny multiplier.
    globalScene.gameMode.challenges = [copyChallenge({ id: Challenges.HARDCORE, value: 1, severity: 1 })];
  };

  it("run favour DOES boost the shiny multiplier (sanity: the boost exists)", async () => {
    await game.classicMode.startBattle();
    expect(getRunShinyMultiplier()).toBe(1); // no challenge yet
    activateHeavyFavour();
    expect(getRunShinyMultiplier()).toBeCloseTo(1.5, 5);
  });

  it("a non-shiny egg stays non-shiny when hatched, even with max favour active", async () => {
    await game.classicMode.startBattle();
    activateHeavyFavour();
    // Even with the favour shiny multiplier maxed, it must not flip a non-shiny
    // egg to shiny — eggs never roll through the favour-boosted trySetShiny.
    globalScene.gameMode.challenges = [copyChallenge({ id: Challenges.HARDCORE, value: 1, severity: 1 })];

    const egg = new Egg({ scene: globalScene, isShiny: false, sourceType: EggSourceType.GACHA_MOVE });
    const hatched = egg.generatePlayerPokemon();

    expect(egg.isShiny).toBe(false);
    expect(hatched.shiny).toBe(false);
  });

  it("a shiny egg still hatches shiny under favour (egg's own roll is preserved)", async () => {
    await game.classicMode.startBattle();
    activateHeavyFavour();

    const egg = new Egg({ scene: globalScene, isShiny: true, sourceType: EggSourceType.GACHA_MOVE });
    const hatched = egg.generatePlayerPokemon();

    expect(egg.isShiny).toBe(true);
    expect(hatched.shiny).toBe(true);
  });

  it("egg shiny roll is identical with and without favour (favour does not enter Egg.rollShiny)", async () => {
    await game.classicMode.startBattle();

    // Roll the same egg (same fixed id → same seeded shiny roll) with no favour
    // and then with heavy favour. The favour multiplier is NOT consulted by
    // Egg.rollShiny, so the outcome must be byte-for-byte identical.
    const eggId = 123456;

    expect(getRunShinyMultiplier()).toBe(1);
    const withoutFavour = new Egg({ scene: globalScene, id: eggId, sourceType: EggSourceType.GACHA_MOVE }).isShiny;

    activateHeavyFavour();
    expect(getRunShinyMultiplier()).toBeGreaterThan(1);
    const withFavour = new Egg({ scene: globalScene, id: eggId, sourceType: EggSourceType.GACHA_MOVE }).isShiny;

    expect(withFavour).toBe(withoutFavour);
  });
});
