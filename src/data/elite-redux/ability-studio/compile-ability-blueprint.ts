/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  type AbAttr,
  ChangeMovePriorityAbAttr,
  MovePowerBoostAbAttr,
  ReceivedMoveDamageMultiplierAbAttr,
  StatMultiplierAbAttr,
} from "#abilities/ab-attrs";
import { AbBuilder, type Ability } from "#abilities/ability";
import { AbilityId } from "#enums/ability-id";
import { Stat } from "#enums/stat";
import type { AbilityStudioBlueprintV1 } from "./ability-blueprint";
import {
  AbilityStudioPostAttackRuleAbAttr,
  AbilityStudioPostDefendRuleAbAttr,
  AbilityStudioPostFaintRuleAbAttr,
  AbilityStudioPostKnockOutRuleAbAttr,
  AbilityStudioPostSummonRuleAbAttr,
  AbilityStudioPostTurnRuleAbAttr,
  matchesAbilityStudioMoveFilter,
} from "./rule-ab-attrs";
import { compileAbilityStudioRuntimeComponentRuleAttrs } from "./runtime-components";

function cloneAbilityAttr(ability: Ability, attrIndex: number, attrType?: string): AbAttr {
  const attr = ability.attrs[attrIndex];
  if (attr === undefined) {
    throw new Error(`ability ${ability.id} has no runtime mechanic at index ${attrIndex}`);
  }
  const runtimeType = attr.constructor.name;
  if (attrType !== undefined && runtimeType !== attrType) {
    throw new Error(`ability ${ability.id} mechanic ${attrIndex} is ${runtimeType}, expected ${attrType}`);
  }
  const clone = Object.assign(Object.create(Object.getPrototypeOf(attr)), attr) as AbAttr;
  if (ability.conditions.length === 0) {
    return clone;
  }
  const existing = clone.getCondition();
  clone.addCondition(
    pokemon => ability.conditions.every(condition => condition(pokemon)) && (existing === null || existing(pokemon)),
  );
  return clone;
}

function cloneIncludedAttrs(ability: Ability): AbAttr[] {
  return ability.attrs.map((_attr, index) => cloneAbilityAttr(ability, index));
}

function addRule(builder: AbBuilder, rule: AbilityStudioBlueprintV1["rules"][number]): void {
  switch (rule.trigger) {
    case "on-entry":
      builder.attr(AbilityStudioPostSummonRuleAbAttr, rule);
      break;
    case "after-attack":
      builder.attr(AbilityStudioPostAttackRuleAbAttr, rule);
      break;
    case "after-hit":
      builder.attr(AbilityStudioPostDefendRuleAbAttr, rule);
      break;
    case "after-ko":
      builder.attr(AbilityStudioPostKnockOutRuleAbAttr, rule);
      break;
    case "end-turn":
      builder.attr(AbilityStudioPostTurnRuleAbAttr, rule);
      break;
    case "after-faint":
      builder.attr(AbilityStudioPostFaintRuleAbAttr, rule);
      break;
  }
}

function addModifier(builder: AbBuilder, modifier: AbilityStudioBlueprintV1["modifiers"][number]): void {
  switch (modifier.kind) {
    case "move-power":
      builder.attr(
        MovePowerBoostAbAttr,
        (user, _target, move) => matchesAbilityStudioMoveFilter(user, move, modifier.filter),
        modifier.multiplier,
      );
      break;
    case "received-damage":
      builder.attr(
        ReceivedMoveDamageMultiplierAbAttr,
        (_holder, attacker, move) => matchesAbilityStudioMoveFilter(attacker, move, modifier.filter),
        modifier.multiplier,
      );
      break;
    case "stat-multiplier":
      builder.attr(StatMultiplierAbAttr, Stat[modifier.stat], modifier.multiplier);
      break;
    case "priority":
      builder.attr(
        ChangeMovePriorityAbAttr,
        (holder, move) => matchesAbilityStudioMoveFilter(holder, move, modifier.filter),
        modifier.amount,
      );
      break;
  }
}

function enumKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function compileAbilityStudioBlueprint(
  blueprint: AbilityStudioBlueprintV1,
  resolveAbility: (id: number) => Ability | undefined,
): Ability {
  (AbilityId as unknown as Record<number, string>)[blueprint.id] = enumKey(blueprint.name);
  const includedAbilities = blueprint.includes.map(includedId => {
    const ability = resolveAbility(includedId);
    if (ability === undefined) {
      throw new Error(`included ability ${includedId} is not registered`);
    }
    return ability;
  });
  const referencedMechanics = (blueprint.mechanics ?? []).map(mechanic => {
    const ability = resolveAbility(mechanic.abilityId);
    if (ability === undefined) {
      throw new Error(`mechanic source ability ${mechanic.abilityId} is not registered`);
    }
    return { mechanic, ability };
  });
  const componentAbilityIds = new Set(
    (blueprint.componentRules ?? []).flatMap(rule => [
      ...(rule.prerequisiteHooks ?? []).map(hook => hook.abilityId),
      rule.hook.abilityId,
      ...rule.conditions.map(condition => condition.abilityId),
      ...rule.effects.map(effect => effect.abilityId),
    ]),
  );
  const componentAbilities = [...componentAbilityIds].map(id => {
    const ability = resolveAbility(id);
    if (ability === undefined) {
      throw new Error(`component source ability ${id} is not registered`);
    }
    return ability;
  });
  const sourceAbilities = [
    ...includedAbilities,
    ...referencedMechanics.map(reference => reference.ability),
    ...componentAbilities,
  ];
  const postSummonPriority = sourceAbilities.reduce(
    (priority, ability) => Math.max(priority, ability.postSummonPriority),
    0,
  );
  const builder = new AbBuilder(blueprint.id as AbilityId, blueprint.generation, postSummonPriority);
  for (const included of includedAbilities) {
    builder.attrs.push(...cloneIncludedAttrs(included));
  }
  for (const { mechanic, ability } of referencedMechanics) {
    builder.attrs.push(cloneAbilityAttr(ability, mechanic.attrIndex, mechanic.attrType));
  }
  for (const componentRule of blueprint.componentRules ?? []) {
    builder.attrs.push(...compileAbilityStudioRuntimeComponentRuleAttrs(componentRule, resolveAbility));
  }
  for (const modifier of blueprint.modifiers) {
    addModifier(builder, modifier);
  }
  for (const rule of blueprint.rules) {
    addRule(builder, rule);
  }
  if (
    blueprint.flags?.bypassFaint
    || blueprint.rules.some(rule => rule.trigger === "after-faint")
    || sourceAbilities.some(ability => ability.bypassFaint)
  ) {
    builder.bypassFaint();
  }
  if (blueprint.flags?.ignorable) {
    builder.ignorable();
  }
  if (blueprint.flags?.unsuppressable) {
    builder.unsuppressable();
  }
  if (blueprint.flags?.uncopiable) {
    builder.uncopiable();
  }
  if (blueprint.flags?.unreplaceable) {
    builder.unreplaceable();
  }
  const ability = builder.build();
  Object.defineProperty(ability, "name", {
    value: blueprint.name,
    configurable: true,
    enumerable: true,
    writable: false,
  });
  Object.defineProperty(ability, "description", {
    value: blueprint.description,
    configurable: true,
    enumerable: true,
    writable: false,
  });
  return ability;
}
