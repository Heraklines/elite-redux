/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Ability } from "#abilities/ability";
import { allAbilities } from "#data/data-lists";
import {
  type AbilityStudioBlueprintV1,
  validateAbilityStudioBlueprints,
} from "#data/elite-redux/ability-studio/ability-blueprint";
import { compileAbilityStudioBlueprint } from "#data/elite-redux/ability-studio/compile-ability-blueprint";
import customAbilitiesJson from "./er-custom-abilities.json";

export interface InitEditorAuthoredAbilitiesResult {
  readonly registered: number;
  readonly errors: string[];
}

export function initEditorAuthoredAbilities(raw: unknown = customAbilitiesJson): InitEditorAuthoredAbilitiesResult {
  const validated = validateAbilityStudioBlueprints(raw);
  const errors = [...validated.errors];
  const byId = new Map<number, AbilityStudioBlueprintV1>();
  for (const blueprint of Object.values(validated.blueprints)) {
    byId.set(blueprint.id, blueprint);
  }
  const completed = new Map<number, Ability>();
  const visiting = new Set<number>();

  const compile = (id: number): Ability | undefined => {
    const ready = completed.get(id);
    if (ready !== undefined) {
      return ready;
    }
    const blueprint = byId.get(id);
    if (blueprint === undefined) {
      return allAbilities[id];
    }
    if (visiting.has(id)) {
      throw new Error(`ability reference cycle at ability ${id}`);
    }
    visiting.add(id);
    try {
      const ability = compileAbilityStudioBlueprint(blueprint, includedId => compile(includedId));
      completed.set(id, ability);
      return ability;
    } finally {
      visiting.delete(id);
    }
  };

  for (const blueprint of byId.values()) {
    try {
      const ability = compile(blueprint.id);
      if (ability !== undefined) {
        (allAbilities as Ability[])[blueprint.id] = ability;
      }
    } catch (error) {
      errors.push(`${blueprint.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { registered: completed.size, errors };
}
