import {
  erBiomeOverstay,
  erHasNotoriety,
  erNotorietyBossChancePct,
  erNotorietyBstBonus,
  erNotorietyItemRateMult,
  erNotorietyOverLevel,
  erNotorietyTrainerChancePct,
  NOTORIETY_FREE_WAVES,
  NOTORIETY_MAX_BST_BONUS,
  NOTORIETY_MAX_OVER_LEVEL,
} from "#data/elite-redux/er-biome-notoriety";
import { erRollBiomeLength, resetErBiomeStructure } from "#data/elite-redux/er-biome-structure";
import { BiomeId } from "#enums/biome-id";
import { beforeEach, describe, expect, it } from "vitest";

// ER #504 - biome NOTORIETY math. The critical property is the INVARIANT: every
// getter is a pure function of the per-biome wave position, so changing biome
// (which re-rolls the start wave) drops notoriety back to 0 and the global curve
// resumes exactly.
describe("ER #504 - biome notoriety / overstay escalation", () => {
  beforeEach(() => {
    resetErBiomeStructure();
    Phaser.Math.RND = new Phaser.Math.RandomDataGenerator(["er-biome-notoriety-test"]);
  });

  /** Enter a biome at `startWave` so wavesSinceEnteredBiome reflects overstay. */
  function enterBiomeAt(startWave: number): void {
    erRollBiomeLength(BiomeId.CAVE, startWave);
  }

  it("no overstay within the free window (first 10 in-biome waves)", () => {
    enterBiomeAt(1);
    for (let w = 1; w <= NOTORIETY_FREE_WAVES; w++) {
      expect(erBiomeOverstay(w)).toBe(0);
      expect(erHasNotoriety(w)).toBe(false);
    }
  });

  it("overstay grows by one per wave past the free window", () => {
    enterBiomeAt(1);
    expect(erBiomeOverstay(11)).toBe(1);
    expect(erBiomeOverstay(15)).toBe(5);
    expect(erBiomeOverstay(20)).toBe(10);
    expect(erHasNotoriety(11)).toBe(true);
  });

  it("BST bonus is 0 inside the free window, climbs to +100, then HOLDS", () => {
    enterBiomeAt(1);
    expect(erNotorietyBstBonus(10)).toBe(0); // last free wave
    expect(erNotorietyBstBonus(11)).toBeGreaterThan(0);
    expect(erNotorietyBstBonus(15)).toBeLessThan(NOTORIETY_MAX_BST_BONUS);
    expect(erNotorietyBstBonus(20)).toBe(NOTORIETY_MAX_BST_BONUS); // +10 over -> ceiling
    expect(erNotorietyBstBonus(30)).toBe(NOTORIETY_MAX_BST_BONUS); // holds
  });

  it("over-level is 0 in the free window and caps at the ceiling", () => {
    enterBiomeAt(1);
    expect(erNotorietyOverLevel(10)).toBe(0);
    expect(erNotorietyOverLevel(11)).toBeGreaterThan(0);
    expect(erNotorietyOverLevel(20)).toBe(NOTORIETY_MAX_OVER_LEVEL);
    expect(erNotorietyOverLevel(40)).toBe(NOTORIETY_MAX_OVER_LEVEL);
  });

  it("boss chance ramps: ~33% -> ~50% -> 100% by full notoriety", () => {
    enterBiomeAt(1);
    expect(erNotorietyBossChancePct(10)).toBe(0); // free window
    expect(erNotorietyBossChancePct(13)).toBe(33); // 3 over
    expect(erNotorietyBossChancePct(17)).toBe(50); // 7 over
    expect(erNotorietyBossChancePct(20)).toBe(100); // 10 over -> every wave
    expect(erNotorietyBossChancePct(25)).toBe(100);
  });

  it("trainer chance ramps up but never exceeds 100", () => {
    enterBiomeAt(1);
    expect(erNotorietyTrainerChancePct(10)).toBe(0);
    expect(erNotorietyTrainerChancePct(13)).toBeGreaterThan(0);
    expect(erNotorietyTrainerChancePct(20)).toBeLessThanOrEqual(100);
    expect(erNotorietyTrainerChancePct(20)).toBeGreaterThanOrEqual(erNotorietyTrainerChancePct(13));
  });

  it("item-rate multiplier is 1 in the free window, > 1 over, capped at 3", () => {
    enterBiomeAt(1);
    expect(erNotorietyItemRateMult(10)).toBe(1);
    expect(erNotorietyItemRateMult(11)).toBeGreaterThan(1);
    expect(erNotorietyItemRateMult(50)).toBeLessThanOrEqual(3);
  });

  // ---- THE INVARIANT: changing biome resets notoriety ----

  it("changing biome (re-roll start wave) drops notoriety to 0 - global curve resumes", () => {
    // Over-stay a biome entered at wave 1: at wave 20 notoriety is maxed.
    enterBiomeAt(1);
    expect(erNotorietyBstBonus(20)).toBe(NOTORIETY_MAX_BST_BONUS);
    expect(erNotorietyBossChancePct(20)).toBe(100);

    // Now LEAVE the biome: the next biome's first battle is wave 21, entered at 21.
    enterBiomeAt(21);
    // Same global wave (21) - but now it is the FRESH biome's wave 1: no overstay,
    // no BST bonus, no boss inflation. Exactly a fresh run at wave 21.
    expect(erBiomeOverstay(21)).toBe(0);
    expect(erNotorietyBstBonus(21)).toBe(0);
    expect(erNotorietyOverLevel(21)).toBe(0);
    expect(erNotorietyBossChancePct(21)).toBe(0);
    expect(erNotorietyItemRateMult(21)).toBe(1);
  });

  it("notoriety is disabled in the late-game zone (finale safety)", () => {
    // A biome that falls back to the vanilla cadence (null length) near the finale
    // still reports zero notoriety in the late zone regardless of wave position.
    enterBiomeAt(160);
    expect(erBiomeOverstay(175)).toBe(0);
    expect(erNotorietyBstBonus(180)).toBe(0);
    expect(erNotorietyBossChancePct(190)).toBe(0);
  });
});
