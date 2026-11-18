/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { AbAttr } from "#abilities/ab-attrs";
import type { Ability } from "#abilities/ability";
import {
  abilityStudioRuntimeConfiguration,
  abilityStudioRuntimeHookId,
  abilityStudioRuntimeMethodOwner,
} from "#data/elite-redux/ability-studio/runtime-components";

/** Deterministic, JSON-safe snapshot of an arbitrary attr field value. */
export function stableValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return Number.isFinite(value) ? value : String(value);
    case "bigint":
      return `${value}n`;
    case "function":
      return "[fn]";
    case "symbol":
      return "[symbol]";
    default:
  }
  if (depth >= 4) {
    return "[deep]";
  }
  if (Array.isArray(value)) {
    return value.map(item => stableValue(item, depth + 1));
  }
  if (value instanceof Set) {
    return { "[Set]": [...value].map(item => stableValue(item, depth + 1)) };
  }
  if (value instanceof Map) {
    return { "[Map]": [...value].map(([k, v]) => [stableValue(k, depth + 1), stableValue(v, depth + 1)]) };
  }
  if (value instanceof WeakSet || value instanceof WeakMap) {
    return "[Weak]";
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, stableValue(item, depth + 1)] as const);
  return { "[class]": (value as object).constructor?.name ?? "Object", ...Object.fromEntries(entries) };
}

export interface AttrFingerprint {
  readonly type: string;
  readonly hook: string;
  readonly configuration: unknown;
  readonly showAbility: boolean;
  readonly owners: { readonly apply: string; readonly canApply: string; readonly getCondition: string };
  readonly hasCondition: boolean;
}

export interface AbilityFingerprint {
  readonly id: number;
  readonly name: string;
  readonly conditionCount: number;
  readonly flags: Record<string, boolean>;
  readonly attrs: readonly AttrFingerprint[];
}

export function attrFingerprint(attr: AbAttr): AttrFingerprint {
  return {
    type: attr.constructor.name,
    hook: abilityStudioRuntimeHookId(attr),
    configuration: stableValue(abilityStudioRuntimeConfiguration(attr)),
    showAbility: attr.showAbility,
    owners: {
      apply: abilityStudioRuntimeMethodOwner(attr, "apply"),
      canApply: abilityStudioRuntimeMethodOwner(attr, "canApply"),
      getCondition: abilityStudioRuntimeMethodOwner(attr, "getCondition"),
    },
    hasCondition: attr.getCondition() !== null,
  };
}

export function abilityFingerprint(ability: Ability): AbilityFingerprint {
  return {
    id: ability.id,
    name: ability.name,
    conditionCount: ability.conditions.length,
    flags: {
      bypassFaint: ability.bypassFaint,
      ignorable: ability.ignorable,
      suppressable: ability.suppressable,
      copiable: ability.copiable,
      replaceable: ability.replaceable,
      swappable: ability.swappable,
    },
    attrs: ability.attrs.map(attrFingerprint),
  };
}
