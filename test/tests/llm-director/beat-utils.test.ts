import type { TrainerBattleBeat } from "#data/llm-director/beat-schema";
import { buildTrainerOverride } from "#phases/llm-director-beat-utils";
import { describe, expect, it } from "vitest";

const baseTrainerBeat = (overrides: Partial<TrainerBattleBeat> = {}): TrainerBattleBeat => ({
  beatId: "t1",
  type: "trainer_battle",
  introText: "x",
  trainerName: "Rival",
  trainerType: 0,
  preBattleText: "x",
  postWinText: "x",
  ...overrides,
});

describe("buildTrainerOverride", () => {
  it("clamps levelDelta to ±3 and folds it into the override", () => {
    const beat = baseTrainerBeat({ levelDelta: 99 });
    const override = buildTrainerOverride(beat, { recentFaints: 0 });
    expect(override).not.toBeNull();
    expect(override?.atWaveOffset).toBe(1);
    expect(override?.trainerOverride?.levelDelta).toBe(3);
  });

  it("trims species swaps beyond 2 via the balance rails", () => {
    const beat = baseTrainerBeat({ speciesSwaps: [1, 2, 3, 4, 5] });
    const override = buildTrainerOverride(beat, { recentFaints: 0 });
    expect(override?.trainerOverride?.speciesSwaps).toEqual([1, 2]);
  });

  it("denies brutal upgrade when player has recent faints", () => {
    const beat = baseTrainerBeat({ levelDelta: 10, difficultyTag: "brutal" });
    const override = buildTrainerOverride(beat, { recentFaints: 3 });
    expect(override?.trainerOverride?.levelDelta).toBe(3);
  });

  it("returns null when the beat has no overrideable fields", () => {
    const beat = baseTrainerBeat();
    expect(buildTrainerOverride(beat, { recentFaints: 0 })).toBeNull();
  });
});
