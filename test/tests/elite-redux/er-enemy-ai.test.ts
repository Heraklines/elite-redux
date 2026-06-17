import {
  chooseMoveIndex,
  damageToScore,
  ER_KO_BONUS,
  getErAiProfile,
  setErSmartAiTestForced,
  strategicMoveScore,
} from "#data/elite-redux/er-enemy-ai";
import { getErDifficulty, setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The Elite/Hell smarter-AI profile + its pure scoring helpers (Slice 1).
 * Contract: the profile is OFF for Youngster/Ace and wild (vanilla path), the
 * determinism dial makes Hell never misplay, and damage scoring prefers real
 * damage / a reliable KO.
 */
describe("er-enemy-ai (Elite/Hell smarter AI - Slice 1)", () => {
  const trainerMon = { hasTrainer: () => true, isBoss: () => false };
  const bossMon = { hasTrainer: () => false, isBoss: () => true };
  const wildMon = { hasTrainer: () => false, isBoss: () => false };

  // The smarter AI is master-OFF in real play; the scenarios/tests opt in.
  afterEach(() => {
    setErDifficulty("ace");
    setErSmartAiTestForced(false);
  });

  describe("getErAiProfile (master gate + difficulty gating)", () => {
    it("is INACTIVE by default even for a Hell trainer (master switch OFF)", () => {
      setErDifficulty("hell");
      expect(getErAiProfile(trainerMon).active).toBe(false);
    });

    it("is INACTIVE on the vanilla difficulties (Youngster/Ace)", () => {
      setErSmartAiTestForced(true);
      setErDifficulty("ace");
      expect(getErAiProfile(trainerMon).active).toBe(false);
      setErDifficulty("youngster");
      expect(getErAiProfile(bossMon).active).toBe(false);
    });

    it("is INACTIVE for wild mons even on Hell", () => {
      setErSmartAiTestForced(true);
      setErDifficulty("hell");
      expect(getErAiProfile(wildMon).active).toBe(false);
    });

    it("is ACTIVE and fully sharp for Hell trainers/bosses (when enabled)", () => {
      setErSmartAiTestForced(true);
      setErDifficulty("hell");
      const p = getErAiProfile(trainerMon);
      expect(p.active).toBe(true);
      expect(p.sharpness).toBe(1); // Hell default = always best move
    });

    it("is ACTIVE and near-optimal for Elite trainers/bosses (when enabled)", () => {
      setErSmartAiTestForced(true);
      setErDifficulty("elite");
      const p = getErAiProfile(bossMon);
      expect(p.active).toBe(true);
      expect(p.sharpness).toBeGreaterThan(0);
      expect(p.sharpness).toBeLessThan(1); // Elite keeps a little noise
    });

    it("does not leak difficulty state between tests", () => {
      expect(getErDifficulty()).toBe("ace");
    });
  });

  describe("chooseMoveIndex (determinism dial)", () => {
    it("sharpness 1 (Hell) always takes the best move, whatever the RNG", () => {
      expect(chooseMoveIndex([100, 90, 10], 1, () => 0)).toBe(0);
      expect(chooseMoveIndex([100, 99, 98], 1, () => 0)).toBe(0);
    });

    it("sharpness 0.5 reproduces a vanilla-style slide when the roll is low", () => {
      // factor = 1; slideChance = round(0.9*50) = 45; rand 0 < 45 -> slide once.
      expect(chooseMoveIndex([100, 90], 0.5, () => 0)).toBe(1);
      // rand above the chance -> stay on the best move.
      expect(chooseMoveIndex([100, 90], 0.5, () => 99)).toBe(0);
    });

    it("never slides across a sign change or off a zero pivot", () => {
      expect(chooseMoveIndex([100, -5], 0, () => 0)).toBe(0);
      expect(chooseMoveIndex([0, 0], 0, () => 0)).toBe(0);
    });

    it("handles a single-move pool", () => {
      expect(chooseMoveIndex([42], 0, () => 0)).toBe(0);
    });
  });

  describe("damageToScore (real-damage move scoring)", () => {
    it("scores zero damage as zero", () => {
      expect(damageToScore(0, 100, 100, 100)).toBe(0);
    });

    it("scales with the fraction of the target's max HP", () => {
      expect(damageToScore(60, 100, 100, 100)).toBeGreaterThan(damageToScore(30, 100, 100, 100));
    });

    it("adds a KO bonus when the hit would faint the target", () => {
      const ko = damageToScore(50, 100, 40, 100); // 50 dmg >= 40 HP -> KO
      const noKo = damageToScore(50, 100, 100, 100); // same hit, full HP -> no KO
      expect(ko).toBeGreaterThan(noKo);
      expect(ko).toBeGreaterThan(ER_KO_BONUS);
    });

    it("prefers a RELIABLE KO over an unreliable one (accuracy-weighted)", () => {
      const sureKo = damageToScore(50, 100, 40, 100);
      const riskyKo = damageToScore(50, 100, 40, 70);
      expect(sureKo).toBeGreaterThan(riskyKo);
    });

    it("treats never-miss moves (accuracy <= 0) as 100% accurate", () => {
      expect(damageToScore(30, 100, 100, -1)).toBe(damageToScore(30, 100, 100, 100));
    });
  });

  describe("strategicMoveScore (Slice 3: setup + hazard valuation)", () => {
    const base = (over: Partial<Parameters<typeof strategicMoveScore>[1]>) => ({
      isSetup: false,
      isHazard: false,
      userHpRatio: 1,
      opponentBenchCount: 3,
      hazardAlreadyUp: false,
      ...over,
    });

    it("refuses to set up while frail (about to be KO'd)", () => {
      expect(strategicMoveScore(15, base({ isSetup: true, userHpRatio: 0.3 }))).toBeLessThan(0);
    });

    it("makes setup competitive when the user is healthy", () => {
      const healthy = strategicMoveScore(4, base({ isSetup: true, userHpRatio: 1 }));
      expect(healthy).toBeGreaterThan(15); // boosted above a weak attack
    });

    it("values hazards when there's a bench to punish and none are up", () => {
      const score = strategicMoveScore(2, base({ isHazard: true, opponentBenchCount: 4, hazardAlreadyUp: false }));
      expect(score).toBeGreaterThan(20);
    });

    it("does not re-set a hazard that is already up", () => {
      expect(strategicMoveScore(2, base({ isHazard: true, hazardAlreadyUp: true }))).toBeLessThan(0);
    });

    it("does not value hazards against a lone opponent (no bench left)", () => {
      expect(strategicMoveScore(2, base({ isHazard: true, opponentBenchCount: 1 }))).toBeLessThan(0);
    });

    it("leaves a normal (non-setup, non-hazard) move's score untouched", () => {
      expect(strategicMoveScore(7, base({}))).toBe(7);
    });
  });
});
