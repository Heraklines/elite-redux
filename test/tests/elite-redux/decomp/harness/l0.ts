/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// L0 static lint (spec section 4): seconds, every commit. Pure functions returning plain-language
// problems, so the same checks serve the vitest file, the batch runner and the self-tests.
//
// The per-declaration checks (WHEN resolves to a dispatch key that is an ancestor of the class,
// ctorIndex inside the constructor arity, requires subset of provides, labels free of class names,
// synonyms >= 3, examples >= 1) live in `lintDecl` (decl-lint.ts); this file adds what needs the live
// game: bindings against real sites, probe axes against the L2 harness, and the WHEN template map.

import { allBindings } from "#data/elite-redux/ability-studio/bindings";
import { lintDecl } from "#data/elite-redux/ability-studio/decl-lint";
import type { DeclRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { WHEN_REGISTRY } from "#data/elite-redux/ability-studio/vocabulary/when-registry";
import { mappedWhenIds, STATIC_WHEN_REASONS, TEMPLATES, templateForWhen } from "./scenarios";
import type { AttrSite } from "./sites";
import { probeProblems } from "./twin";

/** lintDecl plus the harness-specific rules for every declaration. */
export function declarationProblems(registry: DeclRegistry): string[] {
  const problems: string[] = [];
  for (const module of registry.all()) {
    problems.push(...lintDecl(module));
    problems.push(...probeProblems(module));
    const { decl, className } = module;
    for (const param of decl.params) {
      if (param.path === undefined && decl.fixedCtorArgs?.[param.ctorIndex] === undefined) {
        problems.push(
          `${className}: param "${param.id}" has no "path", so the harness cannot read its current value back from a live instance`,
        );
      }
    }
    const isBuilt = decl.kind !== "package" && decl.status !== "exempt" && decl.status !== "todo";
    if (isBuilt && (decl.probes ?? []).length === 0 && decl.kind !== "engine-query") {
      problems.push(`${className}: a ${decl.status} class needs at least one probe (state axes for L1 and L2)`);
    }
    if (decl.status === "verified" && decl.notes.trim().length === 0) {
      problems.push(`${className}: a verified class needs notes (at least who reviewed it and what was checked)`);
    }
  }
  return problems;
}

/** Bindings against the live game and against the declarations. */
export function bindingProblems(sites: readonly AttrSite[], registry: DeclRegistry): string[] {
  const problems: string[] = [];
  const siteByKey = new Map(sites.map(site => [`${site.abilityId}:${site.attrIndex}`, site]));
  for (const binding of allBindings()) {
    const site = siteByKey.get(`${binding.abilityId}:${binding.attrIndex}`);
    if (site === undefined) {
      problems.push(
        `binding for ability ${binding.abilityId} attr ${binding.attrIndex} points at an attr that does not exist`,
      );
      continue;
    }
    const module = registry.get(site.className);
    if (module === undefined) {
      problems.push(`${site.abilityName} attr ${binding.attrIndex}: bound, but ${site.className} has no declaration`);
      continue;
    }
    if (!module.decl.conditions.some(slot => slot.slot === binding.slot)) {
      problems.push(
        `${site.abilityName} attr ${binding.attrIndex}: bound to ${binding.slot}, which ${site.className} does not declare`,
      );
    }
  }
  const bound = new Set(allBindings().map(binding => `${binding.abilityId}:${binding.attrIndex}:${binding.slot}`));
  for (const site of sites) {
    const module = registry.get(site.className);
    if (module === undefined || module.decl.status === "todo" || module.decl.kind === "package") {
      continue;
    }
    for (const slot of module.decl.conditions) {
      if (slot.slot.startsWith("ctor:") && !bound.has(`${site.abilityId}:${site.attrIndex}:${slot.slot}`)) {
        problems.push(
          `${site.abilityName} attr ${site.attrIndex} (${site.className}): ${slot.slot} has neither a library binding nor a legacy-closure note`,
        );
      }
    }
  }
  return problems;
}

export interface Completeness {
  readonly missing: string[];
  readonly unknown: string[];
}

/** Which live classes have no declaration, and which declarations name no live class. */
export function completenessOf(registry: DeclRegistry, classNames: readonly string[]): Completeness {
  const live = new Set(classNames);
  return {
    missing: classNames.filter(name => !registry.has(name)),
    unknown: registry
      .all()
      .map(module => module.className)
      .filter(name => !live.has(name)),
  };
}

/** Every WHEN must have a scenario template that reaches it, or an explicit reason it is static. */
export function whenTemplateProblems(): string[] {
  const problems: string[] = [];
  for (const when of WHEN_REGISTRY) {
    if (templateForWhen(when.id) === undefined && STATIC_WHEN_REASONS[when.id] === undefined) {
      problems.push(`the trigger "${when.id}" has no L2 scenario template and no written reason it is static`);
    }
  }
  const known = new Set(WHEN_REGISTRY.map(when => when.id));
  for (const id of mappedWhenIds()) {
    if (!known.has(id)) {
      problems.push(`the scenario map names "${id}", which is not in WHEN_REGISTRY`);
    }
  }
  for (const [id, template] of Object.entries(TEMPLATES)) {
    if (template.id !== id) {
      problems.push(`scenario template "${id}" calls itself "${template.id}"`);
    }
  }
  return problems;
}
