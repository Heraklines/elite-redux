/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Smoke tests for the 5 new primitives landed in the late-session bespoke
// grind: constructor validation + key invariants. Behavior tests against
// the real GameManager would need real battle setup; these constructor
// tests give a safety net that nothing crashes on import + instantiation.
// =============================================================================

import { StatStageChangeCopyAbAttr } from "#abilities/ab-attrs";
import { CounterAttackOnHitAbAttr } from "#data/elite-redux/archetypes/counter-attack-on-hit";
import { HpThresholdFormChangeAbAttr } from "#data/elite-redux/archetypes/hp-threshold-form-change";
import { OnOpponentStatRaiseAbAttr } from "#data/elite-redux/archetypes/on-opponent-stat-raise";
import { PostTurnScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-turn-scripted-move";
import { SpeedBonusToStatAbAttr } from "#data/elite-redux/archetypes/speed-bonus-to-stat";
import { MoveId } from "#enums/move-id";
import { Stat } from "#enums/stat";
import { describe, expect, it } from "vitest";

describe("CounterAttackOnHitAbAttr", () => {
  it("accepts valid construction", () => {
    const attr = new CounterAttackOnHitAbAttr({ moveId: MoveId.ICICLE_SPEAR });
    expect(attr).toBeInstanceOf(CounterAttackOnHitAbAttr);
  });

  it("accepts contactRequired filter", () => {
    const attr = new CounterAttackOnHitAbAttr({
      moveId: MoveId.ACID,
      filter: { contactRequired: true },
    });
    expect(attr).toBeInstanceOf(CounterAttackOnHitAbAttr);
  });

  it("rejects out-of-range chance", () => {
    expect(() => new CounterAttackOnHitAbAttr({ moveId: MoveId.PECK, chance: 150 })).toThrow(/0\.\.100/);
    expect(() => new CounterAttackOnHitAbAttr({ moveId: MoveId.PECK, chance: -5 })).toThrow(/0\.\.100/);
  });

  it("accepts boundary chance values", () => {
    expect(() => new CounterAttackOnHitAbAttr({ moveId: MoveId.PECK, chance: 0 })).not.toThrow();
    expect(() => new CounterAttackOnHitAbAttr({ moveId: MoveId.PECK, chance: 100 })).not.toThrow();
  });
});

describe("HpThresholdFormChangeAbAttr", () => {
  it("rejects threshold <= 0", () => {
    expect(() => new HpThresholdFormChangeAbAttr({ hpThreshold: 0, targetFormKey: "mega" })).toThrow(/hpThreshold/);
  });

  it("rejects threshold > 1", () => {
    expect(() => new HpThresholdFormChangeAbAttr({ hpThreshold: 1.5, targetFormKey: "mega" })).toThrow(/hpThreshold/);
  });

  it("rejects empty targetFormKey", () => {
    expect(() => new HpThresholdFormChangeAbAttr({ hpThreshold: 0.5, targetFormKey: "" })).toThrow(/targetFormKey/);
  });

  it("accepts standard 50% threshold", () => {
    const attr = new HpThresholdFormChangeAbAttr({
      hpThreshold: 0.5,
      targetFormKey: "transformed",
      cureStatus: true,
    });
    expect(attr).toBeInstanceOf(HpThresholdFormChangeAbAttr);
  });

  it("accepts boundary threshold of 1.0", () => {
    expect(() => new HpThresholdFormChangeAbAttr({ hpThreshold: 1.0, targetFormKey: "mega" })).not.toThrow();
  });
});

describe("OnOpponentStatRaiseAbAttr", () => {
  it("is a StatStageChangeCopyAbAttr (Egoist copies the foe's exact raise)", () => {
    const attr = new OnOpponentStatRaiseAbAttr();
    expect(attr).toBeInstanceOf(OnOpponentStatRaiseAbAttr);
    expect(attr).toBeInstanceOf(StatStageChangeCopyAbAttr);
  });
});

describe("PostTurnScriptedMoveAbAttr", () => {
  it("rejects non-positive everyNTurns", () => {
    expect(() => new PostTurnScriptedMoveAbAttr({ moveId: MoveId.ABSORB, everyNTurns: 0 })).toThrow(/everyNTurns/);
  });

  it("rejects non-integer everyNTurns", () => {
    expect(() => new PostTurnScriptedMoveAbAttr({ moveId: MoveId.ABSORB, everyNTurns: 1.5 })).toThrow(/everyNTurns/);
  });

  it("defaults everyNTurns to 1", () => {
    const attr = new PostTurnScriptedMoveAbAttr({ moveId: MoveId.ABSORB });
    expect(attr).toBeInstanceOf(PostTurnScriptedMoveAbAttr);
  });

  it("accepts every-2-turns config", () => {
    const attr = new PostTurnScriptedMoveAbAttr({
      moveId: MoveId.CIRCLE_THROW,
      everyNTurns: 2,
    });
    expect(attr).toBeInstanceOf(PostTurnScriptedMoveAbAttr);
  });
});

describe("SpeedBonusToStatAbAttr", () => {
  it("rejects non-positive speedFraction", () => {
    expect(() => new SpeedBonusToStatAbAttr({ stat: Stat.ATK, speedFraction: 0 })).toThrow(/speedFraction/);
  });

  it("accepts standard 0.2 bonus", () => {
    const attr = new SpeedBonusToStatAbAttr({ stat: Stat.ATK, speedFraction: 0.2 });
    expect(attr).toBeInstanceOf(SpeedBonusToStatAbAttr);
  });

  it("accepts 100% bonus (replace-style)", () => {
    const attr = new SpeedBonusToStatAbAttr({
      stat: Stat.ATK,
      speedFraction: 1,
      filter: { contact: "only" },
    });
    expect(attr).toBeInstanceOf(SpeedBonusToStatAbAttr);
  });

  it("accepts custom sourceStat (defensive variant)", () => {
    const attr = new SpeedBonusToStatAbAttr({
      stat: Stat.ATK,
      speedFraction: 0.2,
      sourceStat: Stat.DEF,
    });
    expect(attr).toBeInstanceOf(SpeedBonusToStatAbAttr);
  });
});
