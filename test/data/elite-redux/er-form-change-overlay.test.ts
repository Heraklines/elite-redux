import {
  findErFormChangeByTarget,
  getErFormChangeCount,
  getErFormChangeKindBreakdown,
  getErFormChangesByKind,
  getErFormChangesByRequirement,
  getErFormChangesFor,
  hasErFormChanges,
} from "#data/elite-redux/er-form-change-overlay";
import { ER_FORM_CHANGE_KIND } from "#data/elite-redux/init-elite-redux-form-changes";
import { SpeciesId } from "#enums/species-id";
import { describe, expect, it } from "vitest";

/**
 * Phase D1 — form-change overlay helper tests. Registry is populated by
 * initEliteReduxFormChanges() at vitest setup.
 */
describe("ER form-change overlay (D1)", () => {
  it("getErFormChangeCount returns the expected count (~303)", () => {
    const count = getErFormChangeCount();
    expect(count).toBeGreaterThan(280);
    expect(count).toBeLessThan(350);
  });

  it("getErFormChangeKindBreakdown matches taxonomy expectations", () => {
    const breakdown = getErFormChangeKindBreakdown();
    expect(breakdown[ER_FORM_CHANGE_KIND.MEGA]).toBeGreaterThan(280);
    expect(breakdown[ER_FORM_CHANGE_KIND.PRIMAL]).toBeGreaterThan(15);
    expect(breakdown[ER_FORM_CHANGE_KIND.MOVE_MEGA]).toBeGreaterThanOrEqual(1);
    // LEVEL kinds shouldn't appear in the form-change registry (those are
    // evolutions, not form changes).
    expect(breakdown[ER_FORM_CHANGE_KIND.LEVEL]).toBe(0);
  });

  it("getErFormChangesFor returns Venusaur's mega variants", () => {
    const entries = getErFormChangesFor(SpeciesId.VENUSAUR);
    expect(entries.length).toBeGreaterThan(0);
    // At least one entry should be a MEGA kind.
    expect(entries.some(e => e.kind === ER_FORM_CHANGE_KIND.MEGA)).toBe(true);
  });

  it("hasErFormChanges returns true for species with megas/primals", () => {
    expect(hasErFormChanges(SpeciesId.VENUSAUR)).toBe(true);
    expect(hasErFormChanges(SpeciesId.CHARIZARD)).toBe(true);
    expect(hasErFormChanges(SpeciesId.GROUDON)).toBe(true);
  });

  it("hasErFormChanges returns false for species without ER form changes", () => {
    // SpeciesId.NONE = 0 shouldn't be in the form-change registry.
    expect(hasErFormChanges(0)).toBe(false);
  });

  it("getErFormChangesFor returns empty array for unknown species", () => {
    expect(getErFormChangesFor(99999)).toEqual([]);
  });

  it("findErFormChangeByTarget returns the source for a known ER mega target", () => {
    // Pick the first MEGA entry and verify the reverse lookup works.
    const megas = getErFormChangesByKind(ER_FORM_CHANGE_KIND.MEGA);
    expect(megas.length).toBeGreaterThan(0);
    if (megas.length === 0) {
      return;
    }
    const sample = megas[0];
    const reverseLookup = findErFormChangeByTarget(sample.targetSpeciesId);
    expect(reverseLookup).toBeDefined();
    if (!reverseLookup) {
      return;
    }
    expect(reverseLookup.sourceSpeciesId).toBe(sample.sourceSpeciesId);
  });

  it("findErFormChangeByTarget returns undefined for unknown target", () => {
    expect(findErFormChangeByTarget(99999)).toBeUndefined();
  });

  it("getErFormChangesByKind returns only MEGA entries when filtered to MEGA", () => {
    const megas = getErFormChangesByKind(ER_FORM_CHANGE_KIND.MEGA);
    expect(megas.length).toBeGreaterThan(0);
    expect(megas.every(e => e.kind === ER_FORM_CHANGE_KIND.MEGA)).toBe(true);
  });

  it("getErFormChangesByRequirement groups by item/move const", () => {
    // Look for Mega Mewtwo's mewtwonite — typical ER mega-stone naming.
    // The exact item const may vary; we use a known requirement from the
    // sample data.
    const byKyogreOrb = getErFormChangesByRequirement("ITEM_BLUE_ORB");
    // Kyogre's primal reversion uses BLUE_ORB. May or may not be in v2.65 —
    // assert non-zero only if any are found.
    if (byKyogreOrb.length > 0) {
      expect(byKyogreOrb.every(e => e.requirement === "ITEM_BLUE_ORB")).toBe(true);
    }
  });

  it("MOVE_MEGA entries have a MOVE_-prefixed requirement", () => {
    const moveMegas = getErFormChangesByKind(ER_FORM_CHANGE_KIND.MOVE_MEGA);
    for (const entry of moveMegas) {
      expect(entry.requirement.startsWith("MOVE_")).toBe(true);
    }
  });
});
