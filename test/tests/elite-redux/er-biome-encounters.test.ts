import {
  erBiomeBossChancePct,
  erBiomeBossEveryWave,
  erBiomeEventRateMult,
  erBiomeForcedBossBars,
  erBiomeSkipFallback,
  erBiomeTrainerRateMult,
  erBiomeWaveSkipChance,
  getErBiomeEncounter,
} from "#data/elite-redux/er-biome-encounters";
import { BiomeId } from "#enums/biome-id";
import { describe, expect, it } from "vitest";

/**
 * Per-biome encounter composition (event/trainer/boss weights + Desert skip).
 * All knobs default to vanilla, so a biome with no entry returns the neutral
 * value. See docs/plans/2026-06-18-biome-encounter-item-design.md §6.
 */
describe("er-biome-encounters (composition table)", () => {
  it("returns a config for tuned biomes and undefined for vanilla ones", () => {
    expect(getErBiomeEncounter(BiomeId.GRAVEYARD)).toBeDefined();
    // FOREST/POWER_PLANT keep vanilla composition (their identity is elsewhere).
    expect(getErBiomeEncounter(BiomeId.FOREST)).toBeUndefined();
  });

  describe("event-rate multiplier", () => {
    it("makes haunted/ancient biomes event-heavy (>1)", () => {
      expect(erBiomeEventRateMult(BiomeId.GRAVEYARD)).toBeGreaterThan(1);
      expect(erBiomeEventRateMult(BiomeId.RUINS)).toBeGreaterThan(1);
    });

    it("makes quiet biomes event-light (<1)", () => {
      expect(erBiomeEventRateMult(BiomeId.SEA)).toBeLessThan(1);
      expect(erBiomeEventRateMult(BiomeId.PLAINS)).toBeLessThan(1);
    });

    it("defaults to 1x for an untuned biome", () => {
      expect(erBiomeEventRateMult(BiomeId.FOREST)).toBe(1);
    });
  });

  describe("trainer-rate multiplier", () => {
    it("is denser in Metropolis and sparser in Desert", () => {
      expect(erBiomeTrainerRateMult(BiomeId.METROPOLIS)).toBeGreaterThan(1);
      expect(erBiomeTrainerRateMult(BiomeId.DESERT)).toBeLessThan(1);
      expect(erBiomeTrainerRateMult(BiomeId.WASTELAND)).toBeLessThan(1);
    });

    it("defaults to 1x", () => {
      expect(erBiomeTrainerRateMult(BiomeId.POWER_PLANT)).toBe(1);
    });
  });

  describe("boss composition", () => {
    it("gives boss-heavy biomes a high flat %, caves a moderate one", () => {
      expect(erBiomeBossChancePct(BiomeId.VOLCANO)).toBeGreaterThanOrEqual(50);
      expect(erBiomeBossChancePct(BiomeId.CAVE)).toBe(25);
      expect(erBiomeBossChancePct(BiomeId.PLAINS)).toBe(0);
    });

    it("makes ONLY the Wasteland an every-wave boss gauntlet with a 2-3 bar toss-up", () => {
      expect(erBiomeBossEveryWave(BiomeId.WASTELAND)).toBe(true);
      expect(erBiomeForcedBossBars(BiomeId.WASTELAND)).toEqual([2, 3]);
      expect(erBiomeBossEveryWave(BiomeId.VOLCANO)).toBe(false);
      expect(erBiomeForcedBossBars(BiomeId.VOLCANO)).toBeUndefined();
    });
  });

  describe("Desert skip", () => {
    it("skips a chunk of Desert waves and skews the rest to event/boss", () => {
      expect(erBiomeWaveSkipChance(BiomeId.DESERT)).toBeGreaterThan(0);
      expect(erBiomeSkipFallback(BiomeId.DESERT)).toEqual({ event: 60, boss: 40 });
    });

    it("is off for non-skip biomes", () => {
      expect(erBiomeWaveSkipChance(BiomeId.GRAVEYARD)).toBe(0);
      expect(erBiomeSkipFallback(BiomeId.GRAVEYARD)).toBeUndefined();
    });
  });
});
