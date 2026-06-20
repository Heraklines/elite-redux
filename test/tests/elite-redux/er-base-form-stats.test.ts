/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER overrides each vanilla species' base stats (setBaseStats). For species that
// pokerogue ships with a NATIVE form (e.g. Beedrill has a Mega), forms[0] is a
// pre-built vanilla base form - and the ER override wrote species.baseStats but
// NOT forms[0].baseStats. Battle reads the species stats (so combat was right),
// but the Pokedex/summary read the FORM's stats, so Beedrill showed VANILLA stats
// in the dex (reported in prod). The init now mirrors the ER base stats onto the
// default form. This pins: a re-statted native-form species' base form matches
// its species' ER stats (not the old vanilla line).
// =============================================================================

import { allSpecies } from "#data/data-lists";
import { SpeciesId } from "#enums/species-id";
import { describe, expect, it } from "vitest";

describe("ER base-form stats mirror the species' ER stats", () => {
  it("Beedrill's base form has the ER stats, not vanilla", () => {
    const beedrill = allSpecies.find(s => s.speciesId === SpeciesId.BEEDRILL)!;
    const ER_STATS = [65, 110, 40, 45, 80, 135]; // vanilla was [65, 90, 40, 45, 80, 75]
    expect(beedrill.baseStats).toEqual(ER_STATS);
    const baseForm = beedrill.forms.find(f => f.formKey === "");
    expect(baseForm, "Beedrill should have a base form (it ships a Mega)").toBeDefined();
    expect(baseForm!.baseStats).toEqual(ER_STATS); // the fix: was the vanilla line
  });

  it("the default form (index 0) base stats match the species for native-form species", () => {
    // Sample of vanilla species pokerogue ships with native forms (megas etc.) -
    // their forms[0] must mirror the ER species stats the dex/summary read.
    for (const id of [
      SpeciesId.BEEDRILL,
      SpeciesId.VENUSAUR,
      SpeciesId.CHARIZARD,
      SpeciesId.GYARADOS,
      SpeciesId.LUCARIO,
      SpeciesId.GARCHOMP,
    ]) {
      const species = allSpecies.find(s => s.speciesId === id);
      if (!species || species.forms.length === 0) {
        continue;
      }
      expect(species.forms[0].baseStats, `${SpeciesId[id]} forms[0] should match species`).toEqual(species.baseStats);
    }
  });
});
