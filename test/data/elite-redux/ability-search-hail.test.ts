/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Diagnostic + regression test for the ER ability-text search (#137).
// The search must match the DETAILED ROM ability text and must resolve that
// text by ability ID (not by the ER-localized display name, which never matches
// the English-keyed ROM table).

import { allAbilities } from "#data/data-lists";
import { getErAbilityDescription, getErAbilityRomDescription } from "#data/elite-redux/er-ability-descriptions";
import { matchesAbilityText } from "#data/elite-redux/er-ability-search";
import { SpeciesId } from "#enums/species-id";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { describe, expect, it } from "vitest";

function abilityIds(species: ReturnType<typeof getPokemonSpecies>): number[] {
  return [species.ability1, species.ability2, species.abilityHidden, ...species.getPassiveAbilities(0)].filter(
    Boolean,
  ) as number[];
}

describe("ER ability-text search — 'hail'", () => {
  it("dumps why Lapras / Ledyba match (diagnostic)", () => {
    for (const id of [SpeciesId.LAPRAS, SpeciesId.LEDYBA]) {
      const sp = getPokemonSpecies(id);
      // biome-ignore lint/suspicious/noConsole: diagnostic
      console.log(`\n== ${sp.name} (${id}) — matches 'hail'? ${matchesAbilityText(sp, "hail")}`);
      for (const aid of abilityIds(sp)) {
        const ab = allAbilities[aid];
        const byId = getErAbilityDescription(aid);
        const byName = getErAbilityRomDescription(ab?.name);
        const short = ab?.description ?? "";
        const hit = /hail/i.test(`${ab?.name}\n${byId ?? short}`);
        // biome-ignore lint/suspicious/noConsole: diagnostic
        console.log(
          `  id=${aid} name=${JSON.stringify(ab?.name)} byId=${byId ? "OK" : "—"} byName=${byName ? "OK" : "—"} hailViaDetailed=${hit}`,
        );
      }
    }
  });

  it("matches hail-synergy mons (Lapras/Snow Warning) but not Overcoat-only mons (Ledyba)", () => {
    // Lapras has Snow Warning ("Summons hailstorm") -> should match.
    expect(matchesAbilityText(getPokemonSpecies(SpeciesId.LAPRAS), "hail")).toBe(true);
    // Ledyba's only hail-adjacent ability is Overcoat, whose detailed (by-id)
    // text does not mention hail -> should NOT match (the reported bug).
    expect(matchesAbilityText(getPokemonSpecies(SpeciesId.LEDYBA), "hail")).toBe(false);
  });

  it("still matches by other detailed ability text (e.g. 'sun')", () => {
    // A broad sanity check that text search over detailed text still works.
    const anySun = [SpeciesId.SUNFLORA, SpeciesId.CHARMANDER, SpeciesId.VULPIX].some(id =>
      matchesAbilityText(getPokemonSpecies(id), "fire"),
    );
    expect(anySun).toBe(true);
  });
});
