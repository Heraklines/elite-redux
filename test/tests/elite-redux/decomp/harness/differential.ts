/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// L1 (spec section 4): structural identity and the predicate differential.
//
//  * Identity: for every (abilityId, attrIndex) with a declaration, decompose -> recompose -> compare
//    a fingerprint (runtime configuration, method owners, serialised condition specs, ability-level
//    conditions).
//  * Predicate differential: for every binding, the ORIGINAL constructor closure and the compiled
//    library form are evaluated over the deterministic state grid with real Pokemon. Results AND
//    random-number draws must be equal.
//  * Attr differential: for every declared attr whose WHEN has an engine-parameter builder, the
//    original attr and the rebuilt attr must agree on `canApply`, `getCondition()` and (for calc
//    moments) on the value `apply` leaves in every NumberHolder.

import type { AbAttr } from "#abilities/ab-attrs";
import type { Ability } from "#abilities/ability";
import { getBinding } from "#data/elite-redux/ability-studio/bindings";
import {
  adaptCondition,
  type CondInput,
  readDeclParams,
  recomposeAttr,
} from "#data/elite-redux/ability-studio/build-attr";
import type { DeclRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { DeclModule } from "#data/elite-redux/ability-studio/define-decl";
import type { ConditionNode } from "#data/elite-redux/ability-studio/vocabulary/composition-types";
import { compileCondition } from "#data/elite-redux/ability-studio/vocabulary/evaluate/conditions";
import type { ParamValues } from "#data/elite-redux/ability-studio/vocabulary/params";
import type { GameManager } from "#test/framework/game-manager";
import { abilityFingerprint, attrFingerprint } from "#test/tests/elite-redux/decomp/fingerprint";
import { NumberHolder } from "#utils/common";
import { type MockInstance, vi } from "vitest";
import { seededGenerator } from "./battle-trace";
import type { AttrSite } from "./sites";
import { applyGridState, type GridState, gridMoves, PARAM_BUILDERS, type ParamContext, type World } from "./world";

// ---------------------------------------------------------------------------------------------
// Identity

export interface IdentityResult {
  readonly site: AttrSite;
  readonly outcome: "identical" | "not-rebuilt" | "different";
  readonly why: readonly string[];
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

/** Everything about an attr that a recompose must preserve. */
export function identityOf(module: DeclModule, attr: AbAttr, abilityId: number, attrIndex: number): unknown {
  return {
    fingerprint: attrFingerprint(attr),
    params: readDeclParams(module, attr),
    specs: module.decl.conditions.map(slot => {
      const binding = getBinding(abilityId, attrIndex, slot.slot);
      return { slot: slot.slot, spec: binding?.spec ?? null, legacy: binding?.legacyClosure !== undefined };
    }),
  };
}

export function checkIdentity(
  site: AttrSite,
  module: DeclModule,
  overrides: { readonly params?: ParamValues; readonly conds?: Readonly<Record<string, CondInput>> } = {},
): IdentityResult {
  let rebuilt: AbAttr;
  try {
    rebuilt = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex, overrides);
  } catch (error) {
    return { site, outcome: "not-rebuilt", why: [(error as Error).message] };
  }
  const before = identityOf(module, site.attr, site.abilityId, site.attrIndex) as Record<string, unknown>;
  const after = identityOf(module, rebuilt, site.abilityId, site.attrIndex) as Record<string, unknown>;
  const why: string[] = [];
  for (const key of Object.keys(before)) {
    if (stableJson(before[key]) !== stableJson(after[key])) {
      why.push(`${key} differs: original ${stableJson(before[key])} vs rebuilt ${stableJson(after[key])}`);
    }
  }
  return { site, outcome: why.length === 0 ? "identical" : "different", why };
}

/** Ability-level identity: flags, ability-level conditions and the attr list of A against its rebuild A'. */
export function abilityIdentityProblems(original: Ability, rebuilt: Ability): string[] {
  const strip = (ability: Ability): unknown => {
    const { id: _id, name: _name, ...rest } = abilityFingerprint(ability);
    return rest;
  };
  const a = strip(original) as Record<string, unknown>;
  const b = strip(rebuilt) as Record<string, unknown>;
  return Object.keys(a)
    .filter(key => stableJson(a[key]) !== stableJson(b[key]))
    .map(key => `${original.name}: ${key} differs between the ability and its rebuild`);
}

// ---------------------------------------------------------------------------------------------
// RNG probe

/** Counts and pins randBattleSeedInt for one side of a comparison. */
export class RngProbe {
  count = 0;
  private next = seededGenerator("l1");
  private readonly spy: MockInstance;

  constructor(game: GameManager) {
    this.spy = vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation((range: number, min = 0) => {
      this.count++;
      return range <= 1 ? min : min + Math.floor(this.next() * range);
    });
  }

  reset(): void {
    this.count = 0;
    this.next = seededGenerator("l1");
  }

  restore(): void {
    this.spy.mockRestore();
  }
}

// ---------------------------------------------------------------------------------------------
// Predicate differential

type Closure = (...args: never[]) => boolean;

export interface BindingCase {
  readonly site: AttrSite;
  readonly module: DeclModule;
  readonly slot: string;
  readonly ctx: "attack" | "defend" | "holder";
  readonly spec: ConditionNode;
  readonly original: Closure;
  readonly library: Closure;
}

export interface CaseProblem {
  readonly site: AttrSite;
  readonly message: string;
}

export function bindingCases(
  sites: readonly AttrSite[],
  registry: DeclRegistry,
): { cases: BindingCase[]; problems: CaseProblem[] } {
  const cases: BindingCase[] = [];
  const problems: CaseProblem[] = [];
  for (const site of sites) {
    const module = registry.get(site.className);
    if (module === undefined) {
      continue;
    }
    for (const slot of module.decl.conditions) {
      if (!slot.slot.startsWith("ctor:")) {
        continue;
      }
      const binding = getBinding(site.abilityId, site.attrIndex, slot.slot);
      if (binding?.spec === undefined) {
        continue;
      }
      const original = (site.attr as unknown as Record<string, unknown>)[slot.path ?? "condition"];
      if (typeof original !== "function") {
        problems.push({
          site,
          message: `${site.abilityName} attr ${site.attrIndex}: cannot find the original closure for ${slot.slot} on the instance (declare condition "path")`,
        });
        continue;
      }
      if (slot.ctx === "none") {
        continue;
      }
      cases.push({
        site,
        module,
        slot: slot.slot,
        ctx: slot.ctx,
        spec: binding.spec,
        original: original as Closure,
        library: adaptCondition(slot.ctx, compileCondition(binding.spec)),
      });
    }
  }
  return { cases, problems };
}

export interface Mismatch {
  readonly site: AttrSite;
  readonly slot: string;
  readonly state: string;
  readonly move: string;
  readonly original: boolean;
  readonly library: boolean;
  readonly originalDraws: number;
  readonly libraryDraws: number;
  readonly message: string;
}

function callClosure(fn: Closure, ctx: BindingCase["ctx"], world: World, move: unknown): boolean {
  const f = fn as unknown as (...a: unknown[]) => boolean;
  return ctx === "holder" ? f(world.holder) : f(world.holder, world.foe, move);
}

/** Evaluates every case in the CURRENT world state with every grid move. */
export function evaluateCasesInState(
  world: World,
  cases: readonly BindingCase[],
  stateName: string,
  rng: RngProbe,
  limit: { remaining: number },
): Mismatch[] {
  const mismatches: Mismatch[] = [];
  const moves = gridMoves();
  for (const testCase of cases) {
    for (const move of testCase.ctx === "holder" ? [moves[0]] : moves) {
      rng.reset();
      const original = callClosure(testCase.original, testCase.ctx, world, move);
      const originalDraws = rng.count;
      rng.reset();
      const library = callClosure(testCase.library, testCase.ctx, world, move);
      const libraryDraws = rng.count;
      if ((original !== library || originalDraws !== libraryDraws) && limit.remaining-- > 0) {
        mismatches.push({
          site: testCase.site,
          slot: testCase.slot,
          state: stateName,
          move: move.name,
          original,
          library,
          originalDraws,
          libraryDraws,
          message:
            `${testCase.site.abilityName} (attr ${testCase.site.attrIndex}, ${testCase.slot}) in "${stateName}" with ${move.name}: `
            + `the original answers ${original} after ${originalDraws} random draws, the library form ${library} after ${libraryDraws}`,
        });
      }
    }
  }
  return mismatches;
}

export function runPredicateDifferential(
  world: World,
  cases: readonly BindingCase[],
  states: readonly GridState[],
  maxMismatches = 25,
): { mismatches: Mismatch[]; evaluations: number } {
  const rng = new RngProbe(world.game);
  const limit = { remaining: maxMismatches };
  const all: Mismatch[] = [];
  try {
    for (const state of states) {
      applyGridState(world, state);
      all.push(...evaluateCasesInState(world, cases, state.name, rng, limit));
    }
  } finally {
    rng.restore();
  }
  const perCase = cases.reduce((sum, c) => sum + (c.ctx === "holder" ? 1 : gridMoves().length), 0);
  return { mismatches: all, evaluations: perCase * states.length };
}

// ---------------------------------------------------------------------------------------------
// Attr differential

export interface AttrMismatch {
  readonly site: AttrSite;
  readonly message: string;
}

function numberHolderValues(params: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value instanceof NumberHolder) {
      out[key] = value.value;
    }
  }
  return out;
}

