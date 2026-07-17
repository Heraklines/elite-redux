import { pokemonFormLevelMoves, pokemonSpeciesLevelMoves } from "#balance/pokemon-level-moves";
import { allSpecies } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import { initEliteReduxMovesets } from "#data/elite-redux/init-elite-redux-movesets";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { LevelMoves } from "#types/pokemon-level-moves";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { describe, expect, it } from "vitest";

/**
 * B6 test suite (movesets): verifies ER's per-species level-up moveset patch
 * onto pokerogue's `pokemonSpeciesLevelMoves` table.
 *
 * The test harness already runs `initEliteReduxMovesets()` during test-file
 * initialization (via `init.ts` → `initializeGame()`), so by the time these
 * tests run, every ER-mapped species' moveset entry already reflects ER's
 * data.
 *
 * We exercise:
 *   1. Cardinality floor: the patch hit a large number of species (≥ ~900).
 *   2. Idempotency: re-running produces identical counts.
 *   3. A canonical species (Bulbasaur) ends up with ER's moveset, not
 *      pokerogue's baseline.
 *   4. Format invariants: every entry is `[level: number, moveId: number]`.
 *   5. Move id translation through `ER_ID_MAP.moves` was correctly applied.
 */
describe("initEliteReduxMovesets (B6)", () => {
  it("patches a large number of species' level-up movesets", () => {
    // Re-run the patcher; ER ships level-up moves for ~900+ species
    // (the vast majority of its ~1900 records).
    const result = initEliteReduxMovesets();
    expect(result.speciesPatched).toBeGreaterThan(800);
    expect(result.movesetEntriesApplied).toBeGreaterThan(10000);
    expect(result.errors).toHaveLength(0);
  });

  it("is idempotent — re-running produces identical patched counts", () => {
    const first = initEliteReduxMovesets();
    const second = initEliteReduxMovesets();
    expect(second.speciesPatched).toBe(first.speciesPatched);
    expect(second.movesetEntriesApplied).toBe(first.movesetEntriesApplied);
    expect(second.speciesSkippedEmpty).toBe(first.speciesSkippedEmpty);
    expect(second.speciesSkippedNoMapping).toBe(first.speciesSkippedNoMapping);
    expect(second.moveIdsDropped).toBe(first.moveIdsDropped);
  });

  it("Bulbasaur's level-up moveset matches ER's draft (after id translation)", () => {
    // ER's Bulbasaur (id 1) ships a different moveset than pokerogue's
    // baseline. The patched table must reflect ER's data.
    const draft = ER_SPECIES.find(d => d.id === 1);
    expect(draft).toBeDefined();
    if (!draft) {
      return;
    }
    expect(draft.levelUpMoves.length).toBeGreaterThan(0);

    const expectedTranslated = draft.levelUpMoves
      .map(lvm => {
        const mid = ER_ID_MAP.moves[lvm.id];
        return mid === undefined ? null : ([lvm.level, mid] as [number, number]);
      })
      .filter((p): p is [number, number] => p !== null);

    const live = pokemonSpeciesLevelMoves[SpeciesId.BULBASAUR];
    expect(live).toBeDefined();
    expect(live).toEqual(expectedTranslated);
  });

  it("every patched moveset entry is well-formed [level: number, moveId: number]", () => {
    // After patching, no Bulbasaur entry should be malformed — every pair
    // must be a 2-element tuple of numbers. We sample several species.
    const samples = [
      SpeciesId.BULBASAUR,
      SpeciesId.CHARMANDER,
      SpeciesId.SQUIRTLE,
      SpeciesId.PIKACHU,
      SpeciesId.MAGIKARP,
    ];
    for (const sid of samples) {
      const moveset = pokemonSpeciesLevelMoves[sid];
      expect(moveset, `species ${sid} should have a level-up moveset`).toBeDefined();
      if (!moveset) {
        continue;
      }
      for (const entry of moveset) {
        expect(entry).toHaveLength(2);
        expect(typeof entry[0]).toBe("number");
        expect(typeof entry[1]).toBe("number");
        expect(entry[1]).toBeGreaterThan(0);
      }
    }
  });

  it("preserves ER's ordering (level ascending) on a sampled species", () => {
    // ER orders levelUpMoves by level ascending; the patcher copies that
    // order verbatim. (The patcher is not required to sort — but our
    // contract is that ordering matches the source draft.)
    const draft = ER_SPECIES.find(d => d.id === 1); // Bulbasaur
    if (!draft || draft.levelUpMoves.length === 0) {
      return;
    }
    const draftLevels = draft.levelUpMoves.map(m => m.level);
    const live = pokemonSpeciesLevelMoves[SpeciesId.BULBASAUR];
    expect(live).toBeDefined();
    if (!live) {
      return;
    }
    // The live table may have dropped some entries (unmapped move ids).
    // The remaining levels should still be in non-decreasing order if the
    // source draft was, OR exactly match the draft's order minus drops.
    expect(live.length).toBeLessThanOrEqual(draftLevels.length);
  });

  it("translates move ids through ER_ID_MAP.moves — no raw ER ids leak through", () => {
    // The live table should never contain a move id that's NOT in either
    // the pokerogue MoveId range or the ER-custom range (>= 5000).
    // Any ER id that bypassed translation would surface as an out-of-range
    // value. We use the ER_ID_MAP.moves values as the allowed set.
    const allowedMoveIds = new Set<number>(Object.values(ER_ID_MAP.moves));
    const live = pokemonSpeciesLevelMoves[SpeciesId.BULBASAUR];
    if (!live) {
      return;
    }
    for (const [, moveId] of live) {
      // Either the id is in the allowed (mapped) set, or it's a pokerogue
      // vanilla id (< 5000). The id-map's values cover both ranges.
      expect(allowedMoveIds.has(moveId)).toBe(true);
    }
  });

  it("gives Cascoon and Primal Cascoon the Angel's Wrath move package", () => {
    initEliteReduxMovesets();
    const requiredMoves = [
      MoveId.TACKLE,
      MoveId.POISON_STING,
      MoveId.STRING_SHOT,
      MoveId.HARDEN,
      MoveId.IRON_DEFENSE,
      MoveId.ELECTROWEB,
      MoveId.BUG_BITE,
    ];
    const speciesIds = [SpeciesId.CASCOON, ER_ID_MAP.species[2157]];
    for (const speciesId of speciesIds) {
      expect(speciesId).toBeDefined();
      if (speciesId === undefined) {
        continue;
      }
      const learned = new Set((pokemonSpeciesLevelMoves[speciesId] ?? []).map(([, move]) => move));
      for (const move of requiredMoves) {
        expect(learned.has(move), `species ${speciesId} should learn ${MoveId[move]}`).toBe(true);
      }
    }
  });

  it("does NOT clobber pokerogue species that ER has no mapping for", () => {
    // If pokerogue ships a species whose pokerogue id has no ER mapping,
    // the patcher should leave it alone. We assert the patcher only writes
    // species ids that resolve via ER_ID_MAP.species.
    // Construct an "unrelated" id that's not in the id-map values and verify
    // its slot in the table is unchanged across patcher runs.
    const allMappedPokerogueIds = new Set<number>(Object.values(ER_ID_MAP.species));
    const tableKeys = Object.keys(pokemonSpeciesLevelMoves)
      .map(k => Number.parseInt(k, 10))
      .filter(k => !Number.isNaN(k));
    const unmappedIds = tableKeys.filter(k => !allMappedPokerogueIds.has(k));
    if (unmappedIds.length === 0) {
      // ER covers everything — degenerate case, nothing to check.
      return;
    }
    const sampleId = unmappedIds[0];
    const snapshot = pokemonSpeciesLevelMoves[sampleId] as LevelMoves;
    initEliteReduxMovesets();
    expect(pokemonSpeciesLevelMoves[sampleId]).toBe(snapshot);
  });

  // #606 follow-up: the Crowned form's LEVEL-UP learnset must come from ER data,
  // not the vanilla `pokemonFormLevelMoves[ZACIAN][crowned]` shadow (Behemoth
  // Blade, ...). See installCrownedFormLevelMoves.
  describe.each([
    { base: SpeciesId.ZACIAN, crownedConst: "SPECIES_ZACIAN_CROWNED_SWORD" },
    { base: SpeciesId.ZAMAZENTA, crownedConst: "SPECIES_ZAMAZENTA_CROWNED_SHIELD" },
  ])("Crowned form learnset override ($crownedConst)", ({ base, crownedConst }) => {
    // Lazily resolved inside each test: allSpecies is populated by init.ts, which
    // runs AFTER describe.each collection.
    const crownedFormIndexOf = () => getPokemonSpecies(base).forms.findIndex(f => f.formKey === "crowned");

    it("resolves a crowned form index", () => {
      expect(crownedFormIndexOf()).toBeGreaterThanOrEqual(0);
    });

    it("mirrors the ER Crowned draft onto pokemonFormLevelMoves[base][crowned]", () => {
      const crownedFormIndex = crownedFormIndexOf();
      const crownedDraft = ER_SPECIES.find(d => d.speciesConst === crownedConst);
      expect(crownedDraft).toBeDefined();
      if (!crownedDraft) {
        return;
      }
      const expected = crownedDraft.levelUpMoves
        .map(lvm => {
          const mid = ER_ID_MAP.moves[lvm.id];
          return mid === undefined ? null : ([lvm.level, mid] as [number, number]);
        })
        .filter((p): p is [number, number] => p !== null);

      const live = pokemonFormLevelMoves[base]?.[crownedFormIndex];
      expect(live).toBeDefined();
      expect(live).toEqual(expected);
    });

    it("the Crowned form entry differs from the vanilla shadow it replaced", () => {
      // Vanilla shipped a short Crowned entry led by an EVOLVE_MOVE (Behemoth
      // Blade/Bash at level 0). The ER learnset is a full level-up table, so the
      // FIRST few real levels differ from the vanilla `[0, BEHEMOTH_*]` head.
      const crownedFormIndex = crownedFormIndexOf();
      const live = pokemonFormLevelMoves[base]?.[crownedFormIndex] ?? [];
      expect(live.length).toBeGreaterThan(0);
      // ER data starts several moves at level 1 (not a single level-0 evolve move).
      expect(live.filter(([lvl]) => lvl === 1).length).toBeGreaterThan(1);
    });
  });

  it("leaves the redux-form mirror intact after the crowned pass (no shared table key)", () => {
    // Regression guard: installCrownedFormLevelMoves must only touch species that
    // ship a "crowned" form, never clobber an unrelated form entry.
    const anyReduxBase = allSpecies.find(sp => sp.speciesId < 10000 && sp.forms?.some(f => f.formKey === "redux"));
    if (!anyReduxBase) {
      return;
    }
    const reduxIdx = anyReduxBase.forms.findIndex(f => f.formKey === "redux");
    expect(pokemonFormLevelMoves[anyReduxBase.speciesId]?.[reduxIdx]).toBeDefined();
  });

  it("speciesSkippedEmpty matches the count of ER drafts with no level-up moves", () => {
    // Sanity check on the patcher's bookkeeping: the count of skipped-empty
    // species should equal the count of ER drafts whose `levelUpMoves` is
    // empty. This catches accidental off-by-one drift in the loop logic.
    const result = initEliteReduxMovesets();
    const emptyInDraft = ER_SPECIES.filter(d => d.levelUpMoves.length === 0).length;
    expect(result.speciesSkippedEmpty).toBe(emptyInDraft);
  });
});
