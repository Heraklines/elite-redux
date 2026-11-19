/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Test-only declarations and bindings for the harness self-tests. They are NOT precedents and live
// under test/, so the registry glob never picks them up. They describe Multiscale, the worked
// example of spec 3.2, exactly as the spec's Tier A recipe says.

import { ReceivedMoveDamageMultiplierAbAttr } from "#abilities/ab-attrs";
import {
  allBindings,
  bindCondition,
  bindLegacyClosure,
  type ConditionBinding,
  clearBindingsForTests,
} from "#data/elite-redux/ability-studio/bindings";
import { createDeclRegistry, type DeclRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { type ClassDecl, defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { AbilityId } from "#enums/ability-id";
import { multiscaleLikeDecl } from "#test/tests/elite-redux/decomp/decl-machinery";

export const MULTISCALE_ID = AbilityId.MULTISCALE;

export const multiscaleHarnessDecl: ClassDecl = {
  ...multiscaleLikeDecl,
  conditions: [{ slot: "ctor:0", ctx: "defend", lib: "hp.full", path: "condition", removable: true, editable: true }],
  probes: [{ name: "full hp boundary", axes: { hp: ["max", "max-1", 1] } }],
  notes: "Harness self-test declaration (Multiscale worked example, spec 3.2).",
};

export const multiscaleModule = defineDecl(ReceivedMoveDamageMultiplierAbAttr, multiscaleHarnessDecl);

export function multiscaleRegistry(patch: Partial<ClassDecl> = {}): DeclRegistry {
  return createDeclRegistry([defineDecl(ReceivedMoveDamageMultiplierAbAttr, { ...multiscaleHarnessDecl, ...patch })]);
}

let saved: ConditionBinding[] | undefined;

/**
 * Binds Multiscale's closure to the library form `hp.full{holder}` (the worked example's binding).
 * The bindings registry is process-wide (and vitest shares workers between files), so whatever the
 * real `decl/**` bindings registered is saved first and put back by `restoreBindings`.
 */
export function bindMultiscale(spec: unknown = { id: "hp.full", who: "holder" }): void {
  saved ??= allBindings();
  clearBindingsForTests();
  bindCondition(MULTISCALE_ID, 0, spec);
}

/**
 * Empties the process-wide bindings for a test that registers its own, remembering the real ones for
 * `restoreBindings`. Vitest shares workers between files, so a test that cleared them for good would break the
 * live-registry suites that run after it.
 */
export function stashBindings(): void {
  saved ??= allBindings();
  clearBindingsForTests();
}

export function restoreBindings(): void {
  if (saved === undefined) {
    return;
  }
  clearBindingsForTests();
  for (const binding of saved) {
    if (binding.spec !== undefined) {
      bindCondition(binding.abilityId, binding.attrIndex, binding.spec, binding.slot);
    } else if (binding.legacyClosure !== undefined) {
      bindLegacyClosure(binding.abilityId, binding.attrIndex, binding.legacyClosure.reason, binding.slot);
    }
  }
  saved = undefined;
}
