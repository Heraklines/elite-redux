/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER biome shop/economy identities (#439 §3, second batch):
//   Wasteland          - the every-wave shop sells NO healing.
//   Construction Site  - one EXTRA reward slot per battle (4 instead of 3).
// ER_SCENARIO=1.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { BiomeId } from "#enums/biome-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { getPlayerShopModifierTypeOptionsForWave } from "#modifiers/modifier-type";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** The reward-slot count for a fresh reward phase in the CURRENT biome. */
function rewardSlotCount(): number {
  const phase = new SelectModifierPhase() as unknown as { getModifierCount(): number };
  return phase.getModifierCount();
}

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER biome shop/economy effects (#439 §3)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingWave(3) // a non-x0 wild wave (the standard heal shop row applies)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .enemyLevel(1)
      .startingLevel(100);
  });

  afterEach(() => vi.restoreAllMocks());

  // ---- Wasteland: no-heal shop -------------------------------------------
  it("Wasteland sells NO healing in the every-wave shop; Plains does", async () => {
    game.override.startingBiome(BiomeId.WASTELAND);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    // The whole vanilla shop row is heals/revives/cures, so it is empty here.
    expect(getPlayerShopModifierTypeOptionsForWave(11, 1000), "Wasteland shop has no heal row").toEqual([]);
  }, 120_000);

  it("control: Plains DOES sell healing in the every-wave shop", async () => {
    game.override.startingBiome(BiomeId.PLAINS);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    expect(
      getPlayerShopModifierTypeOptionsForWave(11, 1000).length,
      "Plains keeps the normal heal row",
    ).toBeGreaterThan(0);
  }, 120_000);

  // ---- Construction Site: one extra reward slot --------------------------
  // The reward count is computed by SelectModifierPhase.getModifierCount, which
  // adds the biome's extraRewardSlots. Base is 3 (no relics held), so Construction
  // yields 4 and Plains yields 3.
  it("Construction Site offers one extra reward slot (4 instead of 3)", async () => {
    game.override.startingBiome(BiomeId.CONSTRUCTION_SITE);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    expect(game.scene.arena.biomeId).toBe(BiomeId.CONSTRUCTION_SITE);
    expect(rewardSlotCount(), "Construction Site adds a 4th reward slot").toBe(4);
  }, 120_000);

  it("control: Plains offers the base 3 reward slots", async () => {
    game.override.startingBiome(BiomeId.PLAINS);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    expect(game.scene.arena.biomeId).toBe(BiomeId.PLAINS);
    expect(rewardSlotCount(), "Plains has the base 3 reward slots").toBe(3);
  }, 120_000);
});
