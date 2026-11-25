/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 1: the Tier B classes whose gate is bound legacy (the library has no atom for it yet, see requests/B10.md) cannot be
// rebuilt by `recomposeAttr` alone, so these tests rebuild them with a stand-in gate: the REBUILT instance's own `gate` method.
// That still proves what the tests are about (fresh instance, params read back and built through the constructor, the gate
// override wired through `gatedCanApply`, the same answers and effects as the original) without pretending a library atom exists.
import type { AbAttr } from "#abilities/ab-attrs";
import { recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import type { DeclModule } from "#data/elite-redux/ability-studio/define-decl";

export function rebuildWithClassGate(module: DeclModule, attr: AbAttr, abilityId: number, attrIndex: number): AbAttr {
  const standIn = (params: unknown): boolean => (rebuilt as unknown as { gate(p: unknown): boolean }).gate(params);
  const rebuilt: AbAttr = recomposeAttr(module, attr, abilityId, attrIndex, { conds: { gate: standIn as never } });
  return rebuilt;
}
