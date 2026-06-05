/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — custom-mega type-crossing fix. For species that ALSO ship a
// `_REDUX` regional form, ER's `SPECIES_X_MEGA_REDUX` record is that REGIONAL
// form's mega (different typing) — it must NOT be mapped onto the CANONICAL
// mega form. Previously the form-record derivation preferred `_MEGA_REDUX`,
// so e.g. canonical Mega Beedrill showed the regional mega's Ice/Poison instead
// of its own Bug/Poison. This pins the canonical typing for the affected mons.
//
// These read `form.type1/type2` — the same data the Pokédex AND in-game
// mega-evolution use — so it covers both surfaces.
// =============================================================================

import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import "#test/framework/game-manager"; // ensures ER species init has run
import { describe, expect, it } from "vitest";

function megaForm(speciesId: SpeciesId, key = "mega") {
  return getPokemonSpecies(speciesId).forms.find(f => f.formKey === key);
}

describe("ER custom-mega typing — regional `_MEGA_REDUX` must not override canonical mega", () => {
  it("Mega Beedrill is Bug/Poison (not the regional redux mega's Ice/Poison)", () => {
    const mega = megaForm(SpeciesId.BEEDRILL);
    expect(mega).toBeDefined();
    expect([mega!.type1, mega!.type2]).not.toContain(PokemonType.ICE); // the reported bug symptom
    expect(mega!.type1).toBe(PokemonType.BUG);
    expect(mega!.type2).toBe(PokemonType.POISON);
  });

  it("Mega Houndoom keeps its canonical Dark/Fire typing", () => {
    const mega = megaForm(SpeciesId.HOUNDOOM);
    expect(mega).toBeDefined();
    expect(mega!.type1).toBe(PokemonType.DARK);
    expect(mega!.type2).toBe(PokemonType.FIRE);
  });

  it("Mega Sableye keeps its canonical Dark/Ghost typing", () => {
    const mega = megaForm(SpeciesId.SABLEYE);
    expect(mega).toBeDefined();
    expect(mega!.type1).toBe(PokemonType.DARK);
    expect(mega!.type2).toBe(PokemonType.GHOST);
  });

  // Same `_REDUX`-override bug, but on a NON-mega vanilla form: Aegislash's Blade
  // form was inheriting SPECIES_AEGISLASH_BLADE_REDUX's Fighting/Ghost instead of
  // the canonical SPECIES_AEGISLASH_BLADE's Steel/Ghost.
  it("Aegislash Blade keeps canonical Steel/Ghost (not the Redux Fighting/Ghost)", () => {
    const base = getPokemonSpecies(SpeciesId.AEGISLASH);
    const blade = base.forms.find(f => f.formKey === "blade");
    expect(blade).toBeDefined();
    expect([blade!.type1, blade!.type2]).not.toContain(PokemonType.FIGHTING); // the reported symptom
    // Blade shares Aegislash's typing (only stats differ via Stance Change).
    expect(blade!.type1).toBe(base.type1);
    expect(blade!.type2).toBe(base.type2);
    expect(blade!.type1).toBe(PokemonType.STEEL);
    expect(blade!.type2).toBe(PokemonType.GHOST);
  });

  // The base/default form of a re-typed multi-form species must inherit the
  // species' ER type. ER re-typed the whole Lycanroc line (Midday Rock/Ground,
  // Midnight Rock/Dark, …); the Midday (default) form was showing vanilla pure
  // Rock because it had no per-form record.
  it("Lycanroc Midday (default form) is Rock/Ground per ER, not vanilla pure Rock", () => {
    const midday = getPokemonSpecies(SpeciesId.LYCANROC).forms[0];
    expect(midday.type1).toBe(PokemonType.ROCK);
    expect(midday.type2).toBe(PokemonType.GROUND);
  });

  it("base-form type sync is gated: Wormadam's non-default cloaks keep distinct types", () => {
    const wormadam = getPokemonSpecies(SpeciesId.WORMADAM);
    // Sandy Cloak (non-default form) must NOT inherit the Plant base's secondary
    // type — the sync only applies to forms[0].
    expect(wormadam.forms[1].type2).not.toBe(wormadam.forms[0].type2);
  });
});
