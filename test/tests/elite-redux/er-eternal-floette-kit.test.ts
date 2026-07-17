/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Eternal Floette carries its ER 2.65 kit.
//
// DEX (2.65) "Floette Eternal Flower": actives Energy Tap / Grassy Surge /
// Fairy Aura; innates Pastel Veil / Magic Guard / Mystic Power. The surfaced
// species is the vanilla SpeciesId.ETERNAL_FLOETTE, patched by the ER pokedex
// ability override (er-species-abilities.json → SPECIES_ETERNAL_FLOETTE). The
// override's innate triple was [Magic Guard, Mega Launcher, Reckless] — only
// Magic Guard was right; Mega Launcher / Reckless are not in the kit. Corrected
// to Pastel Veil / Magic Guard / Mystic Power.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { SpeciesId } from "#enums/species-id";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { describe, expect, it } from "vitest";

describe("ER — Eternal Floette kit (er-species-abilities override)", () => {
  const floette = () => getPokemonSpecies(SpeciesId.ETERNAL_FLOETTE);

  it("active abilities are Energy Tap / Grassy Surge / Fairy Aura", () => {
    const sp = floette();
    expect(sp.ability1, "primary should be Energy Tap").toBe(ErAbilityId.ENERGY_TAP as unknown as AbilityId);
    expect(sp.ability2, "secondary should be Grassy Surge").toBe(AbilityId.GRASSY_SURGE);
    expect(sp.abilityHidden, "hidden should be Fairy Aura").toBe(AbilityId.FAIRY_AURA);
  });

  it("innate triple is Pastel Veil / Magic Guard / Mystic Power (no Mega Launcher / Reckless)", () => {
    const triple = floette().getPassiveAbilities();
    expect(triple[0], "innate 1 should be Pastel Veil").toBe(AbilityId.PASTEL_VEIL);
    expect(triple[1], "innate 2 should be Magic Guard").toBe(AbilityId.MAGIC_GUARD);
    expect(triple[2], "innate 3 should be Mystic Power").toBe(ErAbilityId.MYSTIC_POWER as unknown as AbilityId);
    expect(triple, "no Mega Launcher / Reckless leftover").not.toContain(AbilityId.MEGA_LAUNCHER);
    expect(triple).not.toContain(AbilityId.RECKLESS);
  });
});
