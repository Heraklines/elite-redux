/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// L3 compile matrix (no battle): every WHEN x IF x DO triple's `requires subset of provides` verdict, derived
// independently in compile-oracle.ts from the pure vocabulary, must agree with whether the real compile
// throws, and the message must name the block and the missing slot in plain language. Also the staff
// validator (validateComposition) must agree with compile on every triple.
import { compileCompositionRule } from "#data/elite-redux/ability-studio/vocabulary/evaluate/compile-composition";
import type { CompositionRuleV2 } from "#data/elite-redux/ability-studio/vocabulary/index";
import { validateComposition } from "#data/elite-redux/ability-studio/vocabulary/validate-composition";
import {
  ALL_CONDITIONS,
  ALL_EFFECTS,
  ALL_WHENS,
  conditionVariants,
  defaultsOf,
  slotWord,
  verdictFor,
} from "#test/tests/elite-redux/decomp/harness/compile-oracle";
import { describe, expect, it } from "vitest";

const INTERNAL_WORDS = /AbAttr|undefined|\[object|TypeError|ReferenceError|NaN|at Object\./;

function ruleFor(
  whenId: string,
  ifs: CompositionRuleV2["if"],
  doBlock: string,
  doParams: Record<string, string | number | boolean>,
): CompositionRuleV2 {
  return {
    key: "matrix-probe",
    when: { block: whenId },
    ...(ifs === undefined ? {} : { if: ifs }),
    do: [{ block: doBlock, params: doParams }],
    chance: 100,
  };
}

function compileMessage(rule: CompositionRuleV2): string | undefined {
  try {
    compileCompositionRule(rule);
    return;
  } catch (error) {
    return (error as Error).message;
  }
}

describe("L3 compile matrix", () => {
  it("covers every WHEN, atom and effect of the vocabulary", () => {
    console.log(
      `DECOMP_L3 matrix whens=${ALL_WHENS.length} atoms=${ALL_CONDITIONS.length} effects=${ALL_EFFECTS.length}`,
    );
    expect(ALL_WHENS.length).toBeGreaterThan(90);
    expect(ALL_CONDITIONS.length).toBeGreaterThan(50);
    expect(ALL_EFFECTS.length).toBeGreaterThan(30);
  });

  // ~1.7 million triples since the B19 library additions (about 1 min on the test machine), so the default 20 s is too short.
  it("WHEN x IF x DO: the oracle's verdict equals whether compile throws, and failures name the block (and the slot)", () => {
    const started = Date.now();
    let triples = 0;
    let compiled = 0;
    const wrong: string[] = [];
    const unreadable: string[] = [];
    for (const when of ALL_WHENS) {
      for (const effect of ALL_EFFECTS) {
        const effectParams = defaultsOf(effect.params);
        for (const cond of ALL_CONDITIONS) {
          for (const condParams of conditionVariants(cond)) {
            triples++;
            const verdict = verdictFor(when, cond, condParams, effect);
            const rule = ruleFor(when.id, [{ block: cond.id, params: condParams }], effect.id, effectParams);
            const message = compileMessage(rule);
            const threw = message !== undefined;
            if (verdict.ok === threw) {
              if (wrong.length < 15) {
                wrong.push(
                  `${when.id} + ${cond.id}${JSON.stringify(condParams)} + ${effect.id}: expected ${verdict.ok ? "to compile" : `to fail (${verdict.why})`}, `
                    + `${threw ? `but it threw: ${message}` : "but it compiled"}`,
                );
              }
              continue;
            }
            if (!verdict.ok && message !== undefined) {
              const named = verdict.mentions.length === 0 || verdict.mentions.some(text => message.includes(text));
              if ((!named || INTERNAL_WORDS.test(message)) && unreadable.length < 15) {
                unreadable.push(
                  `${when.id} + ${cond.id} + ${effect.id} (${verdict.why}): "${message}" should mention ${verdict.mentions.join(" / ")}`,
                );
              }
            } else {
              compiled++;
            }
          }
        }
      }
    }
    console.log(`DECOMP_L3 matrix triples=${triples} compiled=${compiled} ${Date.now() - started}ms`);
    expect(wrong).toEqual([]);
    expect(unreadable).toEqual([]);
    expect(compiled).toBeGreaterThan(100);
  }, 180_000);

  it("the staff validator and compile agree on every WHEN x DO pair with no IF", () => {
    const disagreements: string[] = [];
    for (const when of ALL_WHENS) {
      for (const effect of ALL_EFFECTS) {
        const rule = ruleFor(when.id, undefined, effect.id, defaultsOf(effect.params));
        const validatorSays = validateComposition([rule]);
        const compileSays = compileMessage(rule);
        const verdict = verdictFor(when, undefined, {}, effect);
        if (
          (validatorSays.length === 0) !== (compileSays === undefined)
          || verdict.ok !== (compileSays === undefined)
        ) {
          disagreements.push(
            `${when.id} + ${effect.id}: validator ${validatorSays.length === 0 ? "ok" : "no"}, compile ${compileSays === undefined ? "ok" : "no"}, oracle ${verdict.ok ? "ok" : "no"}`,
          );
        }
      }
    }
    expect(disagreements.slice(0, 15)).toEqual([]);
  });

  it("groups do not change the verdict: all, any and not inherit the requirement of their members", () => {
    const wrong: string[] = [];
    for (const when of ALL_WHENS.filter(w => w.composable === true)) {
      for (const cond of ALL_CONDITIONS.filter(c => c.escapeHatch !== true)) {
        const effect = ALL_EFFECTS.find(
          e =>
            e.implemented
            && e.kind === (when.kind === "calc" ? "calc" : "event")
            && (when.kind !== "calc" || e.modifies === when.modifies),
        );
        if (effect === undefined) {
          continue;
        }
        const params = conditionVariants(cond)[0];
        const base = verdictFor(when, cond, params, effect).ok;
        for (const wrap of [
          (n: object) => ({ all: [n] }),
          (n: object) => ({ any: [n] }),
          (n: object) => ({ not: n }),
        ]) {
          const rule = ruleFor(
            when.id,
            [wrap({ block: cond.id, params }) as never],
            effect.id,
            defaultsOf(effect.params),
          );
          if ((compileMessage(rule) === undefined) !== base) {
            wrong.push(`${when.id} + ${cond.id} in a group`);
          }
        }
      }
    }
    expect(wrong.slice(0, 10)).toEqual([]);
  });
});

describe("L3 plain-language failure messages", () => {
  const cases: { name: string; rule: CompositionRuleV2; mustContain: string[] }[] = [
    {
      name: "a condition that needs a move at a moment with no move",
      rule: ruleFor(
        "event.on-entry",
        [{ block: "move.type", params: { type: "FIRE", effective: true } }],
        "effect.stat-stage",
        { target: "holder", stat: "ATK", stages: 1 },
      ),
      mustContain: ['"move.type"', slotWord("move"), "When I enter the battle"],
    },
    {
      name: "a damage test at a moment that has no damage",
      rule: ruleFor(
        "event.on-entry",
        [{ block: "hp.crossed-below", params: { who: "holder", ratio: 0.5, rounding: "exact" } }],
        "effect.stat-stage",
        { target: "holder", stat: "ATK", stages: 1 },
      ),
      mustContain: ['"hp.crossed-below"', slotWord("damage"), "does not provide"],
    },
    {
      name: "dice while the game is only calculating",
      rule: ruleFor(
        "calc.damage-taken",
        [{ block: "rng.chance", params: { pct: 30 } }],
        "effect.multiply-damage-taken",
        { multiplier: 0.5, affectsFixedDamage: false },
      ),
      mustContain: ["rolls dice or remembers things", "While the game"],
    },
    {
      name: "a calculation effect at an event",
      rule: ruleFor("event.after-hit", undefined, "effect.multiply-damage-taken", {
        multiplier: 0.5,
        affectsFixedDamage: false,
      }),
      mustContain: ["effect.multiply-damage-taken", "pick a"],
    },
    {
      name: "an effect that is only planned",
      rule: ruleFor("event.after-hit", undefined, "effect.apply-tag", { target: "holder", tag: "TAUNT" }),
      mustContain: ['"effect.apply-tag"', "cannot run yet"],
    },
    {
      name: "an effect whose safety rule needs something the trigger does not provide",
      rule: ruleFor("event.on-entry", undefined, "effect.force-switch-out", {}),
      mustContain: ['safety rule "not-already-forced-out"', "the other pokemon"],
    },
    {
      name: "a trigger that is not wired yet",
      rule: ruleFor("event.wake-up", undefined, "effect.stat-stage", { target: "holder", stat: "ATK", stages: 1 }),
      mustContain: ["cannot be used in a rule yet"],
    },
    {
      name: "an unknown block id",
      rule: ruleFor("event.after-hit", [{ block: "hp.nonsense" }], "effect.stat-stage", {
        target: "holder",
        stat: "ATK",
        stages: 1,
      }),
      mustContain: ['there is no condition called "hp.nonsense"'],
    },
    {
      name: "a value out of range, naming the setting",
      rule: ruleFor("calc.damage-taken", undefined, "effect.multiply-damage-taken", {
        multiplier: 40,
        affectsFixedDamage: false,
      }),
      mustContain: ["Multiplier", "at most"],
    },
  ];
  for (const testCase of cases) {
    it(`names the block and the problem for ${testCase.name}`, () => {
      const message = compileMessage(testCase.rule);
      expect(message, "compile should have thrown").toBeDefined();
      for (const text of testCase.mustContain.filter(t => t !== "")) {
        expect(message).toContain(text);
      }
      expect(message).not.toMatch(INTERNAL_WORDS);
    });
  }
});
