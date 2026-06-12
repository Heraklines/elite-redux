/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER-custom starter-cost re-tier (legendary/AG overrides + BST bands) and the
// removal of ability/item-emergent battle forms from the starter grid + egg
// pool. ONLY ER customs (id >= 10000) are touched — vanilla costs are untouched.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { speciesEggTiers } from "#balance/species-egg-tiers";
import { getPassiveCandyCount, getValueReductionCandyCounts, speciesStarterCosts } from "#balance/starters";
import { allSpecies } from "#data/data-lists";
import { EggTier } from "#enums/egg-type";
import { SpeciesId } from "#enums/species-id";
import "#test/framework/game-manager";
import { describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function idByName(name: string): number | undefined {
  return allSpecies.find(s => s.name === name)?.speciesId;
}
function costOf(name: string): number | undefined {
  const id = idByName(name);
  return id != null && Object.hasOwn(speciesStarterCosts, id)
    ? (speciesStarterCosts as Record<number, number>)[id]
    : undefined;
}
function inGrid(name: string): boolean {
  const id = idByName(name);
  return id != null && Object.hasOwn(speciesStarterCosts, id);
}
function inEggPool(name: string): boolean {
  const id = idByName(name);
  return id != null && Object.hasOwn(speciesEggTiers, id);
}

describe.skipIf(!RUN)("ER custom starter cost re-tier + form removals", () => {
  it("applies the legendary / AG cost overrides", () => {
    expect(costOf("Kecleong")).toBe(12);
    expect(costOf("Burmy Eterna")).toBe(11);
    expect(costOf("Kartana Fallen")).toBe(11);
    expect(costOf("Darkrai Nightmare")).toBe(10);
    // Zygarde Complete (battle form) and Zarude Dada (vanilla cosmetic) were
    // removed from the grid entirely by the #407 declutter ban list.
    expect(costOf("Zygarde Complete")).toBeUndefined();
    expect(costOf("Zarude Dada")).toBeUndefined();
  });

  it("the imported Arceus type plates are out of the grid (#407 - vanilla plates cover them)", () => {
    for (const t of ["Fire", "Water", "Dragon", "Fairy", "Steel"]) {
      expect(costOf(`Arceus ${t}`)).toBeUndefined();
      expect(inEggPool(`Arceus ${t}`)).toBe(false);
    }
  });

  it("Redux forms are cheap (3-4)", () => {
    const swinub = costOf("Swinub Redux");
    expect(swinub).toBeGreaterThanOrEqual(3);
    expect(swinub).toBeLessThanOrEqual(4);
  });

  it("removes ability/item-emergent forms from BOTH the grid and the egg pool", () => {
    for (const name of [
      "Palafin Hero",
      "Wishiwashi School",
      "Morpeko Hangry",
      "Hoopa Unbound",
      "Slate",
      "Minior Core Red",
      "Vivillon Fancy",
    ]) {
      expect(inGrid(name), `${name} should be out of the starter grid`).toBe(false);
      expect(inEggPool(name), `${name} should be out of the egg pool`).toBe(false);
    }
  });

  it("cost 11 & 12 don't overflow the candy-cost table (starter-select crash regression)", () => {
    // The AG tier costs (Burmy Eterna 11, Kecleong 12) exceeded the 10-entry
    // allStarterCandyCosts array → `undefined.passive` crashed starter-select.
    for (const cost of [10, 11, 12]) {
      expect(() => getPassiveCandyCount(cost)).not.toThrow();
      expect(getPassiveCandyCount(cost)).toBeGreaterThan(0);
      expect(getValueReductionCandyCounts(cost)).toHaveLength(2);
    }
  });

  it("cost 8-12 customs hatch from Legendary eggs (lower costs keep their tier)", () => {
    const tierOf = (name: string): number | undefined => {
      const id = idByName(name);
      return id != null && Object.hasOwn(speciesEggTiers, id)
        ? (speciesEggTiers as Record<number, number>)[id]
        : undefined;
    };
    expect(tierOf("Kecleong")).toBe(EggTier.LEGENDARY); // 12
    expect(tierOf("Burmy Eterna")).toBe(EggTier.LEGENDARY); // 11
    expect(tierOf("Ash-Greninja")).toBe(EggTier.LEGENDARY); // 8
    // Arceus Fire / Zarude Dada are gone from the pool entirely (#407 bans).
    expect(tierOf("Arceus Fire")).toBeUndefined();
    expect(tierOf("Zarude Dada")).toBeUndefined();
  });

  it("does NOT touch vanilla starter costs (Kecleon stays vanilla)", () => {
    // Vanilla Kecleon (id < 10000) keeps its original cost — the re-tier only
    // touches id >= 10000.
    expect((speciesStarterCosts as Record<number, number>)[SpeciesId.KECLEON]).toBe(2);
  });
});
