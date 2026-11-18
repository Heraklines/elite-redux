/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  PostDamageAbAttr,
  PostDefendAbAttr,
  ReceivedMoveDamageMultiplierAbAttr,
  StatMultiplierAbAttr,
} from "#abilities/ab-attrs";
import { allAbilities } from "#data/data-lists";
import {
  type AbilityStudioBlueprintV1,
  validateAbilityStudioBlueprints,
} from "#data/elite-redux/ability-studio/ability-blueprint";
import { compileAbilityStudioBlueprint } from "#data/elite-redux/ability-studio/compile-ability-blueprint";
import { AbilityStudioPostAttackRuleAbAttr } from "#data/elite-redux/ability-studio/rule-ab-attrs";
import { compileComposition } from "#data/elite-redux/ability-studio/vocabulary/evaluate/compile-composition";
import { type CompositionRuleV2, validateComposition } from "#data/elite-redux/ability-studio/vocabulary/index";
import { AbilityId } from "#enums/ability-id";
import { toDmgValue } from "#utils/common";
import { describe, expect, it } from "vitest";

const halfAtFullHp: CompositionRuleV2 = {
  key: "half-at-full-hp",
  when: { block: "calc.damage-taken" },
  if: [{ block: "hp.full", params: { who: "holder" } }],
  do: [{ block: "effect.multiply-damage-taken", params: { multiplier: 0.5 } }],
  chance: 100,
};

const switchOutBelow35: CompositionRuleV2 = {
  key: "stages-below-35",
  when: { block: "event.after-taking-damage" },
  if: [{ block: "hp.crossed-below", params: { who: "holder", ratio: 0.35, rounding: "exact" } }],
  do: [{ block: "effect.stat-stage", params: { target: "holder", stat: "ATK", stages: 2 } }],
  chance: 100,
};

function expectInvalid(rule: unknown, fragment: string): void {
  const errors = validateComposition([rule]);
  expect(errors.join(" | "), `expected an error containing "${fragment}"`).toContain(fragment);
}

describe("composition validation (plain-language, vocabulary driven)", () => {
  it("accepts the half-damage-at-full-HP and the after-taking-damage rules", () => {
    expect(validateComposition([halfAtFullHp, switchOutBelow35])).toEqual([]);
  });

  it("accepts groups: any / not / all", () => {
    const rule: CompositionRuleV2 = {
      ...halfAtFullHp,
      if: [
        {
          any: [
            { block: "hp.full", params: { who: "holder" } },
            { not: { block: "move.category", params: { category: "STATUS" } } },
            { all: [{ block: "move.damaging" }, { block: "move.priority", params: { cmp: "gt", n: 0 } }] },
          ],
        },
      ],
    };
    expect(validateComposition([rule])).toEqual([]);
  });

  it("rejects a condition that needs a slot the trigger does not provide, naming both", () => {
    expectInvalid(
      { ...switchOutBelow35, key: "bad-slot", when: { block: "event.on-entry" } },
      'needs the damage, but the trigger "When I enter the battle" does not provide it',
    );
  });

  it("rejects unknown blocks, unknown fields and bad params with a sentence", () => {
    expectInvalid({ ...halfAtFullHp, do: [{ block: "effect.nope" }] }, 'there is no effect called "effect.nope"');
    expectInvalid({ ...halfAtFullHp, if: [{ block: "hp.nope" }] }, 'there is no condition called "hp.nope"');
    expectInvalid({ ...halfAtFullHp, when: { block: "calc.nope" } }, 'there is no trigger called "calc.nope"');
    expectInvalid({ ...halfAtFullHp, extra: 1 }, 'unknown field "extra"');
    expectInvalid(
      { ...halfAtFullHp, if: [{ block: "hp.at-most", params: { who: "holder", pct: 150, rounding: "exact" } }] },
      "must be at most 100",
    );
    expectInvalid(
      { ...halfAtFullHp, if: [{ block: "hp.at-most", params: { who: "holder", nope: 1 } }] },
      'has no setting called "nope"',
    );
    expectInvalid({ ...halfAtFullHp, key: "Bad Key" }, "lowercase letters");
    expectInvalid({ ...halfAtFullHp, chance: 0 }, "whole number from 1 to 100");
    expectInvalid({ ...halfAtFullHp, do: [] }, "between 1 and");
  });

  it("rejects duplicate keys", () => {
    expect(validateComposition([halfAtFullHp, halfAtFullHp]).join(" ")).toContain("duplicate key half-at-full-hp");
  });

  it("keeps the calc/event split: an effect must change what the trigger lets it change", () => {
    expectInvalid(
      { ...halfAtFullHp, do: [{ block: "effect.multiply-power", params: { multiplier: 2 } }] },
      "changes power, but",
    );
    expectInvalid({ ...switchOutBelow35, do: [{ block: "effect.multiply-power" }] }, "is an event");
    expectInvalid(
      { ...halfAtFullHp, when: { block: "event.on-entry" }, if: [] },
      "changes a value the game is calculating",
    );
  });

  it("rejects dice and memory inside a calculation, and a chance below 100 there", () => {
    expectInvalid({ ...halfAtFullHp, if: [{ block: "rng.chance", params: { pct: 30 } }] }, "rolls dice or remembers");
    expectInvalid(
      { ...halfAtFullHp, if: [{ block: "time.once-per", params: { scope: "battle", key: "x" } }] },
      "rolls dice or remembers",
    );
    expectInvalid({ ...halfAtFullHp, chance: 50 }, "chance must be 100");
    // The same atoms are fine for an event.
    expect(
      validateComposition([
        {
          key: "once-per-battle",
          when: { block: "event.after-hit" },
          if: [
            { block: "time.once-per", params: { scope: "battle", key: "x" } },
            { block: "rng.chance", params: { pct: 30 } },
          ],
          do: [{ block: "effect.heal-percent", params: { target: "holder", percent: 10 } }],
          chance: 60,
        },
      ]),
    ).toEqual([]);
  });

  it("rejects planned-but-unwired triggers, effects and hand-added escape hatches", () => {
    expectInvalid(
      { ...halfAtFullHp, when: { block: "event.berry-eaten" }, if: [], do: [{ block: "effect.heal-percent" }] },
      "cannot be used in a rule yet",
    );
    expectInvalid({ ...switchOutBelow35, do: [{ block: "effect.apply-tag" }] }, "cannot run yet");
    expectInvalid({ ...halfAtFullHp, if: [{ block: "escape.legacy-closure" }] }, "cannot be added by hand");
    expectInvalid({ ...halfAtFullHp, when: { block: "while.active" }, if: [] }, "always-on flag");
    expectInvalid({ ...halfAtFullHp, when: { block: "calc.incoming-move" }, if: [] }, "legacy grouping");
  });

  it("bounds nesting depth", () => {
    let tree: unknown = { block: "move.damaging" };
    for (let i = 0; i < 6; i++) {
      tree = { not: tree };
    }
    expectInvalid({ ...halfAtFullHp, if: [tree] }, "nests groups more than");
  });
});

