import {
  erBiomeJustEnteredAfterWave,
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

  it("pins a biome entry's structural length to the run seed, independent of the ambient RNG cursor", () => {
    erRollBiomeLength(BiomeId.PLAINS, 1, "replayable-run");
    const first = getErBiomeLength();
    Phaser.Math.RND.integerInRange(0, 1_000_000);
    Phaser.Math.RND.integerInRange(0, 1_000_000);
    erRollBiomeLength(BiomeId.PLAINS, 1, "replayable-run");
    expect(getErBiomeLength()).toBe(first);
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

  // Regression: weather/terrain skipped on World-Map biome changes (Beach report).
  // isNewBiome is consulted twice across the SwitchBiomePhase boundary; by the
  // second read (doPostBattleCleanup, which picks the encounter phase) SwitchBiomePhase
  // has already rolled the NEW biome forward via erRollBiomeLength(next, clearedWave+1),
  // so a raw erIsBiomeEnd(clearedWave) reads "0 waves in -> not an end" and the new
  // biome's weather/terrain never set. erBiomeJustEnteredAfterWave restores the truth.
  it("post-switch: detects the cleared wave as a biome end (new-biome weather fix)", () => {
    // In Grass, ending at wave 16.
    erRollBiomeLength(BiomeId.GRASS, 11);
    // Player clears wave 16; SwitchBiomePhase enters Beach starting wave 17.
    erRollBiomeLength(BiomeId.BEACH, 17);
    // Raw erIsBiomeEnd about the cleared wave now lies (0 waves into Beach):
    expect(erIsBiomeEnd(16)).toBe(false);
    // ...but the post-switch signal correctly says wave 16 ended a biome:
    expect(erBiomeJustEnteredAfterWave(16)).toBe(true);
    // And it must NOT fire for any other wave (no false biome ends mid-biome):
    expect(erBiomeJustEnteredAfterWave(17)).toBe(false); // first wave of Beach
    expect(erBiomeJustEnteredAfterWave(20)).toBe(false); // mid Beach
    expect(erBiomeJustEnteredAfterWave(15)).toBe(false); // a prior wave
  });

  it("post-switch signal is inert mid-biome (no spurious new-biome detection)", () => {
    erRollBiomeLength(BiomeId.GRASS, 11); // start wave 11
    // For every wave at/after the start, the start can never equal wave+1.
    for (let w = 11; w <= 30; w++) {
      expect(erBiomeJustEnteredAfterWave(w)).toBe(false);
    }
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
