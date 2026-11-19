/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// The fresh-instance factory (spec 2.2): `buildAttr(declModule, params, conds)` calls the REAL
// constructor with each value at its `ctorIndex`. Nothing is shallow-cloned, so the shared WeakSets,
// arrays and `oncePerBattleKey` hazards of `cloneAttr` cannot leak between abilities.

import type { AbAttr } from "#abilities/ab-attrs";
import type { AbAttrCondition } from "#types/ability-types";
import { getBinding } from "./bindings";
import {
  type DeclCondition,
  type DeclGateParam,
  type DeclModule,
  type DeclParam,
  isAbsentOptional,
} from "./define-decl";
import { type GatedAttr, setGateOverride } from "./gate-residual";
import type { ConditionNode } from "./vocabulary/composition-types";
import {
  asAttackCondition,
  asDefendCondition,
  asHolderCondition,
  asParamsGate,
  compileCondition,
} from "./vocabulary/evaluate/conditions";
import type { Condition } from "./vocabulary/evaluate/frame";
import { type ParamDef, type ParamValues, validateParamValues } from "./vocabulary/params";

type Closure = (...args: never[]) => boolean;

/** A condition slot value: a library IF tree (compiled once here) or a ready engine closure. */
export type CondInput = ConditionNode | Closure;

function isTree(input: CondInput): input is ConditionNode {
  return typeof input === "object" && input !== null;
}

/** Turns a compiled frame condition into the closure shape the slot's engine signature expects. */
export function adaptCondition(ctx: DeclCondition["ctx"], condition: Condition): Closure {
  switch (ctx) {
    case "attack":
      return asAttackCondition(condition) as Closure;
    case "defend":
      return asDefendCondition(condition) as Closure;
    case "holder":
      return asHolderCondition(condition) as Closure;
    default:
      throw new Error('a condition slot with context "none" cannot take a library condition');
  }
}

function paramDefs(params: readonly DeclParam[]): ParamDef[] {
  return params.map(param => ({
    id: param.id,
    label: param.label,
    control: param.control,
    default: param.default,
    ...(param.min === undefined ? {} : { min: param.min }),
    ...(param.max === undefined ? {} : { max: param.max }),
    ...(param.step === undefined ? {} : { step: param.step }),
    ...(param.options === undefined ? {} : { options: param.options }),
    ...(param.integer === undefined ? {} : { integer: param.integer }),
  }));
}

/**
 * Builds a fresh instance of the declared class.
 *
 * @param conds - slot (`ctor:N` / `gate`) to IF tree or closure. A slot the class declares but the
 *   caller leaves out is an error, because the constructor cannot guess the original closure.
 */
export function buildAttr(
  module: DeclModule,
  params: ParamValues = {},
  conds: Readonly<Record<string, CondInput>> = {},
): AbAttr {
  const { decl, ctor, className } = module;
  const errors = validateParamValues(className, paramDefs(decl.params), params);
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
  const args: unknown[] = [];
  for (const [index, value] of Object.entries(decl.fixedCtorArgs ?? {})) {
    args[Number(index)] = value;
  }
  let spread: { index: number; list: unknown[] } | undefined;
  for (const param of decl.params) {
    const value = params[param.id] ?? param.default;
    const ctorValue = param.codec === undefined ? value : param.codec.toCtor(value);
    if (param.ctorOption !== undefined) {
      const bag = (args[param.ctorIndex] ??= {}) as Record<string, unknown>;
      // An option that is not set stays OUT of the bag, like in the live users (a class that keeps its options object,
      // such as the always-hit class, would otherwise show an extra key with the value undefined).
      if (ctorValue !== undefined) {
        bag[param.ctorOption] = ctorValue;
      }
    } else if (param.spread === true) {
      spread = { index: param.ctorIndex, list: ctorValue as unknown[] };
    } else {
      args[param.ctorIndex] = ctorValue;
    }
  }
  let gate: Closure | undefined;
  let gateCommit: ((params: never) => void) | undefined;
  for (const slot of decl.conditions) {
    const given = conds[slot.slot];
    if (given === undefined) {
      if (slot.optional === true) {
        continue;
      }
      throw new Error(`${className} needs a condition for ${slot.slot}`);
    }
    if (slot.slot === "gate" && slot.ctx === "params" && isTree(given)) {
      const paramsGate = asParamsGate(decl.when, compileCondition(given));
      gate = paramsGate.gate as Closure;
      gateCommit = paramsGate.commit as (params: never) => void;
      continue;
    }
    const closure = isTree(given) ? adaptCondition(slot.ctx, compileCondition(given)) : given;
    if (slot.slot === "gate") {
      gate = closure;
      continue;
    }
    const match = /^ctor:(\d+)$/.exec(slot.slot);
    if (match === null) {
      throw new Error(`${className} declares an unsupported condition slot ${slot.slot}`);
    }
    args[Number(match[1])] = closure;
  }
  if (spread !== undefined) {
    args.length = spread.index;
    args.push(...spread.list);
  }
  const attr = new (ctor as unknown as new (...a: unknown[]) => AbAttr)(...args);
  if (gate !== undefined) {
    setGateOverride(attr as unknown as GatedAttr<never>, gate as never);
  }
  if (gateCommit !== undefined) {
    // Memory atoms in a library gate (once-per, nth-use) wait for the effect, like in a composition carrier:
    // the write happens when `apply` runs, not when `canApply` merely passes.
    const commit = gateCommit;
    const carrierApply = (attr as unknown as { apply: (p: never) => void }).apply.bind(attr);
    (attr as unknown as { apply: (p: never) => void }).apply = (p: never) => {
      commit(p);
      carrierApply(p);
    };
  }
  return attr;
}

