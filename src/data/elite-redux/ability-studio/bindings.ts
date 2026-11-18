/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Instance bindings (spec 2.1): the library form of constructor closures that cannot be reflected
// on, keyed by (abilityId, attrIndex[, slot]). They live in `decl/<batch>/bindings.ts`:
//
//   bindCondition(AbilityId.MULTISCALE, 0, { block: "hp.full", params: { who: "holder" } });
//
// A binding is only a SPEC. The L1 differential test evaluates the original closure and the
// compiled spec over a state grid, which is what proves the two equal.

import type { ConditionNode } from "./vocabulary/composition-types";
import { validateConditionSpec } from "./vocabulary/validate-composition";

export type BindingSpec = ConditionNode;

export interface ConditionBinding {
  readonly abilityId: number;
  readonly attrIndex: number;
  /** `ctor:N` or `gate`; defaults to the first constructor argument. */
  readonly slot: string;
  /** The library form; absent for a `legacy-closure`. */
  readonly spec?: BindingSpec;
  /** Present when the closure does not map to the library (counted as undecomposed). */
  readonly legacyClosure?: { readonly reason: string };
}

const bindings = new Map<string, ConditionBinding>();

function keyOf(abilityId: number, attrIndex: number, slot: string): string {
  return `${abilityId}:${attrIndex}:${slot}`;
}

/** Accepts the short form `{ id: "hp.full", who: "holder" }` and turns it into `{ block, params }`. */
export function normalizeBindingSpec(spec: unknown): BindingSpec {
  if (typeof spec !== "object" || spec === null) {
    throw new Error("a binding spec must be an object");
  }
  const record = spec as Record<string, unknown>;
  if ("all" in record || "any" in record || "not" in record) {
    if ("all" in record) {
      return { all: (record.all as unknown[]).map(normalizeBindingSpec) };
    }
    if ("any" in record) {
      return { any: (record.any as unknown[]).map(normalizeBindingSpec) };
    }
    return { not: normalizeBindingSpec(record.not) };
  }
  if (typeof record.block === "string") {
    return record as unknown as BindingSpec;
  }
  if (typeof record.id === "string") {
    const { id, ...params } = record;
    return { block: id, params: params as Record<string, string | number | boolean> };
  }
  throw new Error('a binding spec needs a "block" (or "id")');
}

export function bindCondition(abilityId: number, attrIndex: number, spec: unknown, slot = "ctor:0"): ConditionBinding {
  const normalized = normalizeBindingSpec(spec);
  const key = keyOf(abilityId, attrIndex, slot);
  if (bindings.has(key)) {
    throw new Error(`ability ${abilityId} attr ${attrIndex} (${slot}) is already bound`);
  }
  // Slot requirements depend on the WHEN, which a binding does not know. Only ids and params are checked.
  const problems = validateConditionSpec(normalized);
  if (problems.length > 0) {
    throw new Error(`binding for ability ${abilityId} attr ${attrIndex} is invalid: ${problems.join("; ")}`);
  }
  const binding: ConditionBinding = { abilityId, attrIndex, slot, spec: normalized };
  bindings.set(key, binding);
  return binding;
}

/** Marks a closure that does not map to the library. It is reusable as a whole but counted as undecomposed. */
export function bindLegacyClosure(
  abilityId: number,
  attrIndex: number,
  reason: string,
  slot = "ctor:0",
): ConditionBinding {
  if (reason.trim().length < 10) {
    throw new Error("a legacy-closure binding needs a written reason");
  }
  const key = keyOf(abilityId, attrIndex, slot);
  if (bindings.has(key)) {
    throw new Error(`ability ${abilityId} attr ${attrIndex} (${slot}) is already bound`);
  }
  const binding: ConditionBinding = { abilityId, attrIndex, slot, legacyClosure: { reason } };
  bindings.set(key, binding);
  return binding;
}

export function getBinding(abilityId: number, attrIndex: number, slot = "ctor:0"): ConditionBinding | undefined {
  return bindings.get(keyOf(abilityId, attrIndex, slot));
}

export function bindingsFor(abilityId: number, attrIndex: number): ConditionBinding[] {
  return [...bindings.values()].filter(b => b.abilityId === abilityId && b.attrIndex === attrIndex);
}

export function allBindings(): ConditionBinding[] {
  return [...bindings.values()];
}

/** Test helper: forget everything bound so far (a test registers its own bindings). */
export function clearBindingsForTests(): void {
  bindings.clear();
}
