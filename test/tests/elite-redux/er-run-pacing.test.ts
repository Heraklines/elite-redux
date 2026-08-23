import { getGameMode } from "#app/game-mode";
import {
  erExtraRivalTypeForWave,
  erForcesTrainerWave,
  erSprintForcedTrainerSlots,
} from "#data/elite-redux/er-battle-frequency";
import {
  erInLateGameZone,
  getErBiomeLength,
  planErBiomeStructure,
  resetErBiomeStructure,
} from "#data/elite-redux/er-biome-structure";
import { ghostWavesForCurrentRun } from "#data/elite-redux/er-ghost-waves";
import { resetErDifficulty, setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import {
  addErSprintTrainerVoucherCredit,
  getErEarlyWaveMovePowerMultiplier,
  getErMysteryEncounterLegalWaves,
  getErProgressionWave,
  getErSprintVoucherCredit,
  getErStorySourceWave,
  isErChapterStartWave,
  isErCheckpointWave,
  isErSprintMode,
  resetErRunPacing,
  resetErSprintVoucherCredit,
  setErRunPacing,
} from "#data/elite-redux/er-run-pacing";
import { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { TrainerType } from "#enums/trainer-type";
import { sprintFixedBattles } from "#trainers/fixed-battle-configs";
import { afterEach, describe, expect, it } from "vitest";

describe("Classic Sprint pacing", () => {
  afterEach(() => {
    resetErRunPacing();
    resetErDifficulty();
  });

  it("keeps real run waves while doubling progression and ending at 100", () => {
    setErRunPacing("sprint");
    const mode = getGameMode(GameModes.CLASSIC);
    expect(getErProgressionWave(1)).toBe(2);
    expect(getErProgressionWave(50)).toBe(100);
    expect(getErProgressionWave(100)).toBe(200);
    expect(mode.isWaveFinal(99)).toBe(false);
    expect(mode.isWaveFinal(100)).toBe(true);
  });

  it("applies the same Sprint profile to Challenge runs", () => {
    setErRunPacing("sprint");
    const mode = getGameMode(GameModes.CHALLENGE);
    expect(isErSprintMode(GameModes.CHALLENGE)).toBe(true);
    expect(mode.getWaveForDifficulty(50)).toBe(100);
    expect(mode.isBoss(5)).toBe(true);
    expect(mode.isWaveFinal(100)).toBe(true);
    expect(mode.getMysteryEncounterLegalWaves()).toEqual([1, 90]);
  });

  it("leaves Normal Classic pacing unchanged", () => {
    const mode = getGameMode(GameModes.CLASSIC);
    expect(getErProgressionWave(50)).toBe(50);
    expect(mode.isBoss(5)).toBe(false);
    expect(mode.isBoss(10)).toBe(true);
    expect(mode.isWaveFinal(100)).toBe(false);
    expect(mode.isWaveFinal(200)).toBe(true);
  });

  it("ramps move power from 40% to full power at the pacing-specific cap", () => {
    expect(getErEarlyWaveMovePowerMultiplier(1)).toBe(0.4);
    expect(getErEarlyWaveMovePowerMultiplier(15)).toBeCloseTo(0.689655);
    expect(getErEarlyWaveMovePowerMultiplier(30)).toBe(1);
    expect(getErEarlyWaveMovePowerMultiplier(80)).toBe(1);

    setErRunPacing("sprint");
    expect(getErEarlyWaveMovePowerMultiplier(1)).toBe(0.4);
    expect(getErEarlyWaveMovePowerMultiplier(8)).toBe(0.7);
    expect(getErEarlyWaveMovePowerMultiplier(15)).toBe(1);
    expect(getErEarlyWaveMovePowerMultiplier(80)).toBe(1);
  });

  it("keeps the fixed Sprint gym schedule regardless of the normal offset flag", () => {
    setErRunPacing("sprint");
    const mode = getGameMode(GameModes.CLASSIC);
    for (const wave of [10, 25, 40, 55, 70, 85]) {
      expect(mode.isTrainerBoss(wave, BiomeId.TOWN, false)).toBe(true);
      expect(mode.isTrainerBoss(wave, BiomeId.TOWN, true)).toBe(true);
    }
    expect(mode.isTrainerBoss(15, BiomeId.TOWN, true)).toBe(false);
  });

  it("uses five-wave chapters and a 1-90 mystery window", () => {
    setErRunPacing("sprint");
    expect([5, 10, 95, 100].every(isErCheckpointWave)).toBe(true);
    expect([1, 6, 96].every(isErChapterStartWave)).toBe(true);
    expect(isErCheckpointWave(6)).toBe(false);
    expect(getErMysteryEncounterLegalWaves()).toEqual([1, 90]);
  });

  it("maps every compressed story battle to its authored Classic identity", () => {
    setErRunPacing("sprint");
    const expected = [3, 4, 13, 18, 28, 31, 32, 33, 48, 56, 57, 58, 73, 82, 83, 91, 92, 93, 94, 95, 98];
    expect(Object.keys(sprintFixedBattles).map(Number)).toEqual(expected);
    expect(getErStorySourceWave(4)).toBe(8);
    expect(getErStorySourceWave(83)).toBe(165);
    expect(getErStorySourceWave(95)).toBe(190);
  });

  it("uses Sprint-specific Elite and Hell trainer chapters", () => {
    setErRunPacing("sprint");
    setErDifficulty("elite");
    expect(erForcesTrainerWave(3)).toBe(true);
    expect(erForcesTrainerWave(2)).toBe(false);
    expect(erExtraRivalTypeForWave(22)).toBe(TrainerType.RIVAL_2);

    setErDifficulty("hell");
    expect([2, 3, 4].every(erForcesTrainerWave)).toBe(true);
    expect(erForcesTrainerWave(1)).toBe(false);
    expect(erExtraRivalTypeForWave(8)).toBe(TrainerType.RIVAL);
  });

  it("lets authored trainer fights consume the chapter quota", () => {
    setErRunPacing("sprint");
    setErDifficulty("elite");
    expect(erSprintForcedTrainerSlots([])).toEqual([3]);
    expect(erSprintForcedTrainerSlots([2])).toEqual([]);

    setErDifficulty("hell");
    expect(erSprintForcedTrainerSlots([])).toEqual([2, 3, 4]);
    expect(erSprintForcedTrainerSlots([1])).toEqual([2, 3]);
    expect(erSprintForcedTrainerSlots([1, 2, 3])).toEqual([]);
  });

  it("uses the collision-free Sprint ghost schedules", () => {
    setErRunPacing("sprint");
    setErDifficulty("elite");
    expect(ghostWavesForCurrentRun()).toEqual([44, 69, 79, 84, 96, 99]);
    setErDifficulty("hell");
    expect(ghostWavesForCurrentRun()).toEqual([34, 44, 54, 59, 69, 79, 84, 88, 89, 96, 97, 99]);
  });

  it("rolls chapter-aligned biome stints and enters finale routing at 85", () => {
    setErRunPacing("sprint");
    resetErBiomeStructure();
    for (let wave = 1; wave <= 80; wave += 5) {
      const plan = planErBiomeStructure(wave, `sprint-${wave}`);
      if (plan.length != null) {
        expect([5, 10, 15]).toContain(plan.length);
      }
    }
    expect(planErBiomeStructure(75, "sprint-75").length).toBeLessThanOrEqual(10);
    expect(planErBiomeStructure(80, "sprint-80").length).toBe(5);
    expect(planErBiomeStructure(85, "sprint-85").length).toBeNull();
    expect(erInLateGameZone(84)).toBe(false);
    expect(erInLateGameZone(85)).toBe(true);
    expect(getErBiomeLength()).toBeNull();
  });

  it("keeps legacy fractional voucher credit readable for old saves only", () => {
    setErRunPacing("sprint");
    resetErSprintVoucherCredit();
    expect(addErSprintTrainerVoucherCredit("ace")).toBe(0);
    expect(getErSprintVoucherCredit()).toBe(0.5);
    expect(addErSprintTrainerVoucherCredit("ace")).toBe(1);
    expect(getErSprintVoucherCredit()).toBe(0);
    expect(addErSprintTrainerVoucherCredit("hell")).toBe(1);
    expect(getErSprintVoucherCredit()).toBe(0.5);
    expect(addErSprintTrainerVoucherCredit("hell")).toBe(2);
    expect(getErSprintVoucherCredit()).toBe(0);
  });
});