/** Reads the current value of each declared param from a live instance (via `path`). */
export function readDeclParams(module: DeclModule, attr: AbAttr): ParamValues {
  const values: Record<string, string | number | boolean> = {};
  for (const param of module.decl.params) {
    if (param.path === undefined) {
      continue;
    }
    const raw = (attr as unknown as Record<string, unknown>)[param.path];
    const value = param.codec === undefined ? raw : param.codec.fromInstance(raw);
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      values[param.id] = value;
    }
  }
  return values;
}

/** Copies `spec` with the live param values written into the atoms named by the declaration's `gateParams`. */
function applyGateParams(spec: unknown, gateParams: readonly DeclGateParam[], params: ParamValues): unknown {
  if (typeof spec !== "object" || spec === null) {
    return spec;
  }
  const node = spec as Record<string, unknown>;
  for (const key of ["all", "any"] as const) {
    if (Array.isArray(node[key])) {
      return { [key]: (node[key] as unknown[]).map(child => applyGateParams(child, gateParams, params)) };
    }
  }
  if ("not" in node) {
    return { not: applyGateParams(node.not, gateParams, params) };
  }
  const patched = { ...((node.params as Record<string, unknown> | undefined) ?? {}) };
  for (const entry of gateParams) {
    const value = params[entry.param];
    if (node.block !== entry.block) {
      continue;
    }
    if (typeof value === "number") {
      // toPrecision drops float noise from the scale (0.35 * 100 is 35.00000000000001 otherwise).
      patched[entry.field] = Number((value * (entry.scale ?? 1)).toPrecision(12));
    } else if (typeof value === "string") {
      patched[entry.field] = value;
    }
  }
  return { ...node, params: patched };
}

/**
 * decompose -> recompose: rebuilds a registered attr from its declaration, its live params and its
 * bindings. A condition slot without a library binding (and without an override) makes this throw,
 * which is how the coverage gate counts the attr as undecomposed.
 */
export function recomposeAttr(
  module: DeclModule,
  attr: AbAttr,
  abilityId: number,
  attrIndex: number,
  overrides: { readonly params?: ParamValues; readonly conds?: Readonly<Record<string, CondInput>> } = {},
): AbAttr {
  const conds: Record<string, CondInput> = {};
  const liveParams = { ...readDeclParams(module, attr), ...overrides.params };
  for (const slot of module.decl.conditions) {
    if (isAbsentOptional(attr, slot)) {
      continue;
    }
    const binding = getBinding(abilityId, attrIndex, slot.slot);
    if (binding?.spec === undefined) {
      if (overrides.conds?.[slot.slot] === undefined) {
        throw new Error(
          `${module.className} (ability ${abilityId} attr ${attrIndex}) has no library binding for ${slot.slot}`,
        );
      }
      continue;
    }
    conds[slot.slot] =
      slot.slot === "gate" && module.decl.gateParams !== undefined
        ? (applyGateParams(binding.spec, module.decl.gateParams, liveParams) as ConditionNode)
        : binding.spec;
  }
  const rebuilt = buildAttr(module, liveParams, { ...conds, ...overrides.conds });
  // The attr-level condition (AbAttr.addCondition: ability composition, upgrades) is not a constructor argument
  // and not part of the class's own rule, so it is carried over as it is.
  const attrLevel = (attr as unknown as { extraCondition?: AbAttrCondition }).extraCondition;
  if (attrLevel !== undefined) {
    rebuilt.addCondition(attrLevel);
  }
  return rebuilt;
}