const baseBlueprint: AbilityStudioBlueprintV1 = {
  version: 1,
  id: 20990,
  name: "Composed Test",
  description: "Test only.",
  generation: 9,
  includes: [AbilityId.BLAZE],
  modifiers: [{ kind: "stat-multiplier", stat: "ATK", multiplier: 1.1 }],
  rules: [
    {
      key: "fire-contact",
      trigger: "after-attack",
      chance: 30,
      conditions: [{ kind: "move", filter: { type: "FIRE" } }],
      effects: [{ kind: "status", target: "other", status: "BURN" }],
    },
  ],
};

describe("blueprint V2: additive composition field", () => {
  it("accepts version 1 and 2, rejects other versions, and counts composition as content", () => {
    const only = {
      version: 2,
      id: 20991,
      name: "Only Composition",
      description: "Test only.",
      generation: 9,
      includes: [],
      rules: [],
      modifiers: [],
      composition: [halfAtFullHp],
    };
    const ok = validateAbilityStudioBlueprints({
      "only-composition": only,
      "v1-stamp": { ...only, version: 1, id: 20992, name: "Version One" },
    });
    expect(ok.errors).toEqual([]);
    expect(Object.keys(ok.blueprints)).toHaveLength(2);
    const bad = validateAbilityStudioBlueprints({ "bad-version": { ...only, version: 3 } });
    expect(bad.errors.join(" ")).toContain("version must be 1 or 2");
    const empty = validateAbilityStudioBlueprints({ "empty-one": { ...only, composition: [] } });
    expect(empty.errors.join(" ")).toContain("must include an ability");
  });

  it("reports composition problems under the blueprint path", () => {
    const result = validateAbilityStudioBlueprints({
      "bad-comp": { ...baseBlueprint, composition: [{ ...halfAtFullHp, do: [{ block: "effect.nope" }] }] },
    });
    expect(result.errors.join(" ")).toContain('bad-comp.composition[0].do[0]: there is no effect called "effect.nope"');
  });

  it("V1 compiles exactly as before: no composition field, same attrs, same order", () => {
    const withoutField = compileAbilityStudioBlueprint(baseBlueprint, id => allAbilities[id]);
    const withEmpty = compileAbilityStudioBlueprint({ ...baseBlueprint, composition: [] }, id => allAbilities[id]);
    const names = (attrs: readonly object[]): string[] => attrs.map(attr => attr.constructor.name);
    expect(names(withEmpty.attrs)).toEqual(names(withoutField.attrs));
    expect(names(withoutField.attrs).slice(-2)).toEqual(["StatMultiplierAbAttr", "AbilityStudioPostAttackRuleAbAttr"]);
  });

  it("orders composition after includes and before modifiers and rules", () => {
    const compiled = compileAbilityStudioBlueprint(
      { ...baseBlueprint, version: 2, composition: [halfAtFullHp, switchOutBelow35] },
      id => allAbilities[id],
    );
    const included = allAbilities[AbilityId.BLAZE].attrs.length;
    const names = compiled.attrs.map(attr => attr.constructor.name);
    expect(names.slice(0, included)).toEqual(allAbilities[AbilityId.BLAZE].attrs.map(attr => attr.constructor.name));
    expect(names.slice(included)).toEqual([
      "ReceivedMoveDamageMultiplierAbAttr",
      "PostDamageAbAttr",
      "StatMultiplierAbAttr",
      "AbilityStudioPostAttackRuleAbAttr",
    ]);
    expect(compiled.attrs[included + 2]).toBeInstanceOf(StatMultiplierAbAttr);
    expect(compiled.attrs[included + 3]).toBeInstanceOf(AbilityStudioPostAttackRuleAbAttr);
  });
});

