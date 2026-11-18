/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Registers test abilities built from V2 `composition` rules (the staff path: blueprint, validate,
// compile). Used by the golden recipes, the compile fuzz and the drift self-tests. Ids come from the
// blueprint band 29500-29999 (shadows of the L2 rebuild use 29000-29499).

import type { Ability } from "#abilities/ability";
import { allAbilities } from "#data/data-lists";
import {
  type AbilityStudioBlueprintV1,
  validateAbilityStudioBlueprints,
} from "#data/elite-redux/ability-studio/ability-blueprint";
import { compileAbilityStudioBlueprint } from "#data/elite-redux/ability-studio/compile-ability-blueprint";
import type { CompositionRuleV2 } from "#data/elite-redux/ability-studio/vocabulary/index";

export const BLUEPRINT_ID_BASE = 29500;

const registered = new Map<number, Ability | undefined>();
let next = BLUEPRINT_ID_BASE;

export function blueprintOf(id: number, name: string, rules: readonly CompositionRuleV2[]): AbilityStudioBlueprintV1 {
  return {
    version: 2,
    id,
    name,
    description: "Harness test ability.",
    generation: 9,
    includes: [],
    modifiers: [],
    rules: [],
    composition: [...rules],
  };
}

/** Plain-language problems the staff-facing validation reports for these rules (empty when valid). */
export function compositionProblems(name: string, rules: readonly CompositionRuleV2[]): string[] {
  const validated = validateAbilityStudioBlueprints({ probe: blueprintOf(BLUEPRINT_ID_BASE, name, rules) });
  return validated.errors;
}

/**
 * Validates, compiles and registers a composition ability under a fresh id. Throws a plain-language
 * Error (the validation messages) when the rules do not validate or compile.
 */
export function registerCompositionAbility(name: string, rules: readonly CompositionRuleV2[]): number {
  const id = next++;
  if (next >= 30000) {
    next = BLUEPRINT_ID_BASE;
  }
  const validated = validateAbilityStudioBlueprints({ [`h-${id}`]: blueprintOf(id, name, rules) });
  if (validated.errors.length > 0) {
    throw new Error(validated.errors.join("; "));
  }
  const list = allAbilities as Ability[];
  if (!registered.has(id)) {
    registered.set(id, list[id]);
  }
  list[id] = compileAbilityStudioBlueprint(validated.blueprints[`h-${id}`], i => allAbilities[i]);
  return id;
}

export function unregisterCompositionAbilities(): void {
  const list = allAbilities as Ability[];
  for (const [id, previous] of registered) {
    if (previous === undefined) {
      delete list[id];
    } else {
      list[id] = previous;
    }
  }
  registered.clear();
  next = BLUEPRINT_ID_BASE;
}

/** A one-rule helper: WHEN, IF list, DO list with the 100% default chance. */
export function rule(
  key: string,
  when: string,
  ifs: CompositionRuleV2["if"],
  effects: CompositionRuleV2["do"],
  chance = 100,
): CompositionRuleV2 {
  return { key, when: { block: when }, ...(ifs === undefined ? {} : { if: ifs }), do: effects, chance };
}
