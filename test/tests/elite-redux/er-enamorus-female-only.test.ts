/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — female-only species must never roll MALE (Enamorus report).
//
// Enamorus is a female-only species (malePercent === 0). The port rolled gender
// with `randSeedFloat() * 100 <= malePercent`; when `randSeedFloat()` returns
// exactly 0 the `<= 0` branch fired MALE, so hatch/catch/wild generation could
// produce a male Enamorus (and any other female-only species). The fix uses a
// strict `<`, so `< 0` is never true and a female-only species is always FEMALE,
// while the RNG is still drawn (seeded-stream position unchanged) and male-only
// species (100) stay MALE because `randSeedFloat()` is [0, 1).
// =============================================================================

import { Gender } from "#data/gender";
import { SpeciesId } from "#enums/species-id";
import * as common from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("ER — female-only species never roll MALE", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Enamorus is a female-only species (malePercent === 0)", () => {
    expect(getPokemonSpecies(SpeciesId.ENAMORUS).malePercent).toBe(0);
  });

  it("Enamorus stays FEMALE even on the boundary roll (randSeedFloat() === 0)", () => {
    // The exact roll that leaked MALE under the old `<=` comparison.
    vi.spyOn(common, "randSeedFloat").mockReturnValue(0);
    expect(getPokemonSpecies(SpeciesId.ENAMORUS).generateGender()).toBe(Gender.FEMALE);
  });

  it("Enamorus never rolls MALE across the full [0, 1) roll range", () => {
    const enamorus = getPokemonSpecies(SpeciesId.ENAMORUS);
    const rolls = [0, 0.0000001, 0.25, 0.5, 0.9999999];
    for (const r of rolls) {
      vi.spyOn(common, "randSeedFloat").mockReturnValue(r);
      expect(enamorus.generateGender(), `roll ${r} should be FEMALE`).toBe(Gender.FEMALE);
    }
  });

  it("a male-only species (Tauros, malePercent 100) still rolls MALE on every roll", () => {
    const tauros = getPokemonSpecies(SpeciesId.TAUROS);
    expect(tauros.malePercent).toBe(100);
    for (const r of [0, 0.5, 0.9999999]) {
      vi.spyOn(common, "randSeedFloat").mockReturnValue(r);
      expect(tauros.generateGender(), `roll ${r} should be MALE`).toBe(Gender.MALE);
    }
  });
});
