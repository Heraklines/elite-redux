/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Multi-form ER families (Arceus's type plates, Silvally, Ogerpon masks, …) each
// ship as a separate egg-pool species, so collectively they'd appear N× and
// dominate. getErEggWeightDivisor down-weights each form by its family size so
// the whole family totals ≈ one normal mon. These tests pin: a real multi-form
// family resolves to a divisor == its size; a single-form custom stays at 1.
// =============================================================================

import { speciesEggTiers } from "#balance/species-egg-tiers";
import { getErEggWeightDivisor } from "#data/elite-redux/init-elite-redux-egg-tiers";
import type { EggTier } from "#enums/egg-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const VANILLA_ID_CUTOFF = 10000;
const WOOLY_WORM = 10067; // single-form custom

describe("ER egg multi-form family down-weighting", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  it("a multi-form family resolves to a divisor equal to its egg-eligible size", () => {
    const tiers = speciesEggTiers as Record<number, EggTier | undefined>;
    const erIds = Object.keys(tiers)
      .map(Number)
      .filter(id => id >= VANILLA_ID_CUTOFF && tiers[id] !== undefined);

    // The largest divisor in the pool must be a genuine multi-form family (>1),
    // and every member of that family must report the same divisor == size.
    const divisors = erIds.map(id => getErEggWeightDivisor(id));
    const maxDivisor = Math.max(...divisors);
    console.log(`[egg-family] largest multi-form family size = ${maxDivisor}`);
    expect(maxDivisor).toBeGreaterThan(1);

    const biggestFamily = erIds.filter(id => getErEggWeightDivisor(id) === maxDivisor);
    expect(biggestFamily.length).toBe(maxDivisor);
  });

  it("a single-form custom (Wooly Worm) has divisor 1; vanilla ids are 1", () => {
    expect(getErEggWeightDivisor(WOOLY_WORM)).toBe(1);
    expect(getErEggWeightDivisor(1)).toBe(1); // vanilla Bulbasaur
  });
});
