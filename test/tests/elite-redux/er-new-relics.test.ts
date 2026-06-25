/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER relics batch (#130) - FOCUSED EFFECT TESTS. The pure relic hooks (damage
// mults, reroll/slot economy, map reveal, notoriety slow-down, payout coin flip)
// asserted against a held relic, plus combat-effect repros (Momentum Engine speed,
// Stormglass weather) on the headless GameManager. The save ROUND-TRIP for these
// relics lives in er-new-relics-save.test.ts (a pure, no-game-init file - it must
// stay separate so its stub globalScene never collides with this file's real one).
//
// Gated behind ER_SCENARIO=1, like the other combat relic tests.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { erNotorietyBstBonus, erNotorietyItemRateMult } from "#data/elite-redux/er-biome-notoriety";
import { erMarkBiomeStay, erRollBiomeLength, resetErBiomeStructure } from "#data/elite-redux/er-biome-structure";
import {
  erBloodPactDealMultiplier,
  erBloodPactTakeMultiplier,
  erCartographersLensExtraNodes,
  erGamblersCoinPayoutMultiplier,
  erMerchantsSealExtraSlots,
  erMerchantsSealRerollMultiplier,
  erMomentumEngineOnEnemyKo,
  erStormglassApplyChosenWeather,
  erTrailblazerLootMultiplier,
  erTrailblazerOverstayScale,
  getStormglassWeather,
  setStormglassWeather,
} from "#data/elite-redux/er-relics";
import { BiomeId } from "#enums/biome-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import { ErRelicModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER new relics (#130) - effects", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.GYARADOS);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Grant a relic to the player by its registry key (the off-pool grant path). */
  function grantRelic(key: keyof typeof modifierTypes): ErRelicModifier {
    const mod = (modifierTypes[key] as () => ReturnType<typeof modifierTypes.ER_RELIC_CURSED_IDOL>)().newModifier() as
      | ErRelicModifier
      | undefined;
    expect(mod, key).toBeInstanceOf(ErRelicModifier);
    globalScene.addModifier(mod!, true, false, false, true);
    return mod!;
  }

  describe("Blood Pact", () => {
    it("multipliers are 1 with no relic, +20% deal / +15% take while held", () => {
      expect(erBloodPactDealMultiplier()).toBe(1);
      expect(erBloodPactTakeMultiplier()).toBe(1);

      grantRelic("ER_RELIC_BLOOD_PACT");
      expect(erBloodPactDealMultiplier()).toBeCloseTo(1.2, 5);
      expect(erBloodPactTakeMultiplier()).toBeCloseTo(1.15, 5);
    });

    it("the +20% deal multiplier feeds the real damage calc (player attacker only)", () => {
      // getAttackDamage multiplies the player attacker's damage by erBloodPactDealMultiplier()
      // and the player defender's by erBloodPactTakeMultiplier() (see pokemon.ts). Verify the
      // relic toggles both off/on, the contract the damage calc consumes.
      grantRelic("ER_RELIC_BLOOD_PACT");
      const lead = globalScene.getPlayerField()[0];
      const enemy = globalScene.getEnemyPokemon()!;
      // Player is an attacker -> deal bonus applies; enemy is the attacker on the
      // player -> the player-defender take bonus applies. (Both are team-wide flat.)
      expect(lead.isPlayer()).toBe(true);
      expect(enemy.isPlayer()).toBe(false);
      expect(erBloodPactDealMultiplier()).toBeCloseTo(1.2, 5);
      expect(erBloodPactTakeMultiplier()).toBeCloseTo(1.15, 5);
    });
  });

  describe("Momentum Engine", () => {
    it("an enemy KO queues a +1 Speed StatStageChangePhase on the active player mon", () => {
      grantRelic("ER_RELIC_MOMENTUM_ENGINE");
      const lead = globalScene.getPlayerField()[0];
      const spy = vi.spyOn(globalScene.phaseManager, "unshiftNew");

      // Drive the relic's KO hook directly (the FaintPhase enemy-branch call site).
      erMomentumEngineOnEnemyKo();

      // It enqueues a StatStageChangePhase for the lead's battler index, +1 Speed.
      expect(spy).toHaveBeenCalledWith("StatStageChangePhase", lead.getBattlerIndex(), true, [Stat.SPD], 1);
    });

    it("does nothing when the relic isn't held", () => {
      const spy = vi.spyOn(globalScene.phaseManager, "unshiftNew");
      erMomentumEngineOnEnemyKo();
      expect(spy).not.toHaveBeenCalledWith("StatStageChangePhase", expect.anything(), expect.anything(), [Stat.SPD], 1);
    });
  });

  describe("Stormglass", () => {
    it("applies the player's chosen weather for 5 turns at battle start", () => {
      grantRelic("ER_RELIC_STORMGLASS");
      setStormglassWeather(WeatherType.RAIN);
      expect(getStormglassWeather()).toBe(WeatherType.RAIN);

      // Clear any ambient weather, then run the battle-start apply hook.
      globalScene.arena.trySetWeather(WeatherType.NONE);
      erStormglassApplyChosenWeather();

      expect(globalScene.arena.weather?.weatherType).toBe(WeatherType.RAIN);
      expect(globalScene.arena.weather?.turnsLeft).toBe(5);
      expect(globalScene.arena.weather?.maxDuration).toBe(5);
    });

    it("does nothing when the relic isn't held", () => {
      globalScene.arena.trySetWeather(WeatherType.NONE);
      erStormglassApplyChosenWeather();
      expect(globalScene.arena.weather?.weatherType ?? WeatherType.NONE).toBe(WeatherType.NONE);
    });
  });

  describe("Cartographer's Lens", () => {
    it("reveals one extra onward map node while held", () => {
      expect(erCartographersLensExtraNodes()).toBe(0);
      grantRelic("ER_RELIC_CARTOGRAPHERS_LENS");
      expect(erCartographersLensExtraNodes()).toBe(1);
    });
  });

  describe("Trailblazer's Mark", () => {
    it("halves the notoriety overstay scale and boosts over-stayed loot", () => {
      expect(erTrailblazerOverstayScale()).toBe(1);
      expect(erTrailblazerLootMultiplier(5)).toBe(1);

      grantRelic("ER_RELIC_TRAILBLAZERS_MARK");
      expect(erTrailblazerOverstayScale()).toBe(0.5);
      expect(erTrailblazerLootMultiplier(5)).toBe(1.5);
      expect(erTrailblazerLootMultiplier(0)).toBe(1); // only when over-stayed
    });

    it("notoriety BST ramp builds slower with the relic than without, at the same wave", () => {
      // Arm a deliberate overstay: enter a biome at wave 1, linger past the 10-wave
      // free window, choose to stay at wave 21, then read the ramp at wave 31 (10
      // overstay waves = the +100 BST ceiling without the relic).
      resetErBiomeStructure();
      erRollBiomeLength(BiomeId.PLAINS, 1);
      erMarkBiomeStay(21);
      const sampleWave = 31;

      // No relic yet (fresh game this test) -> full ramp.
      expect(erTrailblazerOverstayScale()).toBe(1);
      const unscaledBst = erNotorietyBstBonus(sampleWave);
      expect(unscaledBst).toBeGreaterThan(0);

      // Grant the relic -> the SAME overstay now ramps to a strictly lower bonus.
      grantRelic("ER_RELIC_TRAILBLAZERS_MARK");
      expect(erTrailblazerOverstayScale()).toBe(0.5);
      const scaledBst = erNotorietyBstBonus(sampleWave);
      expect(scaledBst).toBeLessThan(unscaledBst);
    });

    it("notoriety item-rate gets the Trailblazer loot multiplier while over-stayed", () => {
      resetErBiomeStructure();
      erRollBiomeLength(BiomeId.PLAINS, 1);
      erMarkBiomeStay(21);
      grantRelic("ER_RELIC_TRAILBLAZERS_MARK");
      // Over-stayed at wave 31 -> the item-rate getter folds in the 1.5x loot bonus.
      expect(erNotorietyItemRateMult(31)).toBeGreaterThan(1);
    });
  });

  describe("Merchant's Seal", () => {
    it("halves the reroll cost and adds one reward slot while held", () => {
      expect(erMerchantsSealRerollMultiplier()).toBe(1);
      expect(erMerchantsSealExtraSlots()).toBe(0);

      grantRelic("ER_RELIC_MERCHANTS_SEAL");
      expect(erMerchantsSealRerollMultiplier()).toBe(0.5);
      expect(erMerchantsSealExtraSlots()).toBe(1);
    });
  });

  describe("Gambler's Coin", () => {
    it("is a no-op (1x) when the relic isn't held", () => {
      expect(erGamblersCoinPayoutMultiplier()).toBe(1);
    });

    it("doubles the payout on a winning seeded flip", () => {
      grantRelic("ER_RELIC_GAMBLERS_COIN");
      // Distinct wave so the per-wave roll cache (module-scoped, persists across
      // tests) doesn't carry over from a sibling test.
      globalScene.currentBattle.waveIndex = 41;
      // Force the per-wave coin flip to "win" (< 50): randBattleSeedInt -> 0.
      vi.spyOn(globalScene, "randBattleSeedInt").mockReturnValue(0);
      expect(erGamblersCoinPayoutMultiplier()).toBe(2);
    });

    it("loses the payout (0x) on a losing seeded flip", () => {
      grantRelic("ER_RELIC_GAMBLERS_COIN");
      // Distinct wave (vs the winning-flip test) so the cached roll doesn't bleed.
      globalScene.currentBattle.waveIndex = 42;
      // Force the per-wave coin flip to "lose" (>= 50): randBattleSeedInt -> 99.
      vi.spyOn(globalScene, "randBattleSeedInt").mockReturnValue(99);
      expect(erGamblersCoinPayoutMultiplier()).toBe(0);
    });

    it("caches the roll per wave (stable across rerolls within a wave)", () => {
      grantRelic("ER_RELIC_GAMBLERS_COIN");
      globalScene.currentBattle.waveIndex = 43;
      const spy = vi.spyOn(globalScene, "randBattleSeedInt").mockReturnValue(0);
      const first = erGamblersCoinPayoutMultiplier();
      const second = erGamblersCoinPayoutMultiplier();
      expect(second).toBe(first); // same wave -> same result
      expect(spy).toHaveBeenCalledTimes(1); // rolled once, then cached
    });
  });
});
