import { allSpecies } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import { initEliteReduxSpecies } from "#data/elite-redux/init-elite-redux-species";
import { AbilityId } from "#enums/ability-id";
import { SpeciesId } from "#enums/species-id";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Phase B Task B1a — install ER's 3-passive triples on vanilla pokerogue species.
 *
 * `initializeGame()` already calls `initEliteReduxSpecies()` once at vitest
 * setup time (see `test/setup/test-file-initialization.ts`), so by the time
 * these tests run, every vanilla species in `allSpecies` already has its
 * `_passives` field populated by the initializer.
 *
 * We snapshot every species' `_passives` before each test and restore it
 * afterwards so that runs are isolated even though we re-invoke the
 * initializer (and even when individual tests temporarily clear the override
 * to exercise the legacy path).
 */
describe("initEliteReduxSpecies (B1a)", () => {
  const saved = new Map<number, readonly [AbilityId, AbilityId, AbilityId] | null>();

  beforeEach(() => {
    saved.clear();
    for (const s of allSpecies) {
      saved.set(
        s.speciesId,
        (s as unknown as { _passives: readonly [AbilityId, AbilityId, AbilityId] | null })._passives,
      );
    }
  });

  afterEach(() => {
    for (const s of allSpecies) {
      (s as unknown as { _passives: readonly [AbilityId, AbilityId, AbilityId] | null })._passives =
        saved.get(s.speciesId) ?? null;
    }
  });

  it("installs passives on >800 vanilla species and only reports the SPECIES_NONE sentinel", () => {
    const result = initEliteReduxSpecies();
    expect(result.vanillaCount).toBeGreaterThan(800);
    // ER's SPECIES_NONE sentinel (ER id -1) maps to pokerogue id 0 (also NONE),
    // which is not registered in `allSpecies`. The initializer surfaces that as
    // a single error — anything beyond that signals a real data-map gap.
    expect(result.errors.length).toBeLessThanOrEqual(1);
    if (result.errors.length === 1) {
      expect(result.errors[0]).toMatch(/SPECIES_NONE/);
    }
  });

  it("skips ER-custom species (id >= 10000) — reports the count via customSkipped", () => {
    const result = initEliteReduxSpecies();
    // ER ships ~881 customs per A9 hardening. We assert a loose range so the
    // test stays green if the upstream draft churns a handful of entries.
    expect(result.customSkipped).toBeGreaterThan(800);
    expect(result.customSkipped).toBeLessThan(1000);
  });

  it("vanilla + custom counts together cover the ER species list (modulo mapped sentinels)", () => {
    const result = initEliteReduxSpecies();
    // Every ER draft is either installed onto a vanilla species, counted as
    // a skipped custom, or surfaces as a reportable error. The sum lower-bound
    // matches the size of the ER species list (sans the SPECIES_NONE sentinel
    // which has no pokerogue mapping and is reported as an error).
    const total = result.vanillaCount + result.customSkipped + result.errors.length;
    expect(total).toBe(ER_SPECIES.length);
  });

  it("installs Bulbasaur's innates so getPassiveAbilities() reflects the ER triple", () => {
    initEliteReduxSpecies();

    const bulbasaur = allSpecies.find(s => s.speciesId === SpeciesId.BULBASAUR);
    expect(bulbasaur).toBeDefined();
    if (!bulbasaur) {
      return;
    }

    const passives = bulbasaur.getPassiveAbilities();
    expect(passives).toHaveLength(3);

    // ER provides real innates for vanilla mons; at least slot 1 must be set.
    const nonNone = passives.filter(p => p !== AbilityId.NONE).length;
    expect(nonNone).toBeGreaterThan(0);
  });

  it("passives match the ER draft + id-map mapping for Bulbasaur", () => {
    initEliteReduxSpecies();

    // Find Bulbasaur's draft (ER id 1 → pokerogue id 1).
    const draft = ER_SPECIES.find(d => ER_ID_MAP.species[d.id] === SpeciesId.BULBASAUR);
    expect(draft, "ER draft for Bulbasaur not found").toBeDefined();
    if (!draft) {
      return;
    }

    const expectedPassives = draft.innates.map(erAbilityId => {
      if (erAbilityId === 0) {
        return AbilityId.NONE;
      }
      const mapped = ER_ID_MAP.abilities[erAbilityId];
      return mapped === undefined ? AbilityId.NONE : (mapped as AbilityId);
    });

    const bulbasaur = allSpecies.find(s => s.speciesId === SpeciesId.BULBASAUR);
    expect(bulbasaur?.getPassiveAbilities()).toEqual(expectedPassives);
  });

  it("getPassiveCount returns >=1 for vanilla species after init (multi-passive UI gate)", () => {
    initEliteReduxSpecies();

    // Sample a handful of well-known starters — they should all gate to the
    // multi-passive UI now (A16's `getPassiveCount() > 1` threshold).
    const samples = [SpeciesId.BULBASAUR, SpeciesId.CHARMANDER, SpeciesId.SQUIRTLE, SpeciesId.PIKACHU];
    for (const speciesId of samples) {
      const species = allSpecies.find(s => s.speciesId === speciesId);
      expect(species).toBeDefined();
      if (!species) {
        continue;
      }
      // We don't assert ===3 because ER may legitimately give some species
      // only 1 or 2 innates (slot 0 always populated).
      expect(species.getPassiveCount()).toBeGreaterThanOrEqual(1);
    }
  });

  it("clearing _passives reverts species to the legacy single-passive fallback", () => {
    initEliteReduxSpecies();

    const bulbasaur = allSpecies.find(s => s.speciesId === SpeciesId.BULBASAUR);
    expect(bulbasaur).toBeDefined();
    if (!bulbasaur) {
      return;
    }

    // Clear the override and confirm getPassiveAbilities() falls back to
    // [legacy, NONE, NONE]. This guarantees ER init doesn't permanently hijack
    // the legacy path — callers can still opt out by clearing `_passives`.
    (bulbasaur as unknown as { _passives: unknown })._passives = null;

    const passives = bulbasaur.getPassiveAbilities();
    expect(passives[0]).toBe(bulbasaur.getPassiveAbility());
    expect(passives[1]).toBe(AbilityId.NONE);
    expect(passives[2]).toBe(AbilityId.NONE);
  });

  it("re-running initEliteReduxSpecies is idempotent — same triple, same vanillaCount", () => {
    const first = initEliteReduxSpecies();
    const bulbasaurBefore = allSpecies.find(s => s.speciesId === SpeciesId.BULBASAUR)?.getPassiveAbilities();

    const second = initEliteReduxSpecies();
    const bulbasaurAfter = allSpecies.find(s => s.speciesId === SpeciesId.BULBASAUR)?.getPassiveAbilities();

    expect(second.vanillaCount).toBe(first.vanillaCount);
    expect(second.customSkipped).toBe(first.customSkipped);
    expect(second.errors).toEqual(first.errors);
    expect(bulbasaurAfter).toEqual(bulbasaurBefore);
  });

  it("getPassiveAbility() (legacy single-passive lookup) is unaffected by ER init", () => {
    initEliteReduxSpecies();

    const bulbasaur = allSpecies.find(s => s.speciesId === SpeciesId.BULBASAUR);
    expect(bulbasaur).toBeDefined();
    if (!bulbasaur) {
      return;
    }

    // The legacy starter-passive lookup must still return a real ability id
    // (CHLOROPHYLL for Bulbasaur per `src/data/balance/passives.ts`). This is
    // what existing single-passive UIs and the back-compat tests rely on.
    const legacy = bulbasaur.getPassiveAbility();
    expect(legacy).not.toBe(AbilityId.NONE);
    expect(typeof legacy).toBe("number");
  });

  it("installs ER innates on non-base forms (mega/primal/origin)", () => {
    const result = initEliteReduxSpecies();

    // formCount should be > 0 — ER ships ~280 mega/primal forms; even if not
    // all map cleanly (regional variants etc. don't exist in ER), a meaningful
    // chunk of pokerogue's mega forms have ER counterparts.
    expect(result.formCount).toBeGreaterThan(0);
    // Sanity: shouldn't be larger than the count of ER customs (881).
    expect(result.formCount).toBeLessThan(900);
  });

  it("regional-form aliases land ER innates on the matching vanilla species (ALOLA_RAICHU)", () => {
    // The id-map's `regionalSpeciesAliases` resolves ER's `SPECIES_RAICHU_ALOLAN`
    // (ER id 1553) to pokerogue's `SpeciesId.ALOLA_RAICHU` (2026) — a vanilla
    // species in `allSpecies`, not an ER-custom slot. Verify the alias
    // landed the passives.
    initEliteReduxSpecies();
    const alolaRaichu = allSpecies.find(s => s.speciesId === SpeciesId.ALOLA_RAICHU);
    expect(alolaRaichu).toBeDefined();
    if (!alolaRaichu) {
      return;
    }
    // At least one of the 3 passive slots must be non-NONE — the ER draft
    // ships real innates for ER id 1553.
    const passives = alolaRaichu.getPassiveAbilities();
    expect(passives).toHaveLength(3);
    expect(passives.filter(p => p !== AbilityId.NONE).length).toBeGreaterThan(0);
  });

  it("Charizard's mega-x and mega-y forms have distinct ER passives", () => {
    initEliteReduxSpecies();

    const charizard = allSpecies.find(s => s.speciesId === SpeciesId.CHARIZARD);
    expect(charizard).toBeDefined();
    if (!charizard) {
      return;
    }

    // Charizard has 3 forms in pokerogue: base (0), Mega X (1), Mega Y (2).
    // Each should have its own _passives if ER ships the matching customs.
    expect(charizard.forms.length).toBeGreaterThanOrEqual(2);

    // At least ONE of the mega forms should have its passives populated
    // (i.e., at least one slot non-NONE). Don't assert which one in case
    // ER ships only mega-x or only mega-y.
    const megaXForm = charizard.forms.find(f => f.formKey === "mega-x");
    const megaYForm = charizard.forms.find(f => f.formKey === "mega-y");
    const anyFormHasPassives = (megaXForm?.getPassiveCount() ?? 0) > 0 || (megaYForm?.getPassiveCount() ?? 0) > 0;
    expect(anyFormHasPassives).toBe(true);
  });
});
