/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Parity of the composition carrier with the original attr classes: the carrier never runs its
// dispatch class's constructor, so every field the ENGINE reads outside canApply/apply must be set
// by hand. This test compares each composable WHEN's carrier with the V1 rule attr (where there is
// one) and with a really constructed instance of the dispatch class, on every no-argument method.
import {
  AbilityAttrs,
  ChangeMovePriorityAbAttr,
  MoveDamageBoostAbAttr,
  type PostSummonAbAttr,
  ReceivedMoveDamageMultiplierAbAttr,
} from "#abilities/ab-attrs";
import type { AbilityStudioRule } from "#data/elite-redux/ability-studio/ability-blueprint";
import {
  AbilityStudioPostAttackRuleAbAttr,
  AbilityStudioPostDefendRuleAbAttr,
  AbilityStudioPostFaintRuleAbAttr,
  AbilityStudioPostKnockOutRuleAbAttr,
  AbilityStudioPostSummonRuleAbAttr,
  AbilityStudioPostTurnRuleAbAttr,
} from "#data/elite-redux/ability-studio/rule-ab-attrs";
import { compileCompositionRule } from "#data/elite-redux/ability-studio/vocabulary/evaluate/compile-composition";
import type { CompositionRuleV2 } from "#data/elite-redux/ability-studio/vocabulary/index";
import { WHEN_REGISTRY } from "#data/elite-redux/ability-studio/vocabulary/index";
import { describe, expect, it } from "vitest";

const STAT_STAGE = { block: "effect.stat-stage", params: { target: "holder", stat: "ATK", stages: 1 } };
const DO_BY_WHEN: Record<string, CompositionRuleV2["do"][number]> = {
  "calc.move-power": { block: "effect.multiply-power", params: { multiplier: 2 } },
  "calc.damage-taken": { block: "effect.multiply-damage-taken", params: { multiplier: 0.5 } },
  "calc.priority": { block: "effect.change-priority", params: { amount: 1 } },
  "calc.damage-dealt": { block: "effect.multiply-damage-dealt", params: { multiplier: 2 } },
};

const ruleFor = (whenId: string): CompositionRuleV2 => ({
  key: "parity",
  when: { block: whenId },
  do: [DO_BY_WHEN[whenId] ?? STAT_STAGE],
  chance: 100,
});

const V1_RULE = {
  key: "v1",
  trigger: "on-entry",
  chance: 100,
  conditions: [],
  effects: [],
} as unknown as AbilityStudioRule;
const V1_BY_WHEN: Record<string, object> = {
  "event.on-entry": new AbilityStudioPostSummonRuleAbAttr(V1_RULE),
  "event.end-of-turn": new AbilityStudioPostTurnRuleAbAttr(V1_RULE),
  "event.after-hit": new AbilityStudioPostDefendRuleAbAttr(V1_RULE),
  "event.after-my-hit": new AbilityStudioPostAttackRuleAbAttr(V1_RULE),
  "event.on-ko": new AbilityStudioPostKnockOutRuleAbAttr(V1_RULE),
  "event.faint": new AbilityStudioPostFaintRuleAbAttr(V1_RULE),
};
const ORIGINAL_BY_WHEN: Record<string, object> = {
  "calc.damage-taken": new ReceivedMoveDamageMultiplierAbAttr(() => true, 0.5),
  "calc.damage-dealt": new MoveDamageBoostAbAttr(2, () => true),
  "calc.priority": new ChangeMovePriorityAbAttr(() => true, 1),
};

/** Methods the carrier replaces on purpose. */
const REPLACED = new Set(["constructor", "canApply", "apply", "getTriggerMessage"]);

function engineMethods(target: object): string[] {
  const names = new Set<string>();
  for (
    let proto = Object.getPrototypeOf(target);
    proto && proto !== Object.prototype;
    proto = Object.getPrototypeOf(proto)
  ) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      const desc = Object.getOwnPropertyDescriptor(proto, name);
      if (typeof desc?.value === "function" && !REPLACED.has(name) && desc.value.length === 0) {
        names.add(name);
      }
    }
  }
  return [...names];
}

const composable = WHEN_REGISTRY.filter(when => when.composable);

describe("composition carrier parity with the original classes", () => {
  it("covers every composable WHEN with a reference instance, or states why not", () => {
    const uncovered = composable
      .map(when => when.id)
      .filter(id => V1_BY_WHEN[id] === undefined && ORIGINAL_BY_WHEN[id] === undefined);
    // calc.move-power's dispatch class is abstract, after-taking-damage has no constructor state.
    expect(uncovered.sort()).toEqual(["calc.move-power", "event.after-taking-damage"]);
  });

  it("an on-entry rule activates when the ability is gained mid-battle, like the V1 rule attr", () => {
    const carrier = compileCompositionRule(ruleFor("event.on-entry")) as PostSummonAbAttr;
    expect(carrier.shouldActivateOnGain()).toBe(true);
    expect((V1_BY_WHEN["event.on-entry"] as PostSummonAbAttr).shouldActivateOnGain()).toBe(true);
  });

  for (const when of composable) {
    it(`${when.id}: the carrier answers every engine-called method like the original`, () => {
      const carrier = compileCompositionRule(ruleFor(when.id)) as unknown as Record<string, () => unknown>;
      expect(carrier).toBeInstanceOf((AbilityAttrs as unknown as Record<string, new () => object>)[when.dispatchKey!]);
      const reference = (V1_BY_WHEN[when.id] ?? ORIGINAL_BY_WHEN[when.id]) as Record<string, () => unknown> | undefined;
      if (reference === undefined) {
        return;
      }
      for (const name of engineMethods(reference)) {
        expect(carrier[name].call(carrier), `${name}()`).toEqual(reference[name].call(reference));
      }
    });
  }
});
