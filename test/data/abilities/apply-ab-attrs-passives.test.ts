import { Ability } from "#abilities/ability";
import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { allAbilities, allSpecies } from "#data/data-lists";
import type { PokemonSpecies } from "#data/pokemon-species";
import { AbilityId } from "#enums/ability-id";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Phase A — Task A14: dispatcher iterates 3 passive slots.
 *
 * Pure unit tests for the 3-passive dispatch model. These tests construct a
 * minimal {@linkcode Pokemon}-shaped stub (duck-typed) and exercise:
 *   1. `Pokemon.getPassiveAbilities()` slot resolution (legacy + override paths).
 *   2. `applyAbAttrs` dispatch — iterates active + each non-empty passive slot.
 *   3. Slot-vs-active dedup invariant (no double-fire when active === passive[N]).
 *   4. Empty (NONE) slots are skipped without falling back to the legacy ability.
 *
 * We deliberately avoid spinning up a full battle (no GameManager). The dispatch
 * paths under test only require: `pokemon.canApplyAbility(passive)`,
 * `pokemon.getAbility()`, `pokemon.getPassiveAbilities()`, and Set-shaped
 * `waveData.abilitiesApplied` / `summonData.abilitiesApplied` containers.
 */

/** Stub Pokemon that satisfies just the surface area `applyAbAttrs` touches. */
interface StubPokemon {
  getAbility(): Ability;
  getPassiveAbilities(): readonly [Ability | null, Ability | null, Ability | null];
  canApplyAbility(passive?: boolean): boolean;
  waveData: { abilitiesApplied: Set<AbilityId> };
  summonData: { abilitiesApplied: Set<AbilityId> };
}

/** Build a stub Pokemon with the given active + 3 passive (slot order). */
function makeStubPokemon(opts: {
  active: AbilityId;
  passives: readonly [AbilityId, AbilityId, AbilityId];
}): StubPokemon {
  return {
    getAbility: () => allAbilities[opts.active],
    getPassiveAbilities: () => [
      opts.passives[0] === AbilityId.NONE ? null : allAbilities[opts.passives[0]],
      opts.passives[1] === AbilityId.NONE ? null : allAbilities[opts.passives[1]],
      opts.passives[2] === AbilityId.NONE ? null : allAbilities[opts.passives[2]],
    ],
    canApplyAbility: () => true,
    waveData: { abilitiesApplied: new Set() },
    summonData: { abilitiesApplied: new Set() },
  };
}

