/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Calyrex Ice/Shadow Rider showed a BLANK main ability and crashed the Pokédex:
// the ER export collapsed both "As One" variants onto ability id 266 and dropped
// id 267, so 266→5004 / 267→5005 pointed at ER-custom slots that were a no-op
// placeholder (As One's archetype is "unknown") or never built. ER "As One" is
// mechanically identical to vanilla As One, so mapAbilityId now remaps
// 266→AS_ONE_GLASTRIER, 267→AS_ONE_SPECTRIER. These resolve to real, registered,
// fully-implemented abilities.

import { allAbilities } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { SpeciesId } from "#enums/species-id";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { describe, expect, it } from "vitest";

describe("Calyrex rider forms get the correct (real) As One ability", () => {
  // Look up inside each test: the species table is populated by initializeGame()
  // during vitest setup, which runs AFTER this module is evaluated.
  const formAbility1 = (formKey: string): number | undefined =>
    getPokemonSpecies(SpeciesId.CALYREX).forms.find(f => f.formKey === formKey)?.ability1;

  it("Ice Rider's main ability is AS_ONE_GLASTRIER", () => {
    expect(formAbility1("ice")).toBe(AbilityId.AS_ONE_GLASTRIER);
  });

  it("Shadow Rider's main ability is AS_ONE_SPECTRIER", () => {
    expect(formAbility1("shadow")).toBe(AbilityId.AS_ONE_SPECTRIER);
  });

  it("both rider abilities resolve to a real, named ability in allAbilities (no blank/crash)", () => {
    for (const id of [AbilityId.AS_ONE_GLASTRIER, AbilityId.AS_ONE_SPECTRIER]) {
      const ability = allAbilities[id];
      expect(ability, `allAbilities[${id}] must exist`).toBeDefined();
      // A real ability has a non-empty name + description — the Pokédex reads
      // `.description` here, which is exactly what crashed when this was missing.
      expect(ability.name.length).toBeGreaterThan(0);
      expect(typeof ability.description).toBe("string");
    }
  });
});
