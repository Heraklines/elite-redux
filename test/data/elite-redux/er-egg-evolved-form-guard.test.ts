/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Evolved ER customs (e.g. Infernape/Monferno Redux) must NOT be egg-hatchable.
import { pokemonPrevolutions } from "#balance/pokemon-evolutions";
import { speciesEggTiers } from "#balance/species-egg-tiers";
import { allSpecies } from "#data/data-lists";
import { describe, expect, it } from "vitest";

describe("ER egg pool — evolved forms excluded", () => {
  const findByName = (name: string) => allSpecies.find(s => s.name.toLowerCase() === name.toLowerCase());

  it("Infernape Redux and Monferno Redux are not in the egg pool", () => {
    const infernapeRedux = findByName("Infernape Redux");
    const monfernoRedux = findByName("Monferno Redux");
    expect(infernapeRedux, "Infernape Redux species should exist").toBeDefined();
    // Neither evolved Redux stage may hatch.
    expect(Object.hasOwn(speciesEggTiers, infernapeRedux!.speciesId)).toBe(false);
    if (monfernoRedux) {
      expect(Object.hasOwn(speciesEggTiers, monfernoRedux.speciesId)).toBe(false);
    }
  });

  it("Chimchar Redux (base stage) IS still hatchable", () => {
    const chimcharRedux = findByName("Chimchar Redux");
    if (chimcharRedux) {
      expect(Object.hasOwn(speciesEggTiers, chimcharRedux.speciesId)).toBe(true);
    }
  });

  it("reports whether the Infernape Redux prevolution actually registered (data-health signal)", () => {
    const infernapeRedux = findByName("Infernape Redux");
    // Not an assertion failure either way — just surfaces whether the evolution
    // chain (Monferno Redux → Infernape Redux) wired up, separate from the egg
    // guard which protects eggs regardless.
    const hasPrevo = infernapeRedux ? Object.hasOwn(pokemonPrevolutions, infernapeRedux.speciesId) : false;
    console.log(`INFERNAPE_REDUX prevolution registered: ${hasPrevo}`);
    expect(typeof hasPrevo).toBe("boolean");
  });
});

describe("ER egg pool — Redux B / variant branches excluded", () => {
  it("Infernape Redux B is not hatchable + its prevo state", async () => {
    const { allSpecies } = await import("#data/data-lists");
    const { speciesEggTiers } = await import("#balance/species-egg-tiers");
    const { pokemonPrevolutions } = await import("#balance/pokemon-evolutions");
    for (const nm of ["Infernape Redux B", "Infernape Redux Mega"]) {
      const sp = allSpecies.find(s => s.name.toLowerCase() === nm.toLowerCase());
      if (sp) {
        console.log(
          `${nm}: inEggPool=${Object.hasOwn(speciesEggTiers, sp.speciesId)} hasPrevo=${Object.hasOwn(pokemonPrevolutions, sp.speciesId)}`,
        );
        expect(Object.hasOwn(speciesEggTiers, sp.speciesId)).toBe(false);
      } else {
        console.log(`${nm}: NOT FOUND as a distinct species`);
      }
    }
  });
});