type FakePokemon = {
  hp: number;
  getMaxHp: () => number;
  isFullHp: () => boolean;
  getAlly: () => undefined;
  randBattleSeedInt: (n: number) => number;
};

function fake(hp: number, max: number, rolls: number[] = []): FakePokemon {
  return {
    hp,
    getMaxHp: () => max,
    isFullHp: () => hp >= max,
    getAlly: () => undefined,
    randBattleSeedInt: () => rolls.shift() ?? 0,
  };
}

describe("compiled composition carriers", () => {
  it("keeps the dispatch class identity the engine and the Endless Avalanche hook key on", () => {
    const [carrier] = compileComposition([halfAtFullHp]);
    expect(carrier).toBeInstanceOf(ReceivedMoveDamageMultiplierAbAttr);
    expect(carrier.constructor.name).toBe("ReceivedMoveDamageMultiplierAbAttr");
    const [event] = compileComposition([switchOutBelow35]);
    expect(event).toBeInstanceOf(PostDamageAbAttr);
    expect(event.showAbility).toBe(true);
    const [afterHit] = compileComposition([
      {
        key: "after-hit-heal",
        when: { block: "event.after-hit" },
        do: [{ block: "effect.heal-percent", params: { target: "holder", percent: 10 } }],
        chance: 100,
      },
    ]);
    expect(afterHit).toBeInstanceOf(PostDefendAbAttr);
  });

  it("half damage at full HP: same arithmetic and rounding as the original (toDmgValue)", () => {
    const [carrier] = compileComposition([halfAtFullHp]) as unknown as [
      { canApply: (p: object) => boolean; apply: (p: object) => void },
    ];
    for (const damage of [1, 2, 3, 99, 100, 101]) {
      const full = { pokemon: fake(100, 100), opponent: fake(50, 50), move: undefined, damage: { value: damage } };
      expect(carrier.canApply(full)).toBe(true);
      carrier.apply(full);
      expect(full.damage.value).toBe(toDmgValue(damage * 0.5));
    }
    const hurt = { pokemon: fake(99, 100), opponent: fake(50, 50), move: undefined, damage: { value: 100 } };
    expect(carrier.canApply(hurt)).toBe(false);
  });

  it("evaluates the rule chance AFTER every condition: no dice are rolled when an IF fails", () => {
    const rule: CompositionRuleV2 = {
      key: "chance-after-ifs",
      when: { block: "event.after-hit" },
      if: [{ block: "hp.full", params: { who: "holder" } }],
      do: [{ block: "effect.heal-percent", params: { target: "holder", percent: 10 } }],
      chance: 40,
    };
    const [carrier] = compileComposition([rule]) as unknown as [{ canApply: (p: object) => boolean }];
    let draws = 0;
    const counting = (hp: number, roll: number) => {
      const pokemon = fake(hp, 100);
      pokemon.randBattleSeedInt = () => {
        draws++;
        return roll;
      };
      return { pokemon, opponent: fake(50, 50), damage: 10, hitResult: 0, simulated: false };
    };
    expect(carrier.canApply(counting(80, 0))).toBe(false);
    expect(draws).toBe(0);
    expect(carrier.canApply(counting(100, 39))).toBe(true);
    expect(draws).toBe(1);
    expect(carrier.canApply(counting(100, 40))).toBe(false);
    expect(draws).toBe(2);
    // Simulated calls never roll.
    const simulated = counting(100, 99);
    expect(carrier.canApply({ ...simulated, simulated: true })).toBe(true);
    expect(draws).toBe(2);
  });

  it("refuses to compile a rule that validation rejects, with the validation sentence", () => {
    expect(() => compileComposition([{ ...halfAtFullHp, do: [{ block: "effect.nope" }] }])).toThrow(
      /there is no effect called/,
    );
  });
});
