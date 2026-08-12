import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { isEvioliteEligiblePokemon } from "#system/achv";
import { describe, expect, it } from "vitest";

function pokemonAtForm(speciesId: SpeciesId, formKey: string): Pokemon {
  return {
    getSpeciesForm: () => ({ speciesId }),
    getFormKey: () => formKey,
  } as unknown as Pokemon;
}

describe("Eviolite achievement eligibility", () => {
  it("does not count a terminal form merely because another form of that species evolves", () => {
    const original = pokemonEvolutions[SpeciesId.CHARIZARD];
    pokemonEvolutions[SpeciesId.CHARIZARD] = [{ preFormKey: "redux" } as SpeciesFormEvolution];
    try {
      expect(isEvioliteEligiblePokemon(pokemonAtForm(SpeciesId.CHARIZARD, ""))).toBe(false);
      expect(isEvioliteEligiblePokemon(pokemonAtForm(SpeciesId.CHARIZARD, "redux"))).toBe(true);
    } finally {
      if (original == null) {
        delete pokemonEvolutions[SpeciesId.CHARIZARD];
      } else {
        pokemonEvolutions[SpeciesId.CHARIZARD] = original;
      }
    }
  });
});

import { pokemonEvolutions, type SpeciesFormEvolution } from "#balance/pokemon-evolutions";
