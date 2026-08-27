/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  AbAttr,
  PostAttackAbAttr,
  type PostMoveInteractionAbAttrParams,
  StatMultiplierAbAttr,
} from "#abilities/ab-attrs";
import { AbBuilder, type Ability } from "#abilities/ability";
import { allAbilities } from "#data/data-lists";
import {
  type AbilityStudioBlueprintV1,
  validateAbilityStudioBlueprints,
} from "#data/elite-redux/ability-studio/ability-blueprint";
import { compileAbilityStudioBlueprint } from "#data/elite-redux/ability-studio/compile-ability-blueprint";
import { describeAbilityStudioComponent } from "#data/elite-redux/ability-studio/component-semantics";
import {
  AbilityStudioPostAttackRuleAbAttr,
  AbilityStudioPostSummonRuleAbAttr,
  AbilityStudioPostTurnRuleAbAttr,
} from "#data/elite-redux/ability-studio/rule-ab-attrs";
import {
  ABILITY_STUDIO_RUNTIME_CAPABILITIES,
  abilityStudioAbilityHasCapability,
  abilityStudioAbilityReferencesSource,
  abilityStudioRuntimeComponentIsActive,
} from "#data/elite-redux/ability-studio/runtime-capabilities";
import {
  ABILITY_STUDIO_DIRECT_SOURCE_ABILITY_IDS,
  AbilityStudioRuntimeCapabilityAbAttr,
  AbilityStudioSourceAbilityAbAttr,
  installAbilityStudioSourceAbilityComponents,
} from "#data/elite-redux/ability-studio/runtime-components";
import { initEditorAuthoredAbilities } from "#data/elite-redux/init-editor-authored-abilities";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

class GuardedReusableEffectAbAttr extends PostAttackAbAttr {
  private readonly state: { allowed: boolean; checks: number; applications: number };

  constructor(state: { allowed: boolean; checks: number; applications: number }) {
    super(() => true, true);
    this.state = state;
  }

  override canApply(_params: PostMoveInteractionAbAttrParams): boolean {
    this.state.checks++;
    return this.state.allowed;
  }

  override apply(_params: PostMoveInteractionAbAttrParams): void {
    this.state.applications++;
  }
}

class GenericRuntimeCapabilityAbAttr extends AbAttr {}

const blueprint: AbilityStudioBlueprintV1 = {
  version: 1,
  id: 20001,
  name: "Ember Instinct",
  description: "Contact Fire moves may burn the target and raise Speed.",
  generation: 9,
  includes: [AbilityId.BLAZE],
  modifiers: [{ kind: "move-power", multiplier: 1.2, filter: { type: "FIRE" } }],
  rules: [
    {
      key: "fire-contact",
      trigger: "after-attack",
      chance: 30,
      conditions: [{ kind: "move", filter: { type: "FIRE", flag: "MAKES_CONTACT" } }],
      effects: [
        { kind: "status", target: "other", status: "BURN" },
        { kind: "stat-stage", target: "holder", stat: "SPD", stages: 1 },
      ],
    },
  ],
};

