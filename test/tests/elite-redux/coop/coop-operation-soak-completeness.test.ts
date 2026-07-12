/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  COOP_OPERATION_SURFACES,
  COOP_OPERATION_UI_CONTRACTS,
} from "#data/elite-redux/coop/coop-operation-surface-registry";
import { UiMode } from "#enums/ui-mode";
import {
  expectedSurfaces,
  guaranteedSurfaces,
  KNOWN_UNDRIVABLE,
  probabilisticSurfaces,
} from "#test/tools/coop-soak-coverage";
import { describe, expect, it } from "vitest";

// Failure-first proof for the post-migration coverage hole: the soak's anti-silent-drop registry covered
// UI modes, relay kinds, seq bands, and battle situations, but none of the authoritative operation classes.
// Consequently a migrated operation could remain completely cold without making completeness RED.
describe("co-op soak authoritative-operation completeness", () => {
  it("requires every migrated authoritative operation class to be classified by the soak", () => {
    const expectedOperationKeys = COOP_OPERATION_SURFACES.map(cls => `operation:${cls}`).sort();
    const registeredOperationKeys = [...expectedSurfaces()].filter(key => key.startsWith("operation:")).sort();
    expect(registeredOperationKeys).toEqual(expectedOperationKeys);
  });

  it("requires every declared public-UI -> operation edge to be classified independently", () => {
    const expectedUiOperationKeys = Object.entries(COOP_OPERATION_UI_CONTRACTS)
      .flatMap(([cls, contract]) => contract.uiModes.map(mode => `uiOperation:${UiMode[mode]}->${cls}`))
      .sort();
    const registeredUiOperationKeys = [...expectedSurfaces()].filter(key => key.startsWith("uiOperation:")).sort();
    expect(registeredUiOperationKeys).toEqual(expectedUiOperationKeys);
  });

  it.each(["god", "level"] as const)("totally and disjointly partitions every registered surface (%s)", profile => {
    const expected = expectedSurfaces();
    const buckets = [new Set(KNOWN_UNDRIVABLE.keys()), guaranteedSurfaces(profile), probabilisticSurfaces(profile)];
    const classified = new Set<string>();
    for (const bucket of buckets) {
      for (const key of bucket) {
        expect(classified.has(key), `${key} appears in multiple coverage buckets`).toBe(false);
        classified.add(key);
      }
    }
    expect([...classified].sort()).toEqual([...expected].sort());
  });
});
