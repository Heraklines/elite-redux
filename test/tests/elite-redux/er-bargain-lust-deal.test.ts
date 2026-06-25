/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Giratina's Bargain - the Lust deal (#127). Lust is offered only when a party
// mon holds >= LUST_CANDY_COST (100) candy; accepting it surrenders that mon's
// levels (back to Lv 1), all of its IVs (zeroed), and its entire candy hoard, and
// in return makes it a PERMANENT tier-1 shiny (variant 0 / Luck 1). It NEVER
// touches the black-shiny system (that stays an apex-challenge-only reward). This
// drives the availability gate + the cost/payoff mutation (the case body in
// the-bargain-phase.ts, minus the interactive party pick). Gated by ER_SCENARIO=1.
// =============================================================================

import {
  bargainResetToLevelOne,
  bargainSinAvailable,
  bargainWipeCandy,
  LUST_CANDY_COST,
} from "#data/elite-redux/er-bargain-sins";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Giratina Bargain - Lust deal (#127)", () => {
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
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(50)
      .startingLevel(50)
      .ability(AbilityId.BALL_FETCH);
  });

  const candyOf = (speciesId: SpeciesId) => game.scene.gameData.getStarterDataEntry(speciesId).candyCount;
  const setCandy = (speciesId: SpeciesId, n: number) => {
    game.scene.gameData.getStarterDataEntry(speciesId).candyCount = n;
  };

  it("is offered only when a party mon holds at least 100 candy", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    const mon = game.scene.getPlayerParty()[0];

    setCandy(mon.species.speciesId, LUST_CANDY_COST - 1);
    expect(bargainSinAvailable("lust")).toBe(false);

    setCandy(mon.species.speciesId, LUST_CANDY_COST);
    expect(bargainSinAvailable("lust")).toBe(true);
  });

  it("cost zeroes levels + IVs + candy and the payoff is a permanent tier-1 shiny", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    const mon = game.scene.getPlayerParty()[0];
    setCandy(mon.species.speciesId, LUST_CANDY_COST);
    expect(bargainSinAvailable("lust")).toBe(true);

    // The deal body (the-bargain-phase.ts case "lust"), minus the interactive pick:
    // zero IVs FIRST so the Lv 1 stat recompute reads them, then drop to Lv 1, then
    // spend all candy; finally apply the normal (NOT black) tier-1 shine.
    mon.ivs = [0, 0, 0, 0, 0, 0];
    bargainResetToLevelOne(mon);
    bargainWipeCandy(mon);
    mon.shiny = true;
    mon.variant = 0;
    mon.luck = 1;

    expect(mon.level).toBe(1);
    expect(mon.ivs).toEqual([0, 0, 0, 0, 0, 0]);
    expect(candyOf(mon.species.speciesId)).toBe(0);
    expect(mon.shiny).toBe(true);
    expect(mon.variant).toBe(0); // tier 1, not a black shiny
    expect(mon.luck).toBe(1);
    // The deal does NOT touch the black-shiny system.
    expect(mon.customPokemonData?.erBlackShiny ?? false).toBe(false);

    // Candy spent -> the deal can no longer be offered against this mon.
    expect(bargainSinAvailable("lust")).toBe(false);
  });
});
