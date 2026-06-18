import {
  chooseMoveIndex,
  damageToScore,
  ER_EVAL,
  ER_KO_BONUS,
  type ErBoostStages,
  type ErDepth1Before,
  erBoostDiminishing,
  erBoostValue,
  erDepth1MoveScore,
  erEvalMon,
  erEvalPosition,
  erStatusValue,
  getErAiProfile,
  setErAiExperimentalMode,
  setErSmartAiTestForced,
  shouldDevalueSlowMove,
  strategicMoveScore,
} from "#data/elite-redux/er-enemy-ai";
import { getErDifficulty, setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { StatusEffect } from "#enums/status-effect";
import { afterEach, describe, expect, it } from "vitest";

const NO_BOOSTS: ErBoostStages = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const NO_HAZARDS = { stealthRock: false, spikesLayers: 0, toxicSpikesLayers: 0, stickyWeb: false };

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
    setErAiExperimentalMode("off");
  });

  describe("getErAiProfile (master gate + difficulty gating)", () => {
    it("is ACTIVE for a Hell trainer (smarter AI enabled via the er.ai.enabled override)", () => {
      setErDifficulty("hell");
      // er-balance-tuning.json ships er.ai.enabled = 1, so the master gate is on.
      expect(getErAiProfile(trainerMon).active).toBe(true);
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

  describe("experimental profile (A/B harness)", () => {
    it("is 'standard' by default", () => {
      setErSmartAiTestForced(true);
      setErDifficulty("hell");
      expect(getErAiProfile(trainerMon).kind).toBe("standard");
    });

    it("hands the experimental brain to everyone in 'all' mode (max sharpness)", () => {
      setErSmartAiTestForced(true);
      setErAiExperimentalMode("all");
      setErDifficulty("elite");
      const p = getErAiProfile(trainerMon);
      expect(p.kind).toBe("experimental");
      expect(p.sharpness).toBe(1); // experimental plays max-sharp regardless of difficulty
    });

    it("stays inactive (no kind leak) for wild mons", () => {
      setErSmartAiTestForced(true);
      setErAiExperimentalMode("all");
      setErDifficulty("hell");
      expect(getErAiProfile(wildMon).active).toBe(false);
    });
  });

  describe("shouldDevalueSlowMove (Phase A: threat-awareness)", () => {
    it("devalues a SLOW move when doomed and outsped (snipe with priority instead)", () => {
      expect(shouldDevalueSlowMove(true, false, 0)).toBe(true);
    });

    it("keeps a PRIORITY move at full value even when doomed + outsped", () => {
      expect(shouldDevalueSlowMove(true, false, 1)).toBe(false);
    });

    it("does nothing if the mon outspeeds the threat (it acts first anyway)", () => {
      expect(shouldDevalueSlowMove(true, true, 0)).toBe(false);
    });

    it("does nothing when not about to be KO'd", () => {
      expect(shouldDevalueSlowMove(false, false, 0)).toBe(false);
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

/**
 * The EXPERIMENTAL brain - a Foul-Play-style depth-1 position evaluator
 * (ported from pmariglia/showdown engine/evaluate.py + pick_safest). The eval
 * scores a whole board; the depth-1 combiner looks one ply ahead (my move + the
 * opponent's best reply) and that score IS the move's score. See
 * docs/plans/2026-06-18-battle-ai-foulplay-depth1-design.md.
 */
describe("er-enemy-ai (experimental brain - Foul-Play depth-1 eval)", () => {
  describe("erBoostDiminishing (Foul Play boost-stage table)", () => {
    it("is 0 at no boost and ramps with diminishing returns", () => {
      expect(erBoostDiminishing(0)).toBe(0);
      expect(erBoostDiminishing(1)).toBe(1);
      expect(erBoostDiminishing(2)).toBe(2);
      expect(erBoostDiminishing(6)).toBe(3.3); // taper: +6 worth only 3.3, not 6
      expect(erBoostDiminishing(-1)).toBe(-1);
    });

    it("clamps beyond the +-6 stage cap", () => {
      expect(erBoostDiminishing(99)).toBe(3.3);
      expect(erBoostDiminishing(-99)).toBe(-3.3);
    });
  });

  describe("erBoostValue / erStatusValue", () => {
    it("weights a speed boost above an attack boost", () => {
      expect(erBoostValue({ ...NO_BOOSTS, spe: 1 })).toBeGreaterThan(erBoostValue({ ...NO_BOOSTS, atk: 1 }));
    });

    it("scores statuses by severity (freeze worst, none zero)", () => {
      expect(erStatusValue(StatusEffect.NONE)).toBe(0);
      expect(erStatusValue(StatusEffect.FREEZE)).toBeLessThan(erStatusValue(StatusEffect.BURN));
      expect(erStatusValue(StatusEffect.TOXIC)).toBeLessThan(erStatusValue(StatusEffect.POISON));
    });
  });

  describe("erEvalMon", () => {
    it("is worth ALIVE + HP at full health, unboosted", () => {
      expect(erEvalMon({ fainted: false, hpFraction: 1, status: StatusEffect.NONE, boosts: NO_BOOSTS })).toBe(
        ER_EVAL.ALIVE + ER_EVAL.HP,
      );
    });

    it("is worth 0 when fainted", () => {
      expect(erEvalMon({ fainted: true, hpFraction: 1, status: StatusEffect.NONE, boosts: NO_BOOSTS })).toBe(0);
    });

    it("never drops below the alive bonus, even badly statused at low HP", () => {
      const score = erEvalMon({ fainted: false, hpFraction: 0.05, status: StatusEffect.FREEZE, boosts: NO_BOOSTS });
      expect(score).toBeGreaterThanOrEqual(ER_EVAL.ALIVE);
    });
  });

  describe("erEvalPosition (zero-sum board score)", () => {
    const mirror = (myHp: number, oppHp: number) =>
      erEvalPosition({
        myActive: { fainted: myHp <= 0, hpFraction: myHp, status: StatusEffect.NONE, boosts: NO_BOOSTS },
        oppActive: { fainted: oppHp <= 0, hpFraction: oppHp, status: StatusEffect.NONE, boosts: NO_BOOSTS },
        myReserveAlive: 0,
        oppReserveAlive: 0,
        myHazards: NO_HAZARDS,
        oppHazards: NO_HAZARDS,
        matchup: 0,
      });

    it("is balanced (0) for an identical board", () => {
      expect(mirror(1, 1)).toBe(0);
    });

    it("rewards KOing the opponent's active", () => {
      expect(mirror(1, 0)).toBeGreaterThan(mirror(1, 1));
    });

    it("punishes losing my own active", () => {
      expect(mirror(0, 1)).toBeLessThan(mirror(1, 1));
    });

    it("values my reserves and penalizes hazards on my side", () => {
      const withReserves = erEvalPosition({
        myActive: { fainted: false, hpFraction: 1, status: StatusEffect.NONE, boosts: NO_BOOSTS },
        oppActive: { fainted: false, hpFraction: 1, status: StatusEffect.NONE, boosts: NO_BOOSTS },
        myReserveAlive: 3,
        oppReserveAlive: 0,
        myHazards: { ...NO_HAZARDS, stealthRock: true },
        oppHazards: NO_HAZARDS,
        matchup: 0,
      });
      // 3 reserves (+225) minus rocks on my side scaled by 3 reserves (-30) = +195.
      expect(withReserves).toBe(3 * ER_EVAL.ALIVE + ER_EVAL.HAZARD.stealthRock * 3);
    });
  });

  describe("erDepth1MoveScore (the maximin lookahead)", () => {
    // Both mons full (100/100), no boosts/status/reserves/hazards.
    const before: ErDepth1Before = {
      myActive: { fainted: false, hpFraction: 1, status: StatusEffect.NONE, boosts: NO_BOOSTS },
      oppActive: { fainted: false, hpFraction: 1, status: StatusEffect.NONE, boosts: NO_BOOSTS },
      myHp: 100,
      myMaxHp: 100,
      oppHp: 100,
      oppMaxHp: 100,
      myReserveAlive: 0,
      oppReserveAlive: 0,
      myHazards: NO_HAZARDS,
      oppHazards: NO_HAZARDS,
      matchup: 0,
    };

    it("KO + outspeed denies the opponent's reply (best possible)", () => {
      const koFast = erDepth1MoveScore(before, { myDamage: 100, oppReplyDamage: 50, iMoveFirst: true });
      const chip = erDepth1MoveScore(before, { myDamage: 50, oppReplyDamage: 50, iMoveFirst: true });
      expect(koFast).toBeGreaterThan(chip);
      // I keep full HP (no reply) and they faint: +175 to me, 0 to them.
      expect(koFast).toBe(ER_EVAL.ALIVE + ER_EVAL.HP);
    });

    it("a KO while outspeeding beats the same KO while slower (no chip taken)", () => {
      const koFast = erDepth1MoveScore(before, { myDamage: 100, oppReplyDamage: 50, iMoveFirst: true });
      const koSlow = erDepth1MoveScore(before, { myDamage: 100, oppReplyDamage: 50, iMoveFirst: false });
      expect(koFast).toBeGreaterThan(koSlow);
    });

    it("a slow move that gets me KO'd first never executes (worst case)", () => {
      const slowWhiff = erDepth1MoveScore(before, { myDamage: 100, oppReplyDamage: 100, iMoveFirst: false });
      // I faint, my move whiffs, opponent stays at full: deeply negative.
      expect(slowWhiff).toBeLessThan(0);
      expect(slowWhiff).toBe(-(ER_EVAL.ALIVE + ER_EVAL.HP));
    });

    it("prefers attacking over setting up when under pressure (boost doesn't trade)", () => {
      // Slower, taking a big (non-KO) hit either way: setting up deals nothing,
      // so chipping the opponent is the better trade.
      const setupUnderFire = erDepth1MoveScore(before, {
        myDamage: 0,
        oppReplyDamage: 60,
        iMoveFirst: false,
        myBoostDelta: { ...NO_BOOSTS, atk: 2 },
      });
      const attackInstead = erDepth1MoveScore(before, { myDamage: 60, oppReplyDamage: 60, iMoveFirst: false });
      expect(setupUnderFire).toBeLessThan(attackInstead);
    });

    it("a slow setup move gets no value when it would be KO'd before acting", () => {
      // Slower + opponent KOs me: the boost never lands, same as any whiffed move.
      const setupIntoKO = erDepth1MoveScore(before, {
        myDamage: 0,
        oppReplyDamage: 100,
        iMoveFirst: false,
        myBoostDelta: { ...NO_BOOSTS, atk: 2 },
      });
      expect(setupIntoKO).toBe(-(ER_EVAL.ALIVE + ER_EVAL.HP));
    });

    it("rewards laying a hazard on a bench-heavy opponent", () => {
      const benchy: ErDepth1Before = { ...before, oppReserveAlive: 4 };
      const rocks = erDepth1MoveScore(benchy, {
        myDamage: 0,
        oppReplyDamage: 0,
        iMoveFirst: true,
        addsOppHazard: "stealthRock",
      });
      const doNothing = erDepth1MoveScore(benchy, { myDamage: 0, oppReplyDamage: 0, iMoveFirst: true });
      expect(rocks).toBeGreaterThan(doNothing);
    });
  });
});
