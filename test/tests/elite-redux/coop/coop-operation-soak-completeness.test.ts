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
  assertSoakCompleteness,
  createSoakHitSet,
  expectedSurfaces,
  guaranteedSurfaces,
  KNOWN_UNDRIVABLE,
  probabilisticSurfaces,
  REVIEWED_UNDRIVABLE_UI_OPERATIONS,
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

  it("keeps reviewed UI -> operation debt explicit, unique, and inside the declared contract", () => {
    const expectedUiOperationKeys = Object.entries(COOP_OPERATION_UI_CONTRACTS)
      .flatMap(([cls, contract]) => contract.uiModes.map(mode => `uiOperation:${UiMode[mode]}->${cls}`))
      .sort();
    const reviewedDebtKeys = REVIEWED_UNDRIVABLE_UI_OPERATIONS.map(
      ([mode, cls]) => `uiOperation:${UiMode[mode]}->${cls}`,
    ).sort();
    expect(new Set(reviewedDebtKeys).size, "reviewed UI-operation debt contains duplicate tuples").toBe(
      reviewedDebtKeys.length,
    );
    expect(reviewedDebtKeys.filter(key => !expectedUiOperationKeys.includes(key))).toEqual([]);
    expect(reviewedDebtKeys.filter(key => !KNOWN_UNDRIVABLE.has(key))).toEqual([]);
    expect(reviewedDebtKeys).not.toContain("uiOperation:CONFIRM->op:reward");
    expect(guaranteedSurfaces("god")).toContain("uiOperation:CONFIRM->op:reward");
    expect(guaranteedSurfaces("level")).toContain("uiOperation:CONFIRM->op:reward");
  });

  it("reds an observed UI -> operation edge that is absent from the declared contract even below the depth gate", () => {
    const hits = createSoakHitSet();
    hits.uiOperations.add("COMMAND->op:reward");
    expect(() => assertSoakCompleteness(hits, { wavesCompleted: 0, seed: 101 })).toThrow(
      "UNDECLARED UI-OPERATION EDGE",
    );
  });

  it("reds an observed UI -> operation edge while it is still exempt as undrivable", () => {
    const hits = createSoakHitSet();
    hits.uiOperations.add("PARTY->op:catchFull");
    expect(() => assertSoakCompleteness(hits, { wavesCompleted: 0, seed: 102 })).toThrow(
      "OBSERVED UI-OPERATION STILL UNDRIVABLE",
    );
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
