/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// For a multi-form species (Gyarados = base + Mega), pokerogue resolves a
// battler's ability/passives through its ACTIVE form. ER's species-level
// setActiveAbilities/setPassives skipped the base form (formKey === ""), so in
// battle Gyarados showed vanilla Intimidate instead of its ER actives
// (Moxie / Sea Guardian / Rampage). The base form must carry the ER triple.
import { allAbilities } from "#data/data-lists";
import { SpeciesId } from "#enums/species-id";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const name = (id: number): string => allAbilities[id]?.name ?? "?";

describe.skipIf(!RUN)("ER Gyarados base-form abilities (multi-form active-ability propagation)", () => {
  it("base form (index 0) carries ER actives Moxie/Sea Guardian/Rampage + ER innates", () => {
    const g = getPokemonSpecies(SpeciesId.GYARADOS);
    // Sanity: ER overrode the species-level actives.
    expect(name(g.ability1)).toBe("Moxie");

    // The base form must mirror them (this is what battle getAbility() reads).
    const base = g.forms.find(f => f.formKey === "") ?? g.forms[0];
    if (base) {
      expect(name(base.ability1)).toBe("Moxie");
      expect(name(base.ability2)).toBe("Sea Guardian");
      expect(name(base.abilityHidden)).toBe("Rampage");
      const passiveNames = base.getPassiveAbilities(0).map(name);
      expect(passiveNames).toContain("Intimidate");
      expect(passiveNames).toContain("Draconize");
      expect(passiveNames).toContain("Overwhelm");
      // The base form must NOT keep vanilla Intimidate as its active ability.
      expect(name(base.ability1)).not.toBe("Intimidate");
    }
  });
});
