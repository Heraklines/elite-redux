import { allSpecies } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { SpeciesId } from "#enums/species-id";
import { describe, expect, it } from "vitest";

describe("PokemonSpeciesForm 3-passive accessors", () => {
  it("falls back to legacy single passive in slot 1 when no override is set", () => {
    const species = allSpecies.find(s => s.speciesId === SpeciesId.BULBASAUR);
    expect(species).toBeDefined();
    if (!species) {
      return;
    }
    const passives = species.getPassiveAbilities();
    expect(passives.length).toBe(3);
    // Slot 1 must match the legacy getPassiveAbility() result
    expect(passives[0]).toBe(species.getPassiveAbility());
    expect(passives[1]).toBe(AbilityId.NONE);
    expect(passives[2]).toBe(AbilityId.NONE);
  });

  it("setPassives() installs a 3-passive triple that getPassiveAbilities() returns", () => {
    const species = allSpecies.find(s => s.speciesId === SpeciesId.BULBASAUR);
    expect(species).toBeDefined();
    if (!species) {
      return;
    }
    const original = species.getPassiveAbilities();
    try {
      species.setPassives([AbilityId.OVERGROW, AbilityId.CHLOROPHYLL, AbilityId.LEAF_GUARD]);
      const passives = species.getPassiveAbilities();
      expect(passives).toEqual([AbilityId.OVERGROW, AbilityId.CHLOROPHYLL, AbilityId.LEAF_GUARD]);
    } finally {
      // Restore — don't pollute other tests.
      (species as unknown as { _passives: unknown })._passives = null;
      expect(species.getPassiveAbilities()).toEqual(original);
    }
  });

  it("getPassiveCount returns the count of non-NONE slots", () => {
    const species = allSpecies.find(s => s.speciesId === SpeciesId.BULBASAUR);
    expect(species).toBeDefined();
    if (!species) {
      return;
    }
    try {
      species.setPassives([AbilityId.OVERGROW, AbilityId.CHLOROPHYLL, AbilityId.LEAF_GUARD]);
      expect(species.getPassiveCount()).toBe(3);

      species.setPassives([AbilityId.OVERGROW, AbilityId.NONE, AbilityId.NONE]);
      expect(species.getPassiveCount()).toBe(1);

      species.setPassives([AbilityId.NONE, AbilityId.NONE, AbilityId.NONE]);
      expect(species.getPassiveCount()).toBe(0);
    } finally {
      (species as unknown as { _passives: unknown })._passives = null;
    }
  });

  it("legacy getPassiveAbility() still works (back-compat)", () => {
    const species = allSpecies.find(s => s.speciesId === SpeciesId.BULBASAUR);
    expect(species).toBeDefined();
    if (!species) {
      return;
    }
    const legacy = species.getPassiveAbility();
    expect(legacy).not.toBe(AbilityId.NONE);
    expect(typeof legacy).toBe("number");
  });
});