describe("apply-ab-attrs — 3-passive dispatch", () => {
  beforeAll(async () => {
    // Ensure allAbilities is populated. The vitest setup runs `initializeGame()`
    // in beforeAll which populates the global ability table.
    expect(allAbilities[AbilityId.HUGE_POWER]).toBeDefined();
    expect(allAbilities[AbilityId.PURE_POWER]).toBeDefined();
  });

  /** Track species we mutate via setPassives so we can restore them in afterEach. */
  const mutatedSpecies: PokemonSpecies[] = [];

  afterEach(() => {
    // Restore any species we mutated — don't pollute downstream tests.
    for (const species of mutatedSpecies) {
      (species as unknown as { _passives: unknown })._passives = null;
    }
    mutatedSpecies.length = 0;
    vi.restoreAllMocks();
  });

  /** Convenience: install a 3-passive triple on a species and remember to clean it up. */
  const setSpeciesPassives = (
    speciesId: SpeciesId,
    passives: readonly [AbilityId, AbilityId, AbilityId],
  ): PokemonSpecies => {
    const species = allSpecies.find(s => s.speciesId === speciesId);
    expect(species).toBeDefined();
    species!.setPassives(passives);
    mutatedSpecies.push(species!);
    return species!;
  };

  describe("dispatch iteration via applyAbAttrs", () => {
    it("iterates the active ability plus each non-empty passive slot (3 distinct passives)", () => {
      const pokemon = makeStubPokemon({
        active: AbilityId.INTIMIDATE,
        passives: [AbilityId.HUGE_POWER, AbilityId.PURE_POWER, AbilityId.SPEED_BOOST],
      });

      // Spy on `getAttrs` so each `applySingleAbAttrs` call records the ability id it queried.
      const calledIds: AbilityId[] = [];
      vi.spyOn(Ability.prototype, "getAttrs").mockImplementation(function (this: Ability) {
        calledIds.push(this.id);
        return [];
      });

      applyAbAttrs("PostSummonAbAttr", { pokemon: pokemon as unknown as Pokemon, simulated: true });

      // Expect 1 active + 3 passive slots = 4 unique getAttrs invocations.
      expect(calledIds).toEqual([
        AbilityId.INTIMIDATE, // active
        AbilityId.HUGE_POWER, // passive slot 0
        AbilityId.PURE_POWER, // passive slot 1
        AbilityId.SPEED_BOOST, // passive slot 2
      ]);
    });

    it("skips empty (NONE) passive slots — no double-fire of slot 0 as fallback", () => {
      const pokemon = makeStubPokemon({
        active: AbilityId.INTIMIDATE,
        passives: [AbilityId.HUGE_POWER, AbilityId.NONE, AbilityId.NONE],
      });

      const calledIds: AbilityId[] = [];
      vi.spyOn(Ability.prototype, "getAttrs").mockImplementation(function (this: Ability) {
        calledIds.push(this.id);
        return [];
      });

      applyAbAttrs("PostSummonAbAttr", { pokemon: pokemon as unknown as Pokemon, simulated: true });

      // Only active + slot 0 fire; slots 1 and 2 (null) are silently skipped.
      // Critical: HUGE_POWER should appear exactly ONCE — no fallback resolution
      // would yield it for slots 1/2.
      expect(calledIds).toEqual([AbilityId.INTIMIDATE, AbilityId.HUGE_POWER]);
    });

    it("deduplicates when a passive slot's id equals the active ability id", () => {
      // Active = HUGE_POWER. Slot 0 also HUGE_POWER → must be skipped.
      // Slots 1 and 2 are unique and must fire.
      const pokemon = makeStubPokemon({
        active: AbilityId.HUGE_POWER,
        passives: [AbilityId.HUGE_POWER, AbilityId.PURE_POWER, AbilityId.SPEED_BOOST],
      });

      const calledIds: AbilityId[] = [];
      vi.spyOn(Ability.prototype, "getAttrs").mockImplementation(function (this: Ability) {
        calledIds.push(this.id);
        return [];
      });

      applyAbAttrs("PostSummonAbAttr", { pokemon: pokemon as unknown as Pokemon, simulated: true });

      // Active fires once, slot 0 is deduped, slots 1 and 2 fire.
      expect(calledIds).toEqual([
        AbilityId.HUGE_POWER, // active
        // slot 0 skipped — same id as active
        AbilityId.PURE_POWER, // slot 1
        AbilityId.SPEED_BOOST, // slot 2
      ]);
    });

    it("dedups passive slot 1 against active (not just slot 0)", () => {
      // Active = PURE_POWER. Slot 1 also PURE_POWER → must be skipped.
      // Slots 0 and 2 are unique and must fire.
      const pokemon = makeStubPokemon({
        active: AbilityId.PURE_POWER,
        passives: [AbilityId.HUGE_POWER, AbilityId.PURE_POWER, AbilityId.SPEED_BOOST],
      });

      const calledIds: AbilityId[] = [];
      vi.spyOn(Ability.prototype, "getAttrs").mockImplementation(function (this: Ability) {
        calledIds.push(this.id);
        return [];
      });

      applyAbAttrs("PostSummonAbAttr", { pokemon: pokemon as unknown as Pokemon, simulated: true });

      expect(calledIds).toEqual([
        AbilityId.PURE_POWER, // active
        AbilityId.HUGE_POWER, // slot 0
        // slot 1 skipped — same id as active
        AbilityId.SPEED_BOOST, // slot 2
      ]);
    });

    it("legacy single-passive shape ([legacy, null, null]) only fires slot 0", () => {
      const pokemon = makeStubPokemon({
        active: AbilityId.INTIMIDATE,
        passives: [AbilityId.PROTEAN, AbilityId.NONE, AbilityId.NONE],
      });

      const calledIds: AbilityId[] = [];
      vi.spyOn(Ability.prototype, "getAttrs").mockImplementation(function (this: Ability) {
        calledIds.push(this.id);
        return [];
      });

      applyAbAttrs("PostSummonAbAttr", { pokemon: pokemon as unknown as Pokemon, simulated: true });

      expect(calledIds).toEqual([AbilityId.INTIMIDATE, AbilityId.PROTEAN]);
    });

    it("skips dispatch entirely when canApplyAbility returns false for active", () => {
      const pokemon = makeStubPokemon({
        active: AbilityId.INTIMIDATE,
        passives: [AbilityId.HUGE_POWER, AbilityId.PURE_POWER, AbilityId.SPEED_BOOST],
      });
      // Make canApplyAbility return false for the active only.
      pokemon.canApplyAbility = (passive = false) => !!passive;

      const calledIds: AbilityId[] = [];
      vi.spyOn(Ability.prototype, "getAttrs").mockImplementation(function (this: Ability) {
        calledIds.push(this.id);
        return [];
      });

      applyAbAttrs("PostSummonAbAttr", { pokemon: pokemon as unknown as Pokemon, simulated: true });

      // Active is skipped; all 3 passives still fire.
      expect(calledIds).toEqual([AbilityId.HUGE_POWER, AbilityId.PURE_POWER, AbilityId.SPEED_BOOST]);
    });

    it("explicit passive=true + passiveSlot fires only that one slot", () => {
      const pokemon = makeStubPokemon({
        active: AbilityId.INTIMIDATE,
        passives: [AbilityId.HUGE_POWER, AbilityId.PURE_POWER, AbilityId.SPEED_BOOST],
      });

      const calledIds: AbilityId[] = [];
      vi.spyOn(Ability.prototype, "getAttrs").mockImplementation(function (this: Ability) {
        calledIds.push(this.id);
        return [];
      });

      applyAbAttrs("PostSummonAbAttr", {
        pokemon: pokemon as unknown as Pokemon,
        simulated: true,
        passive: true,
        passiveSlot: 1,
      });

      expect(calledIds).toEqual([AbilityId.PURE_POWER]);
    });

    it("explicit passive=true with no passiveSlot defaults to slot 0 (legacy behavior)", () => {
      const pokemon = makeStubPokemon({
        active: AbilityId.INTIMIDATE,
        passives: [AbilityId.HUGE_POWER, AbilityId.PURE_POWER, AbilityId.SPEED_BOOST],
      });

      const calledIds: AbilityId[] = [];
      vi.spyOn(Ability.prototype, "getAttrs").mockImplementation(function (this: Ability) {
        calledIds.push(this.id);
        return [];
      });

      applyAbAttrs("PostSummonAbAttr", {
        pokemon: pokemon as unknown as Pokemon,
        simulated: true,
        passive: true,
        // passiveSlot omitted → slot 0
      });

      expect(calledIds).toEqual([AbilityId.HUGE_POWER]);
    });

    it("explicit passive=true with empty target slot does nothing (no error)", () => {
      const pokemon = makeStubPokemon({
        active: AbilityId.INTIMIDATE,
        passives: [AbilityId.HUGE_POWER, AbilityId.NONE, AbilityId.NONE],
      });

      const calledIds: AbilityId[] = [];
      vi.spyOn(Ability.prototype, "getAttrs").mockImplementation(function (this: Ability) {
        calledIds.push(this.id);
        return [];
      });

      applyAbAttrs("PostSummonAbAttr", {
        pokemon: pokemon as unknown as Pokemon,
        simulated: true,
        passive: true,
        passiveSlot: 2, // empty
      });

      expect(calledIds).toEqual([]); // no dispatch at all
    });
  });

  describe("species → Pokemon getPassiveAbilities() chain", () => {
    it("setPassives() on a real species installs all 3 ability ids", () => {
      const species = setSpeciesPassives(SpeciesId.MAGIKARP, [
        AbilityId.OVERGROW,
        AbilityId.CHLOROPHYLL,
        AbilityId.LEAF_GUARD,
      ]);
      expect(species.getPassiveAbilities()).toEqual([AbilityId.OVERGROW, AbilityId.CHLOROPHYLL, AbilityId.LEAF_GUARD]);
    });

    it("species.getPassiveAbilities() returns [legacy, NONE, NONE] when no override set", () => {
      // Sanity: this mirrors the existing pokemon-species-passives.test.ts invariant
      // and is the foundation Pokemon.getPassiveAbilities() relies on.
      const species = allSpecies.find(s => s.speciesId === SpeciesId.MAGIKARP)!;
      const passives = species.getPassiveAbilities();
      expect(passives[0]).toBe(species.getPassiveAbility());
      expect(passives[1]).toBe(AbilityId.NONE);
      expect(passives[2]).toBe(AbilityId.NONE);
    });
  });
});
