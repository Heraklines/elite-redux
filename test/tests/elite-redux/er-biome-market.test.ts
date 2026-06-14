/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #440 - Biome Market: boss (x0) waves fill the previously-empty shop area
// with biome-priced stock. Stock must be non-empty, deterministic per wave,
// and priced on the wave-income curve. ER_SCENARIO=1 gated.
// =============================================================================

import { ER_BIOME_ECONOMY, rollErBiomeShopStock } from "#data/elite-redux/er-biome-economy";
import { AbilityId } from "#enums/ability-id";
import { BiomeId } from "#enums/biome-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { getPlayerShopModifierTypeOptionsForWave } from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Biome Market (#440)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH);
  });

  it("x0 waves stock a non-empty, deterministic, positively-priced market", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const biome = game.scene.arena.biomeId;
    const a = rollErBiomeShopStock(biome, 10);
    const b = rollErBiomeShopStock(biome, 10);
    expect(a.length).toBeGreaterThanOrEqual(4);
    expect(a.map(s => s.key)).toEqual(b.map(s => s.key));
    for (const slot of a) {
      expect(slot.cost).toBeGreaterThan(0);
      expect(slot.cost % 10).toBe(0);
    }
    // #440: NO healing items in the biome market - it must read as a distinct
    // shop, not the vanilla potion store. The HEAL category is excluded from
    // stock entirely (healing stays the normal-wave shop's job).
    const HEAL_KEYS = new Set([
      "POTION",
      "SUPER_POTION",
      "HYPER_POTION",
      "MAX_POTION",
      "FULL_HEAL",
      "FULL_RESTORE",
      "REVIVE",
      "MAX_REVIVE",
      "SACRED_ASH",
    ]);
    for (const slot of a) {
      expect(HEAL_KEYS.has(slot.key)).toBe(false);
    }
    // The shop hook resolves the stock into purchasable options - but ONLY when
    // asked for the biome shop (the dedicated BiomeShopPhase passes forBiomeShop).
    const options = getPlayerShopModifierTypeOptionsForWave(10, 0, /* forBiomeShop */ true);
    expect(options.length).toBeGreaterThanOrEqual(4);
    for (const opt of options) {
      expect(opt.cost).toBeGreaterThan(0);
      expect(opt.type).toBeTruthy();
    }
    // Non-boss waves keep the vanilla shop path untouched.
    expect(getPlayerShopModifierTypeOptionsForWave(11, 1000).length).toBeGreaterThan(0);
  });

  it("does NOT leak biome stock into the vanilla x0 shop row (unlimited-buy exploit)", async () => {
    // Reported exploit: after the market, the vanilla reward screen's shop row
    // showed the SAME biome items - and that row has no per-slot stock cap, so
    // they could be re-bought endlessly. The vanilla callers omit forBiomeShop,
    // so on a boss (x0) wave they must get an EMPTY shop row (vanilla skips the
    // shop entirely on boss waves; only the BiomeShopPhase shows the market).
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    expect(getPlayerShopModifierTypeOptionsForWave(10, 1000)).toEqual([]);
    // The dedicated biome-shop path still has stock on the same wave.
    expect(getPlayerShopModifierTypeOptionsForWave(10, 1000, true).length).toBeGreaterThanOrEqual(4);
  });

  it("the Abyss has no market; every other biome has an economy entry", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    expect(rollErBiomeShopStock(BiomeId.ABYSS, 10)).toEqual([]);
    expect(ER_BIOME_ECONOMY[BiomeId.ABYSS]?.noShop).toBe(true);
    for (const biome of Object.keys(ER_BIOME_ECONOMY)) {
      const eco = ER_BIOME_ECONOMY[Number(biome) as BiomeId]!;
      expect(eco.priceMod).toBeGreaterThanOrEqual(0.6);
      expect(eco.priceMod).toBeLessThanOrEqual(1.6);
    }
  });
});
