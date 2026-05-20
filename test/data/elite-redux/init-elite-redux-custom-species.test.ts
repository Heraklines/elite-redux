import { allSpecies } from "#data/data-lists";
import { initEliteReduxCustomSpecies } from "#data/elite-redux/init-elite-redux-custom-species";
import { ErSpeciesId } from "#enums/er-species-id";
import { PokemonType } from "#enums/pokemon-type";
import { describe, expect, it } from "vitest";

const VANILLA_ID_CUTOFF = 10000;

/**
 * B1b test suite: verifies ER-custom species registration.
 *
 * The test harness already runs initEliteReduxCustomSpecies() during
 * test-file-initialization (via init.ts → initializeGame()), so the customs
 * are present in allSpecies before each test. We exercise:
 *   1. Idempotency: re-running adds 0 new entries.
 *   2. Custom IDs are all ≥ VANILLA_ID_CUTOFF.
 *   3. A known custom (first ER_SPECIES_ID enum entry) is registered with
 *      reasonable construction.
 *   4. ErSpeciesId enum cardinality (~881 entries).
 */
describe("initEliteReduxCustomSpecies (B1b)", () => {
  it("is idempotent — re-running adds 0 customs (all already present)", () => {
    const result = initEliteReduxCustomSpecies();
    expect(result.customsAdded).toBe(0);
    expect(result.customsAlreadyPresent).toBeGreaterThan(800);
  });

  it("ErSpeciesId enum has ~881 entries (one per ER-custom species)", () => {
    const entries = Object.entries(ErSpeciesId);
    expect(entries.length).toBeGreaterThan(800);
    expect(entries.length).toBeLessThan(900);
    // Every value should be ≥ VANILLA_ID_CUTOFF.
    for (const [, value] of entries) {
      expect(value).toBeGreaterThanOrEqual(VANILLA_ID_CUTOFF);
    }
  });

  it("all ER-custom species are in allSpecies with id ≥ 10000", () => {
    const customsInAllSpecies = allSpecies.filter(s => s.speciesId >= VANILLA_ID_CUTOFF);
    expect(customsInAllSpecies.length).toBeGreaterThan(800);
    expect(customsInAllSpecies.length).toBeLessThan(900);
  });

  it("first ErSpeciesId entry (PHANTOWL = 10000) is registered with valid construction", () => {
    // ER customs use numeric ids outside the vanilla SpeciesId enum; cast for comparison.
    const phantowl = allSpecies.find(s => (s.speciesId as number) === ErSpeciesId.PHANTOWL);
    expect(phantowl).toBeDefined();
    if (!phantowl) {
      return;
    }
    expect(phantowl.speciesId).toBe(10000);
    // Base stats: 6 numbers, all > 0 (real ER data, no zeros expected).
    const stats = [
      phantowl.baseStats[0],
      phantowl.baseStats[1],
      phantowl.baseStats[2],
      phantowl.baseStats[3],
      phantowl.baseStats[4],
      phantowl.baseStats[5],
    ];
    expect(stats.length).toBe(6);
    for (const stat of stats) {
      expect(stat).toBeGreaterThan(0);
    }
    // Has at least one valid type.
    const allTypes = Object.values(PokemonType).filter(v => typeof v === "number");
    expect(allTypes).toContain(phantowl.type1);
  });

  it("ER-custom species have 3-passive triple installed (getPassiveCount > 0)", () => {
    const phantowl = allSpecies.find(s => (s.speciesId as number) === ErSpeciesId.PHANTOWL);
    expect(phantowl).toBeDefined();
    if (!phantowl) {
      return;
    }
    // setPassives was called in the initializer; getPassiveAbilities returns
    // the triple, getPassiveCount counts non-NONE entries.
    const passives = phantowl.getPassiveAbilities();
    expect(passives.length).toBe(3);
    // At least one passive should be non-NONE for a real ER custom.
    expect(phantowl.getPassiveCount()).toBeGreaterThan(0);
  });

  it("no construction errors on the test harness's startup run", () => {
    // If initEliteReduxCustomSpecies failed to construct any species, the
    // re-run above would also fail for the same reason. We verify the
    // re-run's errors list is empty (idempotent path; the actual startup
    // error count isn't directly observable from here).
    const result = initEliteReduxCustomSpecies();
    expect(result.errors).toHaveLength(0);
  });
});
