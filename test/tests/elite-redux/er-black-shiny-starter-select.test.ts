/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  countErBlackShinyStarters,
  enforceErBlackShinyStarterLimit,
  getErBlackShinySpriteSource,
  isErBlackShinyStarterSelection,
} from "#data/elite-redux/er-black-shinies";
import type { PokemonSpecies } from "#data/pokemon-species";
import { describe, expect, it } from "vitest";

describe("Black Shiny starter-select contracts", () => {
  it("resolves the generated t4 atlas under a distinct texture key", () => {
    const bulbasaur = {
      speciesId: 1,
      getSpriteAtlasPath: () => "1",
      getSpriteKey: () => "pkmn__1",
    } as unknown as PokemonSpecies;

    expect(getErBlackShinySpriteSource(bulbasaur, false, 0)).toEqual({
      key: "pkmn__1-erblack",
      atlasPath: "black/1",
    });
  });

  it("requires the Black flag on top of an epic shiny selection", () => {
    expect(isErBlackShinyStarterSelection({ shiny: true, variant: 2, erBlackShiny: true })).toBe(true);
    expect(isErBlackShinyStarterSelection({ shiny: true, variant: 1, erBlackShiny: true })).toBe(false);
    expect(isErBlackShinyStarterSelection({ shiny: false, variant: 2, erBlackShiny: true })).toBe(false);
    expect(isErBlackShinyStarterSelection({ shiny: true, variant: 2, erBlackShiny: false })).toBe(false);
  });

  it("preserves only the first Black Shiny in restored or merged starter data", () => {
    const starters = [
      { speciesId: 1, erBlackShiny: true },
      { speciesId: 4, erBlackShiny: false },
      { speciesId: 7, erBlackShiny: true },
    ];

    const capped = enforceErBlackShinyStarterLimit(starters);
    expect(capped).toEqual([
      { speciesId: 1, erBlackShiny: true },
      { speciesId: 4, erBlackShiny: false },
      { speciesId: 7, erBlackShiny: false },
    ]);
    expect(countErBlackShinyStarters(capped)).toBe(1);
    expect(capped[0]).toBe(starters[0]);
    expect(capped[1]).toBe(starters[1]);
    expect(capped[2]).not.toBe(starters[2]);
  });
});
