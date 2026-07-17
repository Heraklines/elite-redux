/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Item 3 regression: a wild-caught Whismur Redux must credit its candy to the
// WHISMUR_REDUX collection bucket (id 10724), NOT vanilla Whismur.
//
// In-run redux mons are VANILLA species wearing the "redux" FORM. On catch,
// GameData.setPokemonCaught redirects registration to the RDX counterpart
// species via getErReduxCounterpartId (#410), and setPokemonSpeciesCaught then
// grants candy to that counterpart. addStarterCandy -> getRootStarterSpeciesId
// keeps the counterpart as its own line ROOT (no prevolution to vanilla), so the
// candy lands on the WHISMUR_REDUX bucket. This pins each link so a future change
// to the redux redirect / root resolution can't silently send the candy back to
// the vanilla slot (the live 2026-07-15 player report).
// Gated ER_SCENARIO=1.
// =============================================================================

import { pokemonPrevolutions } from "#balance/pokemon-evolutions";
import { allSpecies } from "#data/data-lists";
import { getErReduxCounterpartId } from "#data/elite-redux/er-redux-dex-redirect";
import { ErSpeciesId } from "#enums/er-species-id";
import { SpeciesId } from "#enums/species-id";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { describe, expect, it } from "vitest";

describe("Whismur Redux candy bucket (#410 / item 3)", () => {
  it("vanilla Whismur ships a 'redux' form", () => {
    const whismur = getPokemonSpecies(SpeciesId.WHISMUR);
    expect(whismur.forms.some(f => f.formKey === "redux")).toBe(true);
  });

  it("a redux-form Whismur catch redirects to the WHISMUR_REDUX counterpart", () => {
    expect(getErReduxCounterpartId(SpeciesId.WHISMUR, "redux")).toBe(ErSpeciesId.WHISMUR_REDUX);
  });

  it("WHISMUR_REDUX is its OWN candy-line root (candy never rolls up to vanilla)", () => {
    const whismurReduxId = ErSpeciesId.WHISMUR_REDUX as number;
    const wr = allSpecies.find(s => (s.speciesId as number) === whismurReduxId);
    expect(wr).toBeDefined();
    // No prevolution edge -> getRootSpeciesId returns itself -> addStarterCandy
    // (which routes through getRootStarterSpeciesId) lands on this bucket, not vanilla.
    expect(pokemonPrevolutions[ErSpeciesId.WHISMUR_REDUX as unknown as SpeciesId]).toBeUndefined();
    expect(wr?.getRootSpeciesId() as number).toBe(whismurReduxId);
  });
});