describe("Ability Studio", () => {
  it("validates a chained ability blueprint", () => {
    const result = validateAbilityStudioBlueprints({ "ember-instinct": blueprint });
    expect(result.errors).toEqual([]);
    expect(result.blueprints["ember-instinct"]).toEqual(blueprint);
  });

  it("evaluates ALL and ANY conditions differently", () => {
    const rule = {
      key: "mixed-conditions",
      trigger: "on-entry" as const,
      chance: 100,
      conditions: [
        { kind: "holder-hp" as const, maxPercent: 50 },
        { kind: "holder-status" as const, status: "NONE" as const },
      ],
      effects: [{ kind: "heal-percent" as const, target: "holder" as const, percent: 25 }],
    };
    const pokemon = { getHpRatio: () => 0.75, status: null };
    const allConditions = new AbilityStudioPostSummonRuleAbAttr({ ...rule, conditionLogic: "all" });
    const anyCondition = new AbilityStudioPostSummonRuleAbAttr({ ...rule, conditionLogic: "any" });
    expect(allConditions.canApply({ pokemon, simulated: true } as never)).toBe(false);
    expect(anyCondition.canApply({ pokemon, simulated: true } as never)).toBe(true);
  });

  it("rejects context that the selected trigger cannot provide", () => {
    const invalid = {
      ...blueprint,
      rules: [
        {
          ...blueprint.rules[0],
          trigger: "end-turn",
          effects: [{ kind: "status", target: "other", status: "BURN" }],
        },
      ],
    };
    const result = validateAbilityStudioBlueprints({ invalid });
    expect(result.errors.some(error => error.includes("cannot be other"))).toBe(true);
    expect(result.errors.some(error => error.includes("without that context"))).toBe(true);
  });

  it("preserves included ability gates and compiles rules and modifiers", () => {
    const included = new AbBuilder(AbilityId.BLAZE, 3)
      .attr(StatMultiplierAbAttr, Stat.ATK, 1.1)
      .condition(() => false)
      .build();
    const compiled = compileAbilityStudioBlueprint(blueprint, id => (id === AbilityId.BLAZE ? included : undefined));
    expect(compiled.name).toBe("Ember Instinct");
    expect(compiled.description).toBe(blueprint.description);
    expect(compiled.attrs.some(attr => attr instanceof AbilityStudioPostAttackRuleAbAttr)).toBe(true);
    expect(compiled.attrs[0]).not.toBe(included.attrs[0]);
    expect(compiled.attrs[0].getCondition()).not.toBeNull();
  });

  it("selects one exact runtime mechanic without copying its siblings", () => {
    const source = new AbBuilder(AbilityId.BLAZE, 3)
      .attr(StatMultiplierAbAttr, Stat.ATK, 1.1)
      .attr(StatMultiplierAbAttr, Stat.DEF, 1.2)
      .condition(() => false)
      .build();
    const selective: AbilityStudioBlueprintV1 = {
      ...blueprint,
      includes: [],
      mechanics: [{ abilityId: AbilityId.BLAZE, attrIndex: 1, attrType: "StatMultiplierAbAttr" }],
      modifiers: [],
      rules: [],
    };
    const result = validateAbilityStudioBlueprints({ selective });
    expect(result.errors).toEqual([]);
    const compiled = compileAbilityStudioBlueprint(selective, id => (id === AbilityId.BLAZE ? source : undefined));
    expect(compiled.attrs).toHaveLength(1);
    expect(compiled.attrs[0]).toBeInstanceOf(StatMultiplierAbAttr);
    expect(compiled.attrs[0]).not.toBe(source.attrs[1]);
    expect(compiled.attrs[0].getCondition()).not.toBeNull();
  });

  it("rejects a runtime mechanic when its generated type no longer matches", () => {
    const source = new AbBuilder(AbilityId.BLAZE, 3).attr(StatMultiplierAbAttr, Stat.ATK, 1.1).build();
    const selective: AbilityStudioBlueprintV1 = {
      ...blueprint,
      includes: [],
      mechanics: [{ abilityId: AbilityId.BLAZE, attrIndex: 0, attrType: "MovePowerBoostAbAttr" }],
      modifiers: [],
      rules: [],
    };
    expect(() => compileAbilityStudioBlueprint(selective, id => (id === AbilityId.BLAZE ? source : undefined))).toThrow(
      "is StatMultiplierAbAttr, expected MovePowerBoostAbAttr",
    );
  });

  it("compiles a decomposed hook and effect as one component rule", () => {
    const source = new AbBuilder(AbilityId.BLAZE, 3)
      .attr(StatMultiplierAbAttr, Stat.ATK, 1.1)
      .attr(StatMultiplierAbAttr, Stat.DEF, 1.2)
      .build();
    const componentBlueprint: AbilityStudioBlueprintV1 = {
      ...blueprint,
      includes: [],
      modifiers: [],
      rules: [],
      componentRules: [
        {
          key: "mixed-stat",
          hook: { abilityId: AbilityId.BLAZE, attrIndex: 0, attrType: "StatMultiplierAbAttr" },
          chance: 100,
          conditions: [],
          effects: [{ abilityId: AbilityId.BLAZE, attrIndex: 1, attrType: "StatMultiplierAbAttr" }],
        },
      ],
    };
    expect(validateAbilityStudioBlueprints({ "component-blueprint": componentBlueprint }).errors).toEqual([]);
    const compiled = compileAbilityStudioBlueprint(componentBlueprint, id =>
      id === AbilityId.BLAZE ? source : undefined,
    );
    expect(compiled.attrs).toHaveLength(1);
    expect(compiled.attrs[0]).toBeInstanceOf(StatMultiplierAbAttr);
    expect(compiled.attrs[0]).not.toBe(source.attrs[0]);
    expect(compiled.attrs[0].getCondition()).toBeNull();
  });

  it("mixes configurable primitive conditions and effects with an extracted runtime trigger", () => {
    const source = new AbBuilder(AbilityId.BLAZE, 3)
      .attr(AbilityStudioPostAttackRuleAbAttr, blueprint.rules[0])
      .build();
    const componentBlueprint: AbilityStudioBlueprintV1 = {
      ...blueprint,
      includes: [],
      modifiers: [],
      rules: [],
      componentRules: [
        {
          key: "configurable-runtime-rule",
          hook: { abilityId: AbilityId.BLAZE, attrIndex: 0, attrType: "AbilityStudioPostAttackRuleAbAttr" },
          chance: 100,
          conditions: [{ kind: "holder-hp", maxPercent: 50 }],
          effects: [{ kind: "stat-stage", target: "holder", stat: "SPD", stages: 2 }],
        },
      ],
    };
    expect(validateAbilityStudioBlueprints({ configurable: componentBlueprint }).errors).toEqual([]);
    const compiled = compileAbilityStudioBlueprint(componentBlueprint, id =>
      id === AbilityId.BLAZE ? source : undefined,
    );
    const attr = compiled.attrs[0] as AbilityStudioPostAttackRuleAbAttr;
    const pokemon = { getHpRatio: () => 0.5, randBattleSeedInt: () => 0 };
    expect(attr.canApply({ pokemon, simulated: true } as never)).toBe(true);
    pokemon.getHpRatio = () => 0.75;
    expect(attr.canApply({ pokemon, simulated: true } as never)).toBe(false);
  });

  it("reuses a holder-only effect under a different compatible trigger", () => {
    const source = new AbBuilder(AbilityId.BLAZE, 3)
      .attr(AbilityStudioPostAttackRuleAbAttr, blueprint.rules[0])
      .attr(AbilityStudioPostTurnRuleAbAttr, {
        key: "turn-speed",
        trigger: "end-turn",
        chance: 100,
        conditions: [],
        effects: [{ kind: "stat-stage", target: "holder", stat: "SPD", stages: 1 }],
      })
      .build();
    const componentBlueprint: AbilityStudioBlueprintV1 = {
      ...blueprint,
      includes: [],
      modifiers: [],
      rules: [],
      componentRules: [
        {
          key: "attack-then-speed",
          hook: { abilityId: AbilityId.BLAZE, attrIndex: 0, attrType: "AbilityStudioPostAttackRuleAbAttr" },
          chance: 100,
          conditions: [],
          effects: [{ abilityId: AbilityId.BLAZE, attrIndex: 1, attrType: "AbilityStudioPostTurnRuleAbAttr" }],
        },
      ],
    };
    const compiled = compileAbilityStudioBlueprint(componentBlueprint, id =>
      id === AbilityId.BLAZE ? source : undefined,
    );
    expect(compiled.attrs).toHaveLength(1);
    expect(compiled.attrs[0]).toBeInstanceOf(AbilityStudioPostAttackRuleAbAttr);
  });

  it("preserves an extracted effect's runtime eligibility gate", () => {
    const state = { allowed: false, checks: 0, applications: 0 };
    const sourceBuilder = new AbBuilder(AbilityId.BLAZE, 3).attr(AbilityStudioPostAttackRuleAbAttr, blueprint.rules[0]);
    sourceBuilder.attrs.push(new GuardedReusableEffectAbAttr(state));
    const source = sourceBuilder.build();
    const componentBlueprint: AbilityStudioBlueprintV1 = {
      ...blueprint,
      includes: [],
      modifiers: [],
      rules: [],
      componentRules: [
        {
          key: "guarded-reused-effect",
          hook: { abilityId: AbilityId.BLAZE, attrIndex: 0, attrType: "AbilityStudioPostAttackRuleAbAttr" },
          chance: 100,
          conditions: [],
          effects: [{ abilityId: AbilityId.BLAZE, attrIndex: 1, attrType: "GuardedReusableEffectAbAttr" }],
        },
      ],
    };
    const compiled = compileAbilityStudioBlueprint(componentBlueprint, id =>
      id === AbilityId.BLAZE ? source : undefined,
    );
    const attr = compiled.attrs[0] as AbilityStudioPostAttackRuleAbAttr;
    const params = { pokemon: { randBattleSeedInt: () => 0 } } as unknown as PostMoveInteractionAbAttrParams;
    expect(attr.canApply(params)).toBe(false);
    expect(state).toEqual({ allowed: false, checks: 1, applications: 0 });
    state.allowed = true;
    expect(attr.canApply(params)).toBe(true);
    attr.apply(params);
    expect(state).toEqual({ allowed: true, checks: 2, applications: 1 });
  });

  it("requires ordered prerequisite hooks before a component rule can fire", () => {
    const source = new AbBuilder(AbilityId.BLAZE, 3)
      .attr(AbilityStudioPostSummonRuleAbAttr, {
        key: "entry-signal",
        trigger: "on-entry",
        chance: 100,
        conditions: [],
        effects: [{ kind: "stat-stage", target: "holder", stat: "ATK", stages: 1 }],
      })
      .attr(
        AbilityStudioRuntimeCapabilityAbAttr,
        ABILITY_STUDIO_RUNTIME_CAPABILITIES.CHLOROPLAST_SUN_MOVES,
        "Apply the terminal effect",
        "terminal-runtime-check",
        "When the terminal runtime check occurs",
      )
      .build();
    const chained: AbilityStudioBlueprintV1 = {
      ...blueprint,
      includes: [],
      modifiers: [],
      rules: [],
      componentRules: [
        {
          key: "ordered-runtime-chain",
          prerequisiteHooks: [
            { abilityId: AbilityId.BLAZE, attrIndex: 0, attrType: "AbilityStudioPostSummonRuleAbAttr" },
          ],
          hook: { abilityId: AbilityId.BLAZE, attrIndex: 1, attrType: "AbilityStudioRuntimeCapabilityAbAttr" },
          chance: 100,
          conditions: [],
          effects: [{ abilityId: AbilityId.BLAZE, attrIndex: 1, attrType: "AbilityStudioRuntimeCapabilityAbAttr" }],
        },
      ],
    };
    expect(validateAbilityStudioBlueprints({ chained }).errors).toEqual([]);
    const compiled = compileAbilityStudioBlueprint(chained, id => (id === AbilityId.BLAZE ? source : undefined));
    expect(compiled.attrs).toHaveLength(2);
    const pokemon = { battleData: {}, randBattleSeedInt: () => 0 };
    expect(compiled.attrs[1].canApply({ pokemon } as never)).toBe(false);
    compiled.attrs[0].apply({ pokemon } as never);
    expect(compiled.attrs[1].canApply({ pokemon } as never)).toBe(true);
    compiled.attrs[1].apply({ pokemon } as never);
    expect(compiled.attrs[1].canApply({ pokemon } as never)).toBe(false);
  });

  it("applies ANY logic to reused runtime conditions", () => {
    const source = new AbBuilder(AbilityId.BLAZE, 3)
      .attr(StatMultiplierAbAttr, Stat.ATK, 1.1)
      .condition(() => false)
      .condition(() => true)
      .build();
    const componentBlueprint: AbilityStudioBlueprintV1 = {
      ...blueprint,
      includes: [],
      modifiers: [],
      rules: [],
      componentRules: [
        {
          key: "any-runtime-condition",
          hook: { abilityId: AbilityId.BLAZE, attrIndex: 0, attrType: "StatMultiplierAbAttr" },
          chance: 100,
          conditionLogic: "any",
          conditions: [
            {
              abilityId: AbilityId.BLAZE,
              attrIndex: 0,
              attrType: "StatMultiplierAbAttr",
              kind: "ability",
              conditionIndex: 0,
            },
            {
              abilityId: AbilityId.BLAZE,
              attrIndex: 0,
              attrType: "StatMultiplierAbAttr",
              kind: "ability",
              conditionIndex: 1,
            },
          ],
          effects: [{ abilityId: AbilityId.BLAZE, attrIndex: 0, attrType: "StatMultiplierAbAttr" }],
        },
      ],
    };
    expect(validateAbilityStudioBlueprints({ "any-runtime-condition": componentBlueprint }).errors).toEqual([]);
    const compiled = compileAbilityStudioBlueprint(componentBlueprint, id =>
      id === AbilityId.BLAZE ? source : undefined,
    );
    expect(
      compiled.attrs[0].canApply({
        pokemon: {},
        simulated: true,
        move: {},
        stat: Stat.ATK,
        statVal: { value: 1 },
      } as never),
    ).toBe(true);
  });

  it("arms an effect across different runtime hooks", () => {
    const source = new AbBuilder(AbilityId.BLAZE, 3)
      .attr(StatMultiplierAbAttr, Stat.ATK, 1.1)
      .attr(AbilityStudioPostAttackRuleAbAttr, blueprint.rules[0])
      .build();
    const componentBlueprint: AbilityStudioBlueprintV1 = {
      ...blueprint,
      includes: [],
      modifiers: [],
      rules: [],
      componentRules: [
        {
          key: "cross-hook",
          hook: { abilityId: AbilityId.BLAZE, attrIndex: 0, attrType: "StatMultiplierAbAttr" },
          chance: 100,
          conditions: [],
          effects: [{ abilityId: AbilityId.BLAZE, attrIndex: 1, attrType: "AbilityStudioPostAttackRuleAbAttr" }],
        },
      ],
    };
    const compiled = compileAbilityStudioBlueprint(componentBlueprint, id =>
      id === AbilityId.BLAZE ? source : undefined,
    );
    expect(compiled.attrs).toHaveLength(2);
    const pokemon = { battleData: {} };
    expect(compiled.attrs[1].getCondition()?.(pokemon as never)).toBe(false);
    compiled.attrs[0].apply({ pokemon, simulated: false } as never);
    expect(compiled.attrs[1].getCondition()?.(pokemon as never)).toBe(true);
  });

  it("observes an event IF gate across different runtime hooks", () => {
    const state = { allowed: true, checks: 0, applications: 0 };
    const sourceBuilder = new AbBuilder(AbilityId.BLAZE, 3).attr(AbilityStudioPostSummonRuleAbAttr, {
      key: "entry",
      trigger: "on-entry",
      chance: 100,
      conditions: [],
      effects: [{ kind: "stat-stage", target: "holder", stat: "ATK", stages: 1 }],
    });
    sourceBuilder.attrs.push(new GuardedReusableEffectAbAttr(state));
    const source = sourceBuilder.build();
    const componentBlueprint: AbilityStudioBlueprintV1 = {
      ...blueprint,
      includes: [],
      modifiers: [],
      rules: [],
      componentRules: [
        {
          key: "observed-gate",
          hook: { abilityId: AbilityId.BLAZE, attrIndex: 0, attrType: "AbilityStudioPostSummonRuleAbAttr" },
          chance: 100,
          conditions: [
            {
              abilityId: AbilityId.BLAZE,
              attrIndex: 1,
              attrType: "GuardedReusableEffectAbAttr",
              kind: "event",
            },
          ],
          effects: [{ kind: "stat-stage", target: "holder", stat: "SPD", stages: 1 }],
        },
      ],
    };
    const compiled = compileAbilityStudioBlueprint(componentBlueprint, id =>
      id === AbilityId.BLAZE ? source : undefined,
    );
    expect(compiled.attrs).toHaveLength(2);
    const params = { pokemon: { battleData: {}, randBattleSeedInt: () => 0 }, simulated: false };
    expect(compiled.attrs[1].canApply(params as never)).toBe(false);
    expect(compiled.attrs[0].canApply(params as never)).toBe(true);
    compiled.attrs[0].apply(params as never);
    expect(compiled.attrs[1].canApply(params as never)).toBe(true);
  });

  it("compiles a direct runtime capability as an independently reusable component", () => {
    const source = new AbBuilder(AbilityId.BLAZE, 3)
      .attr(
        AbilityStudioRuntimeCapabilityAbAttr,
        ABILITY_STUDIO_RUNTIME_CAPABILITIES.CHLOROPLAST_SUN_MOVES,
        "Make sun-sensitive moves act as if used in sun",
        "sun-sensitive-move-calculation",
        "When using a sun-sensitive move",
      )
      .build();
    const componentBlueprint: AbilityStudioBlueprintV1 = {
      ...blueprint,
      includes: [],
      modifiers: [],
      rules: [],
      componentRules: [
        {
          key: "sun-sensitive-moves",
          hook: {
            abilityId: AbilityId.BLAZE,
            attrIndex: 0,
            attrType: "AbilityStudioRuntimeCapabilityAbAttr",
          },
          chance: 100,
          conditions: [],
          effects: [
            {
              abilityId: AbilityId.BLAZE,
              attrIndex: 0,
              attrType: "AbilityStudioRuntimeCapabilityAbAttr",
            },
          ],
        },
      ],
    };
    const compiled = compileAbilityStudioBlueprint(componentBlueprint, id =>
      id === AbilityId.BLAZE ? source : undefined,
    );
    expect(compiled.attrs).toHaveLength(1);
    expect(abilityStudioAbilityHasCapability(compiled, ABILITY_STUDIO_RUNTIME_CAPABILITIES.CHLOROPLAST_SUN_MOVES)).toBe(
      true,
    );
  });

  it("activates a direct runtime capability from another hook", () => {
    const source = new AbBuilder(AbilityId.BLAZE, 3)
      .attr(AbilityStudioPostSummonRuleAbAttr, {
        key: "entry",
        trigger: "on-entry",
        chance: 100,
        conditions: [],
        effects: [{ kind: "stat-stage", target: "holder", stat: "ATK", stages: 1 }],
      })
      .attr(
        AbilityStudioRuntimeCapabilityAbAttr,
        ABILITY_STUDIO_RUNTIME_CAPABILITIES.CHLOROPLAST_SUN_MOVES,
        "Make sun-sensitive moves act as if used in sun",
        "sun-sensitive-move-calculation",
        "When using a sun-sensitive move",
      )
      .build();
    const componentBlueprint: AbilityStudioBlueprintV1 = {
      ...blueprint,
      includes: [],
      modifiers: [],
      rules: [],
      componentRules: [
        {
          key: "activate-sun-sensitive-moves",
          hook: { abilityId: AbilityId.BLAZE, attrIndex: 0, attrType: "AbilityStudioPostSummonRuleAbAttr" },
          chance: 100,
          conditions: [],
          effects: [
            {
              abilityId: AbilityId.BLAZE,
              attrIndex: 1,
              attrType: "AbilityStudioRuntimeCapabilityAbAttr",
            },
          ],
        },
      ],
    };
    const compiled = compileAbilityStudioBlueprint(componentBlueprint, id =>
      id === AbilityId.BLAZE ? source : undefined,
    );
    const pokemon = { battleData: {} };
    expect(
      abilityStudioAbilityHasCapability(
        compiled,
        ABILITY_STUDIO_RUNTIME_CAPABILITIES.CHLOROPLAST_SUN_MOVES,
        pokemon as never,
      ),
    ).toBe(false);
    compiled.attrs[0].apply({ pokemon, simulated: false } as never);
    expect(
      abilityStudioAbilityHasCapability(
        compiled,
        ABILITY_STUDIO_RUNTIME_CAPABILITIES.CHLOROPLAST_SUN_MOVES,
        pokemon as never,
      ),
    ).toBe(true);
  });

  it("activates any direct runtime package from another hook", () => {
    const source = new AbBuilder(AbilityId.BLAZE, 3)
      .attr(AbilityStudioPostSummonRuleAbAttr, {
        key: "entry",
        trigger: "on-entry",
        chance: 100,
        conditions: [],
        effects: [{ kind: "stat-stage", target: "holder", stat: "ATK", stages: 1 }],
      })
      .attr(GenericRuntimeCapabilityAbAttr)
      .build();
    const componentBlueprint: AbilityStudioBlueprintV1 = {
      ...blueprint,
      includes: [],
      modifiers: [],
      rules: [],
      componentRules: [
        {
          key: "activate-generic-package",
          hook: { abilityId: AbilityId.BLAZE, attrIndex: 0, attrType: "AbilityStudioPostSummonRuleAbAttr" },
          chance: 100,
          conditions: [],
          effects: [{ abilityId: AbilityId.BLAZE, attrIndex: 1, attrType: "GenericRuntimeCapabilityAbAttr" }],
        },
      ],
    };
    const compiled = compileAbilityStudioBlueprint(componentBlueprint, id =>
      id === AbilityId.BLAZE ? source : undefined,
    );
    const pokemon = { battleData: {} };
    expect(abilityStudioRuntimeComponentIsActive(compiled.attrs[1], pokemon as never)).toBe(false);
    compiled.attrs[0].apply({ pokemon, simulated: false } as never);
    expect(abilityStudioRuntimeComponentIsActive(compiled.attrs[1], pokemon as never)).toBe(true);
  });

  it("exposes direct source-ability checks as an independently reusable component", () => {
    const source = new AbBuilder(AbilityId.STANCE_CHANGE, 6).build();
    expect(installAbilityStudioSourceAbilityComponents([source])).toBe(1);
    expect(installAbilityStudioSourceAbilityComponents([source])).toBe(0);
    const sourceAttr = source.attrs[0];
    expect(sourceAttr).toBeInstanceOf(AbilityStudioSourceAbilityAbAttr);
    const componentBlueprint: AbilityStudioBlueprintV1 = {
      ...blueprint,
      includes: [],
      modifiers: [],
      rules: [],
      componentRules: [
        {
          key: "stance-change-identity",
          hook: { abilityId: AbilityId.STANCE_CHANGE, attrIndex: 0, attrType: "AbilityStudioSourceAbilityAbAttr" },
          chance: 100,
          conditions: [],
          effects: [{ abilityId: AbilityId.STANCE_CHANGE, attrIndex: 0, attrType: "AbilityStudioSourceAbilityAbAttr" }],
        },
      ],
    };
    const compiled = compileAbilityStudioBlueprint(componentBlueprint, id =>
      id === AbilityId.STANCE_CHANGE ? source : undefined,
    );
    expect(abilityStudioAbilityReferencesSource(compiled, AbilityId.STANCE_CHANGE)).toBe(true);
    expect(abilityStudioAbilityReferencesSource(compiled, AbilityId.BLAZE)).toBe(false);
  });

  it("only adds identity packages for abilities used by direct engine checks", () => {
    const direct = new AbBuilder(AbilityId.STANCE_CHANGE, 6).build();
    const ordinary = new AbBuilder(AbilityId.BLAZE, 3).build();
    expect(ABILITY_STUDIO_DIRECT_SOURCE_ABILITY_IDS.has(AbilityId.STANCE_CHANGE)).toBe(true);
    expect(ABILITY_STUDIO_DIRECT_SOURCE_ABILITY_IDS.has(AbilityId.BLAZE)).toBe(false);
    expect(installAbilityStudioSourceAbilityComponents([direct, ordinary])).toBe(1);
    expect(direct.attrs[0]).toBeInstanceOf(AbilityStudioSourceAbilityAbAttr);
    expect(ordinary.attrs).toEqual([]);
  });

  it("describes a runtime primitive with its configured values and source semantics", () => {
    const source = new AbBuilder(AbilityId.BLAZE, 3).attr(StatMultiplierAbAttr, Stat.ATK, 1.5).build();
    const semantics = describeAbilityStudioComponent(source, source.attrs[0]);
    expect(semantics.label).toBe("Multiply a calculated stat");
    expect(semantics.summary).toContain(source.description);
    expect(semantics.parameters.some(parameter => parameter.value === "ATK")).toBe(true);
  });

  it("registers an authored ability in the runtime ability table", () => {
    const mutableAbilities = allAbilities as Ability[];
    const existing = allAbilities[blueprint.id];
    try {
      const result = initEditorAuthoredAbilities({ "ember-instinct": blueprint });
      expect(result).toEqual({ registered: 1, errors: [] });
      expect(allAbilities[blueprint.id].name).toBe(blueprint.name);
      expect(allAbilities[blueprint.id].attrs.some(attr => attr instanceof AbilityStudioPostAttackRuleAbAttr)).toBe(
        true,
      );
    } finally {
      if (existing === undefined) {
        delete mutableAbilities[blueprint.id];
      } else {
        mutableAbilities[blueprint.id] = existing;
      }
    }
  });

  describe("JSON-authored combat composition", () => {
    let phaserGame: Phaser.Game;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    it("runs a cross-hook composition through a real battle", async () => {
      const fixture = JSON.parse(
        readFileSync(resolve(process.cwd(), "test/fixtures/elite-redux/ability-studio/entry-momentum.json"), "utf8"),
      ) as unknown;
      const validation = validateAbilityStudioBlueprints({ "entry-momentum": fixture });
      expect(validation.errors).toEqual([]);
      const authored = validation.blueprints["entry-momentum"];
      const compiled = compileAbilityStudioBlueprint(authored, id => allAbilities[id]);
      const mutableAbilities = allAbilities as Ability[];
      const existing = allAbilities[authored.id];
      mutableAbilities[authored.id] = compiled;

      try {
        const game = new GameManager(phaserGame);
        game.override
          .battleStyle("single")
          .ability(authored.id as AbilityId)
          .moveset(MoveId.SPLASH)
          .enemySpecies(SpeciesId.SHUCKLE)
          .enemyAbility(AbilityId.BALL_FETCH)
          .enemyMoveset(MoveId.SPLASH);
        await game.classicMode.startBattle(SpeciesId.FEEBAS);

        const player = game.field.getPlayerPokemon();
        expect(player.getAbility().name).toBe("Entry Momentum");
        expect(player.getStatStage(Stat.SPD)).toBe(1);

        game.move.select(MoveId.SPLASH);
        await game.toNextTurn();
        expect(player.getStatStage(Stat.SPD)).toBe(1);
      } finally {
        if (existing === undefined) {
          delete mutableAbilities[authored.id];
        } else {
          mutableAbilities[authored.id] = existing;
        }
      }
    });
  });
});
