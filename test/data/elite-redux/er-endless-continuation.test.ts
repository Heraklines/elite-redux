import {
  advanceErEndlessGhostRoute,
  beginErEndlessGhostEncounter,
  beginErEndlessGhostRoute,
  canUseErEndlessGhost,
  finalizeErEndlessGhostEncounter,
  getErEndlessActiveRifts,
  getErEndlessCycle,
  getErEndlessCycleWave,
  getErEndlessEnemyAvalancheCount,
  getErEndlessEquivalentDepth,
  getErEndlessGhostRoute,
  getErEndlessHeldItemCandidateIndex,
  getErEndlessNemesisRank,
  getErEndlessNemesisRelicBudgetMultiplier,
  getErEndlessPlayerAvalancheCount,
  getErEndlessRateBonus,
  getErEndlessReturningNemesisId,
  getErEndlessRiftDefinition,
  getErEndlessSaveData,
  initializeErEndlessContinuation,
  isErEndlessCycleFinale,
  isErEndlessRaidWave,
  pulseErEndlessRifts,
  recordErEndlessGhost,
  recordErEndlessGhostPlayerDamage,
  recordErEndlessGhostPlayerFaint,
  resetErEndlessContinuation,
  restoreErEndlessContinuation,
} from "#data/elite-redux/er-endless-continuation";
import { resetErRunPacing, setErRunPacing } from "#data/elite-redux/er-run-pacing";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => {
  resetErEndlessContinuation();
  resetErRunPacing();
});

