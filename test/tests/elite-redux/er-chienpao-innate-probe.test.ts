/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Probe: Chien-Pao's dex inns are [579, 393, 173] = ARRAY POSITIONS (Sword of
// Ruin, Arctic Fur, Strong Jaw). Position 393 carries id-field 392 (Arctic Fur);
// resolved by id-field it would be 393 = Spectralize (the reported wrong value).
// This asserts the CURRENT runtime resolves the middle innate to Arctic Fur.

import { allAbilities, allSpecies } from "#data/data-lists";
import { SpeciesId } from "#enums/species-id";
import { describe, expect, it } from "vitest";

describe("ER Chien-Pao innate resolves to Arctic Fur (not Spectralize)", () => {
  it("position 393 -> Arctic Fur via dexAbilityId", () => {
    const cp = allSpecies.find(s => s.speciesId === SpeciesId.CHIEN_PAO);
    expect(cp, "Chien-Pao should exist").toBeDefined();
    const passives = cp!.getPassiveAbilities(0);
    const names = passives.map(id => allAbilities[id]?.name ?? `?${id}`);
    console.log("Chien-Pao passive triple:", JSON.stringify(names));
    expect(names).toContain("Arctic Fur");
    expect(names).not.toContain("Spectralize");
  });
});
