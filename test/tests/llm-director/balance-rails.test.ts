import { clampTrainerBattle } from "#data/llm-director/balance-rails";
import type { TrainerBattleBeat } from "#data/llm-director/beat-schema";
import { describe, expect, it } from "vitest";

const baseBeat = (overrides: Partial<TrainerBattleBeat> = {}): TrainerBattleBeat => ({
  beatId: "t1",
  type: "trainer_battle",
  introText: "x",
  trainerName: "Rival",
  trainerType: 0,
  preBattleText: "x",
  postWinText: "x",
  ...overrides,
});

describe("clampTrainerBattle", () => {
  it("clamps levelDelta to ±3 by default", () => {
    expect(clampTrainerBattle(baseBeat({ levelDelta: 99 }), { recentFaints: 0 }).levelDelta).toBe(3);
    expect(clampTrainerBattle(baseBeat({ levelDelta: -99 }), { recentFaints: 0 }).levelDelta).toBe(-3);
  });

  it("allows up to +10 when difficultyTag=brutal AND recentFaints==0", () => {
    expect(
      clampTrainerBattle(baseBeat({ levelDelta: 10, difficultyTag: "brutal" }), { recentFaints: 0 }).levelDelta,
    ).toBe(10);
  });

  it("clamps brutal+15 down to +10", () => {
    expect(
      clampTrainerBattle(baseBeat({ levelDelta: 15, difficultyTag: "brutal" }), { recentFaints: 0 }).levelDelta,
    ).toBe(10);
  });

  it("rolls back brutal to ±3 when player is already struggling", () => {
    expect(
      clampTrainerBattle(baseBeat({ levelDelta: 10, difficultyTag: "brutal" }), { recentFaints: 2 }).levelDelta,
    ).toBe(3);
  });

  it("trims species swaps beyond 2", () => {
    const swaps = [1, 2, 3, 4, 5];
    expect(clampTrainerBattle(baseBeat({ speciesSwaps: swaps }), { recentFaints: 0 }).speciesSwaps).toHaveLength(2);
  });

  it("preserves an empty/missing levelDelta as 0", () => {
    expect(clampTrainerBattle(baseBeat({}), { recentFaints: 0 }).levelDelta).toBe(0);
  });
});