describe("Elite Redux Endless continuation", () => {
  it("starts with one pressure Rift and one mutation Rift", () => {
    const initial = initializeErEndlessContinuation(200, "seed");
    expect(initial).toHaveLength(2);
    expect(new Set(initial.map(rift => rift.id)).size).toBe(2);
    for (const rift of initial) {
      const definition = getErEndlessRiftDefinition(rift.id);
      expect(definition?.name).toBeTruthy();
      expect(definition?.description).toBeTruthy();
      expect(rift.pulsesRemaining).toBeGreaterThan(0);
    }
  });

  it("maps Normal and Sprint runs onto the same equivalent-depth cadence", () => {
    setErRunPacing("normal");
    initializeErEndlessContinuation(200, "normal");
    expect(getErEndlessEquivalentDepth(250)).toBe(50);
    expect(isErEndlessRaidWave(250)).toBe(true);
    expect(getErEndlessRateBonus(250)).toBe(1);

    resetErEndlessContinuation();
    setErRunPacing("sprint");
    initializeErEndlessContinuation(100, "sprint");
    expect(getErEndlessEquivalentDepth(125)).toBe(50);
    expect(isErEndlessRaidWave(125)).toBe(true);
    expect(getErEndlessRateBonus(125)).toBe(1);
  });

  it("loops its world display and marks each 200-depth finale", () => {
    initializeErEndlessContinuation(200, "cycle");
    expect(getErEndlessCycle(399)).toBe(1);
    expect(getErEndlessCycleWave(399)).toBe(199);
    expect(getErEndlessCycle(400)).toBe(1);
    expect(getErEndlessCycleWave(400)).toBe(200);
    expect(isErEndlessCycleFinale(400)).toBe(true);
    expect(getErEndlessCycle(401)).toBe(2);
    expect(getErEndlessCycleWave(401)).toBe(1);
  });

  it("scales player and enemy Avalanche independently with hard caps", () => {
    initializeErEndlessContinuation(200, "avalanche");
    expect(getErEndlessEnemyAvalancheCount(201)).toBe(1);
    expect(getErEndlessPlayerAvalancheCount(201)).toBe(0);
    expect(getErEndlessEnemyAvalancheCount(300)).toBe(11);
    expect(getErEndlessPlayerAvalancheCount(300)).toBe(5);
    expect(getErEndlessEnemyAvalancheCount(5000)).toBe(100);
    expect(getErEndlessPlayerAvalancheCount(5000)).toBe(100);
  });

  it("ages pulse Rifts while preserving encounter-scoped Rifts", () => {
    expect(
      restoreErEndlessContinuation({
        version: 1,
        enteredAtWave: 200,
        seed: "scope",
        pulse: 0,
        ghostEncounters: 0,
        activeRifts: [
          { id: "healing-lock", pulsesRemaining: 1, acquiredAtDepth: 0 },
          { id: "seventh-shadow", pulsesRemaining: 1, acquiredAtDepth: 0 },
        ],
        ghostHistory: [],
      }),
    ).toBe(true);
    pulseErEndlessRifts(205);
    expect(getErEndlessActiveRifts().some(rift => rift.id === "healing-lock")).toBe(false);
    expect(getErEndlessActiveRifts().some(rift => rift.id === "seventh-shadow")).toBe(true);
  });

  it("enforces independent snapshot, uploader, and fingerprint cooldowns", () => {
    initializeErEndlessContinuation(200, "cooldowns");
    recordErEndlessGhost("snapshot-a", "uploader-a", "team-a");
    expect(canUseErEndlessGhost("snapshot-a", "uploader-b", "team-b")).toBe(false);
    expect(canUseErEndlessGhost("snapshot-b", "uploader-a", "team-b")).toBe(false);
    expect(canUseErEndlessGhost("snapshot-b", "uploader-b", "team-a")).toBe(false);
    expect(canUseErEndlessGhost("snapshot-b", "uploader-b", "team-b")).toBe(true);
  });

  it("serializes and advances a three-encounter ghost route", () => {
    initializeErEndlessContinuation(200, "route");
    beginErEndlessGhostRoute({
      riftId: "echo-hunt",
      sourceUserId: "opaque-owner",
      sourceSnapshotId: "run-a",
      snapshotIds: ["run-a", "run-a", "run-a"],
    });
    advanceErEndlessGhostRoute();
    const saved = getErEndlessSaveData();
    resetErEndlessContinuation();
    expect(restoreErEndlessContinuation(saved)).toBe(true);
    expect(getErEndlessGhostRoute()?.encounterIndex).toBe(1);
    expect(advanceErEndlessGhostRoute()).toBe(1);
    expect(advanceErEndlessGhostRoute()).toBe(0);
    expect(getErEndlessGhostRoute()).toBeUndefined();
  });

  it("persists hidden Nemesis progression and schedules a returning opponent", () => {
    initializeErEndlessContinuation(200, "nemesis");
    recordErEndlessGhost("run-a", "owner-a", "team-a");
    beginErEndlessGhostEncounter("run-a", 1000, false);
    recordErEndlessGhostPlayerDamage(500);
    recordErEndlessGhostPlayerFaint(3);
    recordErEndlessGhostPlayerFaint(1);
    expect(finalizeErEndlessGhostEncounter("player-win", 12)).toEqual({
      sourceSnapshotId: "run-a",
      eventId: "nemesis:1:run-a",
      result: "player-win",
      playerKos: 2,
      playerHpRemoved: 0.5,
      turnsSurvived: 12,
    });
    expect(finalizeErEndlessGhostEncounter("player-win", 12)).toBeNull();
    expect(getErEndlessNemesisRank("run-a")).toBe(1);

    for (let encounter = 2; encounter <= 9; encounter++) {
      recordErEndlessGhost(`run-${encounter}`, `owner-${encounter}`, `team-${encounter}`);
    }
    expect(getErEndlessReturningNemesisId()).toBe("run-a");
    const saved = getErEndlessSaveData();
    resetErEndlessContinuation();
    expect(restoreErEndlessContinuation(saved)).toBe(true);
    expect(getErEndlessNemesisRank("run-a")).toBe(1);
  });

  it("scales saved relic stacks only after the second Nemesis return", () => {
    expect(getErEndlessNemesisRelicBudgetMultiplier(0)).toBe(1);
    expect(getErEndlessNemesisRelicBudgetMultiplier(1)).toBe(1);
    expect(getErEndlessNemesisRelicBudgetMultiplier(2)).toBe(1.5);
    expect(getErEndlessNemesisRelicBudgetMultiplier(3)).toBe(1.5);
    expect(getErEndlessNemesisRelicBudgetMultiplier(4)).toBe(1.75);
    expect(getErEndlessNemesisRelicBudgetMultiplier(20)).toBe(1.75);
  });

  it("uses tier, stack count, and stable id for Predatory Theft", () => {
    expect(
      restoreErEndlessContinuation({
        version: 1,
        enteredAtWave: 200,
        seed: "theft",
        pulse: 0,
        ghostEncounters: 0,
        activeRifts: [{ id: "predatory-theft", pulsesRemaining: 4, acquiredAtDepth: 0 }],
        ghostHistory: [],
      }),
    ).toBe(true);
    const items = [
      { id: "z", tier: 3, stacks: 2 },
      { id: "b", tier: 4, stacks: 1 },
      { id: "a", tier: 4, stacks: 3 },
      { id: "c", tier: 4, stacks: 3 },
    ];
    expect(
      getErEndlessHeldItemCandidateIndex(
        items,
        0,
        item => item.tier,
        item => item.stacks,
        item => item.id,
      ),
    ).toBe(2);
  });
});
