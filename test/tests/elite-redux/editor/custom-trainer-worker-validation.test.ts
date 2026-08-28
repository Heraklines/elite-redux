/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { validateCustomAbilitiesDelta, validateCustomTrainersDelta } from "../../../../workers/er-editor-api/src/index";

function trainer(trainerClass: string): Record<string, unknown> {
  return {
    id: 70022,
    name: "Volo",
    trainerClass,
    team: [{ species: 1 }],
  };
}

describe("custom trainer Worker validation", () => {
  it("accepts a real TrainerType name", () => {
    expect(validateCustomTrainersDelta({ TRAINER_70022: trainer("CYNTHIA") })).toEqual({ ok: true });
  });

  it("rejects display labels that the game runtime cannot resolve", () => {
    expect(validateCustomTrainersDelta({ TRAINER_70022: trainer("WIELDER") })).toEqual({
      ok: false,
      error: "TRAINER_70022: trainerClass must be a TrainerType NAME",
    });
  });
});

describe("custom ability Worker validation", () => {
  function componentAbility(condition: Record<string, unknown>): Record<string, unknown> {
    return {
      version: 1,
      id: 20007,
      name: "Threshold Exit",
      description: "Switches out at low HP.",
      generation: 9,
      includes: [],
      mechanics: [],
      componentRules: [
        {
          key: "threshold-exit",
          hook: { abilityId: 65, attrIndex: 0, attrType: "PostTurnAbAttr" },
          chance: 100,
          conditions: [condition],
          effects: [{ abilityId: 66, attrIndex: 0, attrType: "PostDamageForceSwitchAbAttr" }],
        },
      ],
      rules: [],
      modifiers: [],
    };
  }

  it("accepts primitive conditions inside component rules", () => {
    expect(
      validateCustomAbilitiesDelta({ "threshold-exit": componentAbility({ kind: "holder-hp", maxPercent: 35 }) }),
    ).toEqual({ ok: true });
  });

  it("rejects invalid primitive conditions inside component rules", () => {
    expect(
      validateCustomAbilitiesDelta({ "threshold-exit": componentAbility({ kind: "holder-hp", maxPercent: 101 }) }),
    ).toEqual({
      ok: false,
      error: "threshold-exit.componentRules[0].conditions[0].maxPercent: must be 0-100",
    });
  });
});
