/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Editor-managed species tuning (er-species-tuning.json → egg tier + starter
// cost overrides). The loader runs LAST in the init tier/cost chain; these
// tests inject tuning tables directly (applyErSpeciesTuning) and assert:
//   - an override changes the live table value,
//   - an absent key / absent field leaves the value untouched,
//   - a species REMOVED from a table earlier in init is never re-added.
// Run: ER_SCENARIO=1 npx vitest run test/tests/elite-redux/er-species-tuning.test.ts
import { speciesEggTiers } from "#balance/species-egg-tiers";
import { speciesStarterCosts } from "#balance/starters";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import { applyErSpeciesTuning } from "#data/elite-redux/init-elite-redux-species-tuning";
import { EggTier } from "#enums/egg-type";
import { SpeciesId } from "#enums/species-id";
import { afterEach, describe, expect, it } from "vitest";

const tiers = speciesEggTiers as Record<number, EggTier>;
const costs = speciesStarterCosts as Record<number, number>;

// Snapshot/restore the two table entries each test touches.
const originalTier = tiers[SpeciesId.BULBASAUR];
const originalCost = costs[SpeciesId.BULBASAUR];

describe("ER species tuning (er-species-tuning.json loader)", () => {
  afterEach(() => {
    tiers[SpeciesId.BULBASAUR] = originalTier;
    costs[SpeciesId.BULBASAUR] = originalCost;
    delete costs[SpeciesId.IVYSAUR];
    delete tiers[SpeciesId.IVYSAUR];
  });

  it("applies an egg-tier + cost override for a vanilla species", () => {
    expect(originalTier).toBeDefined();
    expect(originalCost).toBeDefined();
    const result = applyErSpeciesTuning({
      SPECIES_BULBASAUR: { eggTier: EggTier.LEGENDARY, cost: 9 },
    });
    expect(result.eggTiersApplied).toBe(1);
    expect(result.costsApplied).toBe(1);
    expect(tiers[SpeciesId.BULBASAUR]).toBe(EggTier.LEGENDARY);
    expect(costs[SpeciesId.BULBASAUR]).toBe(9);
  });

  it("absent species and absent fields leave current values untouched", () => {
    const tierBefore = tiers[SpeciesId.CHIKORITA];
    const costBefore = costs[SpeciesId.CHIKORITA];
    // Bulbasaur entry present but with only a cost — its egg tier must not move.
    const result = applyErSpeciesTuning({ SPECIES_BULBASAUR: { cost: 7 } });
    expect(result.eggTiersApplied).toBe(0);
    expect(tiers[SpeciesId.BULBASAUR]).toBe(originalTier);
    expect(costs[SpeciesId.BULBASAUR]).toBe(7);
    // Chikorita absent from the tuning → fully untouched.
    expect(tiers[SpeciesId.CHIKORITA]).toBe(tierBefore);
    expect(costs[SpeciesId.CHIKORITA]).toBe(costBefore);
  });

  it("never re-adds a species that init removed from the tables", () => {
    // Ivysaur is an evolved form: not a starter, not an egg-pool entry.
    expect(Object.hasOwn(costs, SpeciesId.IVYSAUR)).toBe(false);
    const result = applyErSpeciesTuning({ SPECIES_IVYSAUR: { eggTier: EggTier.COMMON, cost: 3 } });
    expect(result.skippedAbsent).toBe(2);
    expect(Object.hasOwn(costs, SpeciesId.IVYSAUR)).toBe(false);
    expect(Object.hasOwn(tiers, SpeciesId.IVYSAUR)).toBe(false);
  });

  it("resolves ER-custom speciesConsts through the id map", () => {
    // Find any ER custom (id >= 10000) already in the starter grid.
    const customId = Object.keys(costs)
      .map(Number)
      .find(id => id >= 10000);
    expect(customId).toBeDefined();
    // Reverse it to its const via the same path the loader uses.
    const draft = ER_SPECIES.find(d => ER_ID_MAP.species[d.id] === customId);
    expect(draft).toBeDefined();
    const before = costs[customId as number];
    const result = applyErSpeciesTuning({ [draft!.speciesConst]: { cost: before + 1 } });
    expect(result.costsApplied).toBe(1);
    expect(costs[customId as number]).toBe(before + 1);
    costs[customId as number] = before;
  });

  it("unknown speciesConsts are counted, not applied", () => {
    const result = applyErSpeciesTuning({ SPECIES_DOES_NOT_EXIST_XYZ: { cost: 5 } });
    expect(result.skippedUnmapped).toBe(1);
    expect(result.costsApplied).toBe(0);
  });
});
