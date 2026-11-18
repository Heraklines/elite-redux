/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// L0 lint for class declarations (spec section 4): pure functions that return plain-language
// problems, so the same checks serve the registry test, the coverage gate and the catalog generator.

import type { DeclRegistry } from "./decl-registry";
import { constructorArity, type DeclModule } from "./define-decl";
import { getCondition } from "./vocabulary/conditions";
import { getEffect } from "./vocabulary/effects";
import { getGuard } from "./vocabulary/guards";
import { withParamDefaults } from "./vocabulary/params";
import { missingSlots, type SlotId } from "./vocabulary/slots";
import { getWhen, type WhenDef } from "./vocabulary/when-registry";

/** Class names from the class itself up through its ancestors. */
export function classChainNames(ctor: unknown): string[] {
  const chain: string[] = [];
  let current: unknown = ctor;
  while (typeof current === "function" && (current as { name: string }).name) {
    chain.push((current as { name: string }).name);
    current = Object.getPrototypeOf(current);
  }
  return chain;
}

export function dispatchKeysOf(when: WhenDef): string[] {
  return [when.dispatchKey, ...(when.alsoDispatchKeys ?? []), ...(when.flagKeys ?? [])].filter(
    (key): key is string => key !== null,
  );
}

const KIND_TO_WHEN_KIND: Readonly<Record<string, WhenDef["kind"]>> = {
  "calc-modifier": "calc",
  "event-effect": "event",
  "while-active": "while-active",
};

export function lintDecl(module: DeclModule): string[] {
  const { decl, className, ctor } = module;
  const problems: string[] = [];
  const say = (message: string): void => {
    problems.push(`${className}: ${message}`);
  };

  const when = getWhen(decl.when);
  if (when === undefined) {
    say(`when "${decl.when}" is not in WHEN_REGISTRY`);
  } else {
    const keys = dispatchKeysOf(when);
    if (!classChainNames(ctor).some(name => keys.includes(name))) {
      say(`when "${decl.when}" dispatches ${keys.join(", ")}, none of which is the class or one of its ancestors`);
    }
    const expected = KIND_TO_WHEN_KIND[decl.kind];
    if (expected !== undefined && when.kind !== expected) {
      say(`kind "${decl.kind}" does not fit a "${when.kind}" trigger`);
    }
  }

  const arity = constructorArity(ctor);
  const usedIndices = new Set<number>();
  const claim = (index: number, what: string): void => {
    if (!Number.isInteger(index) || index < 0 || index >= arity) {
      say(`${what} points at constructor argument ${index}, but the constructor has ${arity}`);
    }
    if (usedIndices.has(index)) {
      say(`${what} reuses constructor argument ${index}`);
    }
    usedIndices.add(index);
  };
  for (const param of decl.params) {
    claim(param.ctorIndex, `param "${param.id}"`);
  }
  for (const condition of decl.conditions) {
    const match = /^ctor:(\d+)$/.exec(condition.slot);
    if (match !== null) {
      claim(Number(match[1]), `condition ${condition.slot}`);
    } else if (condition.slot !== "gate") {
      say(`condition slot "${condition.slot}" must be ctor:N or gate`);
    }
  }
  for (const index of Object.keys(decl.fixedCtorArgs ?? {})) {
    claim(Number(index), `fixed argument ${index}`);
  }

  if (decl.params.length === 0 && (decl.noParamsReason ?? "").trim().length < 10) {
    say("has no params and no written reason (noParamsReason)");
  }
  if (decl.synonyms.length < 3) {
    say("needs at least 3 synonyms");
  }
  if (decl.examples.length === 0) {
    say("needs at least 1 example");
  }

  const defaults = withParamDefaults(
    decl.params.map(param => ({ id: param.id, label: param.label, control: param.control, default: param.default })),
    {},
  );
  const visible = [decl.label, decl.summary(defaults), ...decl.synonyms, ...decl.examples].join("\n");
  const stem = className.replace(/AbAttr$/, "");
  if (visible.includes(className) || (stem.length > 4 && visible.includes(stem))) {
    say("its label, summary, synonyms or examples show the class name");
  }

  const requires = new Set<SlotId>(decl.requires ?? []);
  for (const name of decl.guards) {
    const guard = getGuard(name);
    if (guard === undefined) {
      say(`guard "${name}" is not in the guard registry`);
    } else {
      for (const slot of guard.requires) {
        requires.add(slot);
      }
    }
  }
  for (const effect of [decl.effect, ...(decl.branches ?? []).map(branch => branch.effect)]) {
    if (effect === undefined) {
      continue;
    }
    const def = getEffect(effect.id);
    if (def === undefined) {
      say(`effect "${effect.id}" is not in the effect registry`);
    } else {
      for (const slot of def.requires) {
        requires.add(slot);
      }
    }
    for (const paramId of effect.params) {
      if (!decl.params.some(param => param.id === paramId)) {
        say(`effect "${effect.id}" names param "${paramId}", which the class does not declare`);
      }
    }
  }
  for (const condition of decl.conditions) {
    const atom = condition.lib === undefined ? undefined : getCondition(condition.lib);
    if (atom !== undefined) {
      for (const slot of atom.requires) {
        requires.add(slot);
      }
    }
  }
  if (when !== undefined) {
    const provides = decl.provides ?? when.provides;
    const missing = missingSlots([...requires], provides);
    if (missing.length > 0) {
      say(`needs ${missing.join(", ")}, which "${decl.when}" does not provide`);
    }
  }

  if ((decl.kind === "package" || decl.status === "exempt") && decl.notes.trim().length < 20) {
    say("a package or exempt class needs a written reason in notes");
  }
  if (decl.tier === "B" && !decl.conditions.some(condition => condition.slot === "gate")) {
    say("a Tier B class must declare its gate slot");
  }
  return problems;
}

export interface CoverageReport {
  /** Declared names that are not in the live class map. */
  readonly unknown: string[];
  /** Live classes without a declaration. */
  readonly missing: string[];
  readonly declared: number;
  readonly total: number;
}

export function coverageOf(registry: DeclRegistry, liveClasses: Readonly<Record<string, unknown>>): CoverageReport {
  const names = Object.keys(liveClasses);
  const known = new Set(names);
  return {
    unknown: registry
      .all()
      .map(module => module.className)
      .filter(name => !known.has(name)),
    missing: names.filter(name => !registry.has(name)),
    declared: names.filter(name => registry.has(name)).length,
    total: names.length,
  };
}

/**
 * Every AbAttr class that is in use: the `AbilityAttrs` map plus the class of every attr of every
 * registered ability (this is where archetype, per-ability and studio-generated classes show up).
 * Name collisions keep the first class seen; the L0 test reports them.
 */
export function liveAttrClasses(
  abilities: readonly ({ readonly attrs: readonly object[] } | undefined)[],
  mapped: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const classes: Record<string, unknown> = { ...mapped };
  for (const ability of abilities) {
    for (const attr of ability?.attrs ?? []) {
      const ctor = attr.constructor;
      if (ctor?.name && !(ctor.name in classes)) {
        classes[ctor.name] = ctor;
      }
    }
  }
  return classes;
}
