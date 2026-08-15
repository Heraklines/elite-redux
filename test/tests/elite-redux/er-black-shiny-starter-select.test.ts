/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  countErBlackShinyStarters,
  enforceErBlackShinyStarterLimit,
  getErBlackShinySpriteSource,
  isErBlackShinyStarterSelection,
  reconcileErBlackShinyStarterSelection,
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

  it("prefers each Redux species' slug atlas over its numeric custom-id atlas", () => {
    const sableyeRedux = {
      speciesId: 10736,
      getSpriteAtlasPath: () => "elite-redux/sableye_redux/front",
      getSpriteKey: () => "er__sableye_redux",
    } as unknown as PokemonSpecies;
    const tsareenaRedux = {
      speciesId: 10790,
      getSpriteAtlasPath: () => "elite-redux/tsareena_redux/front",
      getSpriteKey: () => "er__tsareena_redux",
    } as unknown as PokemonSpecies;

    expect(getErBlackShinySpriteSource(sableyeRedux, false, 0)?.atlasPath).toBe(
      "black/elite-redux/sableye_redux/front",
    );
    expect(getErBlackShinySpriteSource(tsareenaRedux, false, 0)?.atlasPath).toBe(
      "black/elite-redux/tsareena_redux/front",
    );
  });

  it("requires the Black flag on top of an epic shiny selection", () => {
    expect(isErBlackShinyStarterSelection({ shiny: true, variant: 2, erBlackShiny: true })).toBe(true);
    expect(isErBlackShinyStarterSelection({ shiny: true, variant: 1, erBlackShiny: true })).toBe(false);
    expect(isErBlackShinyStarterSelection({ shiny: false, variant: 2, erBlackShiny: true })).toBe(false);
    expect(isErBlackShinyStarterSelection({ shiny: true, variant: 2, erBlackShiny: false })).toBe(false);
  });

  it("preserves an explicit Black-tier choice when the cached starter is still epic/red", () => {
    const cachedStarter = { speciesId: 1, shiny: true, variant: 2, erBlackShiny: false };

    expect(
      reconcileErBlackShinyStarterSelection(cachedStarter, true, {
        shiny: true,
        variant: 2,
        erBlackShiny: true,
      }),
    ).toEqual({ speciesId: 1, shiny: true, variant: 2, erBlackShiny: true });
  });

  it("never promotes an ordinary epic/red starter without the explicit Black-tier choice", () => {
    const staleBlackStarter = { speciesId: 1, shiny: true, variant: 2, erBlackShiny: true };

    expect(
      reconcileErBlackShinyStarterSelection(staleBlackStarter, true, {
        shiny: true,
        variant: 2,
        erBlackShiny: false,
      }),
    ).toEqual({ speciesId: 1, shiny: true, variant: 2, erBlackShiny: false });
    expect(
      reconcileErBlackShinyStarterSelection(staleBlackStarter, false, {
        shiny: true,
        variant: 2,
        erBlackShiny: true,
      }),
    ).toEqual({ speciesId: 1, shiny: true, variant: 2, erBlackShiny: false });
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
