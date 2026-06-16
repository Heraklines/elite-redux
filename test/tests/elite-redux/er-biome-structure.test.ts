import {
  erInLateGameZone,
  erIsBiomeEnd,
  erRollBiomeLength,
  erShouldRaiseCrossroads,
  getErBiomeLength,
  getErBiomeStartWave,
  resetErBiomeStructure,
  restoreErBiomeStructure,
  setErLeaveBiomeNow,
  wavesSinceEnteredBiome,
} from "#data/elite-redux/er-biome-structure";
import { BiomeId } from "#enums/biome-id";
import { beforeEach, describe, expect, it } from "vitest";

// ER #486 - variable biome length + the every-5 Crossroads structure layer.
// The critical property under test is FINALE SAFETY: the variable path must
// never reach the late game, so the classic wave-200 END biome / finale align
// exactly as vanilla.
describe("ER #486 - variable biome length / structure", () => {
  beforeEach(() => {
    resetErBiomeStructure();
    // Pure unit test (no Phaser game): provide a standalone seeded RNG for the
    // length roll so randSeedIntRange is deterministic.
    Phaser.Math.RND = new Phaser.Math.RandomDataGenerator(["er-biome-structure-test"]);
  });

  it("starts on the vanilla cadence (no rolled length)", () => {
    expect(getErBiomeLength()).toBeNull();
    expect(erIsBiomeEnd(10)).toBeNull(); // null = fall back to vanilla %10
  });

  it("rolls a length in the single [7, 25] range, re-rolled per entry (#504)", () => {
    erRollBiomeLength(BiomeId.PLAINS, 1);
    const len = getErBiomeLength();
    expect(len).not.toBeNull();
    expect(len!).toBeGreaterThanOrEqual(7);
    expect(len!).toBeLessThanOrEqual(25);
    expect(getErBiomeStartWave()).toBe(1);
  });

  it("all biomes roll the same [7, 25] range (#504 dropped per-biome bands)", () => {
    for (const biome of [BiomeId.PLAINS, BiomeId.CAVE, BiomeId.GRASS, BiomeId.TOWN]) {
      erRollBiomeLength(biome, 1);
      const len = getErBiomeLength()!;
      expect(len).toBeGreaterThanOrEqual(7);
      expect(len).toBeLessThanOrEqual(25);
    }
  });

  it("computes waves spent in the biome", () => {
    erRollBiomeLength(BiomeId.GRASS, 11); // entered on wave 11
    expect(wavesSinceEnteredBiome(11)).toBe(1);
    expect(wavesSinceEnteredBiome(15)).toBe(5);
  });

  it("ends the biome once the rolled length is spent", () => {
    erRollBiomeLength(BiomeId.GRASS, 11);
    const len = getErBiomeLength()!;
    const endWave = 11 + len - 1;
    expect(erIsBiomeEnd(endWave - 1)).toBe(false);
    expect(erIsBiomeEnd(endWave)).toBe(true);
  });

  it("Crossroads ticks every 5 waves spent, but not on the ending wave", () => {
    erRollBiomeLength(BiomeId.GRASS, 1);
    // erShouldRaiseCrossroads offers "stay" on each %5 tick strictly before the
    // rolled length (the ending wave is never a crossroads).
    const len = getErBiomeLength()!;
    for (let w = 1; w < 1 + len - 1; w++) {
      const spent = w; // startWave 1 -> spent == waveIndex
      const expectTick = spent % 5 === 0 && spent < len;
      expect(erShouldRaiseCrossroads(w)).toBe(expectTick);
    }
    // The final wave (biome end) is never a crossroads.
    expect(erShouldRaiseCrossroads(1 + len - 1)).toBe(false);
  });

  it("Move on (leaveBiomeNow) forces the biome to end immediately", () => {
    erRollBiomeLength(BiomeId.GRASS, 11);
    expect(erIsBiomeEnd(12)).toBe(false);
    setErLeaveBiomeNow();
    expect(erIsBiomeEnd(12)).toBe(true);
  });

  // ---- FINALE SAFETY (critical) ----

  it("disables variable length inside the late-game zone (>= 170)", () => {
    expect(erInLateGameZone(169)).toBe(false);
    expect(erInLateGameZone(170)).toBe(true);
    expect(erInLateGameZone(190)).toBe(true);
    expect(erInLateGameZone(200)).toBe(true);
  });

  it("does NOT roll a variable length for a biome that could straddle into the late zone", () => {
    // A biome entered at 150 with a max length (25) would reach 174 (>=170): it
    // must fall back to the vanilla cadence (null length).
    erRollBiomeLength(BiomeId.CAVE, 150);
    expect(getErBiomeLength()).toBeNull();
  });

  it("a biome safely below the late zone still rolls a length", () => {
    erRollBiomeLength(BiomeId.PLAINS, 100); // worst case 100+25-1 = 124 < 170
    expect(getErBiomeLength()).not.toBeNull();
  });

  it("erIsBiomeEnd returns null (vanilla %10) for every late-game wave", () => {
    // Even with a stale rolled length / leave flag, the late zone is vanilla.
    erRollBiomeLength(BiomeId.GRASS, 100);
    setErLeaveBiomeNow();
    for (let w = 170; w <= 200; w++) {
      expect(erIsBiomeEnd(w)).toBeNull();
    }
  });

  it("never raises a Crossroads in the late zone", () => {
    erRollBiomeLength(BiomeId.GRASS, 100);
    for (let w = 170; w <= 200; w++) {
      expect(erShouldRaiseCrossroads(w)).toBe(false);
    }
  });

  // ---- save/restore (additive, defensive) ----

  it("restores length + start wave from a save", () => {
    restoreErBiomeStructure(15, 23);
    expect(getErBiomeLength()).toBe(15);
    expect(getErBiomeStartWave()).toBe(23);
  });

  it("tolerates missing / malformed save fields (older saves)", () => {
    restoreErBiomeStructure(undefined, undefined);
    expect(getErBiomeLength()).toBeNull();
    expect(getErBiomeStartWave()).toBe(1);
    restoreErBiomeStructure(null, null);
    expect(getErBiomeLength()).toBeNull();
    expect(getErBiomeStartWave()).toBe(1);
  });
});
