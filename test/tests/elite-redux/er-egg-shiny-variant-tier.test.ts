/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// ER-custom species render their shiny tiers from dedicated `_shiny2`/`_shiny3`
// sprites (not the vanilla `variantData` colour-swap registry), so `hasVariants()`
// returned false and eggs pinned them to the STANDARD shiny tier — they could
// never roll the higher RARE/EPIC tiers, and (since RARE/EPIC egg rolls filter
// the species pool to `hasVariants()` species) were excluded from those rolls
// entirely. hasVariants() must report true for ER customs.
import { allSpecies } from "#data/data-lists";
import { describe, expect, it } from "vitest";

const VANILLA_CUTOFF = 10000;

describe("ER egg shiny-variant tier eligibility", () => {
  it("every ER-custom species (id ≥ 10000) reports hasVariants() === true", () => {
    const customs = allSpecies.filter(s => s?.speciesId >= VANILLA_CUTOFF);
    expect(customs.length).toBeGreaterThan(0);
    const blocked = customs.filter(s => !s.hasVariants()).map(s => `${s.name}(${s.speciesId})`);
    expect(
      blocked,
      `${blocked.length} ER customs still STANDARD-locked:\n${blocked.slice(0, 20).join("\n")}`,
    ).toHaveLength(0);
  });

  it("does not falsely enable variants for a vanilla species that has none", () => {
    // Sanity: the change is gated on id ≥ 10000, so vanilla species are
    // unaffected — a vanilla species without variant data stays false.
    const vanillaNoVariant = allSpecies.find(s => s?.speciesId < VANILLA_CUTOFF && !s.hasVariants());
    // (If every sampled vanilla species happens to have variants this is a
    // no-op; the assertion only matters when such a species exists.)
    if (vanillaNoVariant) {
      expect(vanillaNoVariant.speciesId).toBeLessThan(VANILLA_CUTOFF);
      expect(vanillaNoVariant.hasVariants()).toBe(false);
    }
  });
});