export interface AttrCaseResult {
  readonly mismatches: AttrMismatch[];
  /** Sites skipped because no engine-parameter builder exists for their WHEN. */
  readonly noBuilder: AttrSite[];
  readonly evaluations: number;
}

export function runAttrDifferential(
  world: World,
  sites: readonly AttrSite[],
  registry: DeclRegistry,
  states: readonly GridState[],
  maxMismatches = 25,
  /** How the rebuild is made; the default is the real recompose. Self-tests inject an altered one. */
  rebuildOf: (site: AttrSite, module: DeclModule) => AbAttr = (site, module) =>
    recomposeAttr(module, site.attr, site.abilityId, site.attrIndex),
): AttrCaseResult {
  const rng = new RngProbe(world.game);
  const mismatches: AttrMismatch[] = [];
  const noBuilder: AttrSite[] = [];
  const pairs: {
    site: AttrSite;
    module: DeclModule;
    rebuilt: AbAttr;
    build: (ctx: ParamContext) => Record<string, unknown>;
    calc: boolean;
  }[] = [];
  for (const site of sites) {
    const module = registry.get(site.className);
    if (module === undefined) {
      continue;
    }
    let rebuilt: AbAttr;
    try {
      rebuilt = rebuildOf(site, module);
    } catch {
      continue;
    }
    const build = PARAM_BUILDERS[module.decl.when];
    if (build === undefined) {
      noBuilder.push(site);
      continue;
    }
    pairs.push({ site, module, rebuilt, build, calc: module.decl.when.startsWith("calc.") });
  }
  let evaluations = 0;
  try {
    for (const state of states) {
      applyGridState(world, state);
      for (const move of gridMoves()) {
        for (const damage of [1, Math.max(1, Math.floor(world.holder.getMaxHp() / 10))]) {
          for (const pair of pairs) {
            const ctx: ParamContext = { holder: world.holder, foe: world.foe, move, damage };
            evaluations++;
            const say = (what: string, a: unknown, b: unknown): void => {
              if (mismatches.length < maxMismatches) {
                mismatches.push({
                  site: pair.site,
                  message:
                    `${pair.site.abilityName} (attr ${pair.site.attrIndex}) in "${state.name}" with ${move.name} and ${damage} damage: `
                    + `${what} is ${String(a)} for the original but ${String(b)} for the rebuild`,
                });
              }
            };
            const origParams = pair.build(ctx);
            const newParams = pair.build(ctx);
            rng.reset();
            const origCan = pair.site.attr.canApply(origParams as never);
            const origDraws = rng.count;
            rng.reset();
            const newCan = pair.rebuilt.canApply(newParams as never);
            const newDraws = rng.count;
            if (origCan !== newCan) {
              say("canApply", origCan, newCan);
            }
            if (origDraws !== newDraws) {
              say("the number of random draws in canApply", origDraws, newDraws);
            }
            const origCond = pair.site.attr.getCondition();
            const newCond = pair.rebuilt.getCondition();
            const origCondValue = origCond === null ? null : origCond(world.holder);
            const newCondValue = newCond === null ? null : newCond(world.holder);
            if (origCondValue !== newCondValue) {
              say("getCondition", origCondValue, newCondValue);
            }
            if (pair.calc && origCan && newCan) {
              pair.site.attr.apply(origParams as never);
              pair.rebuilt.apply(newParams as never);
              const a = numberHolderValues(origParams);
              const b = numberHolderValues(newParams);
              if (stableJson(a) !== stableJson(b)) {
                say("the value apply leaves behind", stableJson(a), stableJson(b));
              }
            }
          }
        }
      }
    }
  } finally {
    rng.restore();
  }
  return { mismatches, noBuilder, evaluations };
}
