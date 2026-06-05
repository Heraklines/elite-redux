/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER ships Paldea Tauros' three breeds (Combat/Blaze/Aqua) as SEPARATE custom
// species, but PokeRogue models them as the three FORMS of PALDEA_TAUROS. The
// species bridge only applied ER data to the custom-id species, so the pokerogue
// forms kept vanilla abilities (Intimidate/Anger Point/Cud Chew) + a single
// passive. A post-pass now copies each breed's ER active triple + innates onto
// the matching form.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allAbilities } from "#data/data-lists";
import { SpeciesId } from "#enums/species-id";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import "#test/framework/game-manager";
import { describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function formActiveNames(formIndex: number): string[] {
  const form = getPokemonSpecies(SpeciesId.PALDEA_TAUROS).forms[formIndex];
  return [form.ability1, form.ability2, form.abilityHidden].filter(a => a).map(a => allAbilities[a]?.name);
}

describe.skipIf(!RUN)("ER Paldea Tauros breeds get their distinct ER ability kits", () => {
  it("Combat breed = Hyper Aggressive (not vanilla Intimidate)", () => {
    const names = formActiveNames(0);
    expect(names).toContain("Hyper Aggressive");
    expect(names).not.toContain("Intimidate");
  });

  it("Blaze breed has Immolate (a distinct ER ability)", () => {
    expect(formActiveNames(1)).toContain("Immolate");
  });

  it("Aqua breed has Hydrate (a distinct ER ability)", () => {
    expect(formActiveNames(2)).toContain("Hydrate");
  });

  it("the three breeds are NOT identical (each gets its own kit)", () => {
    const combat = formActiveNames(0).join(",");
    const blaze = formActiveNames(1).join(",");
    const aqua = formActiveNames(2).join(",");
    expect(new Set([combat, blaze, aqua]).size).toBe(3);
  });
});
