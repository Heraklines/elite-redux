import { pokemonEvolutions, pokemonPrevolutions } from "#balance/pokemon-evolutions";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import { initEliteReduxEvolutions } from "#data/elite-redux/init-elite-redux-evolutions";
import { SpeciesId } from "#enums/species-id";
import { describe, expect, it } from "vitest";

/**
 * B6 test suite (evolutions): verifies ER's per-species level evolution
 * requirements patch onto pokerogue's `pokemonEvolutions` table.
 *
 * The patcher uses a MERGE strategy (see init-elite-redux-evolutions.ts
 * header): ER's level is authoritative for matched (source, target) edges,
 * but pokerogue's existing edge conditions/items/form-keys are preserved.
 * Edges where ER has a target pokerogue doesn't are APPENDED. Edges where
 * pokerogue has a target ER doesn't are LEFT IN PLACE.
 *
 * The test harness already runs `initEliteReduxEvolutions()` during
 * test-file initialization, so by the time these tests run, every
 * ER-mapped species' evolution entry already reflects the merged data.
 *
 * We exercise:
 *   1. Cardinality floor: meaningful number of species patched + edges
 *      applied / updated / appended.
 *   2. Idempotency: re-running produces identical counts.
 *   3. Bulbasaur evolves at ER's level — level matches the ER source draft.
 *   4. Form-change edges (kind 1/2/5 = mega/primal/move-mega) are SKIPPED.
 *   5. Prevolutions are rebuilt: Ivysaur's prevolution is Bulbasaur.
 *   6. Evolution edges have positive target species ids and valid levels.
 *   7. Tyrogue / Nincada / Tandemaus condition-laden entries SURVIVE the
 *      patch (their conditions remain attached).
 */
describe("initEliteReduxEvolutions (B6)", () => {
  it("patches a meaningful number of species' evolution tables", () => {
    const result = initEliteReduxEvolutions();
    expect(result.speciesPatched).toBeGreaterThan(300);
    expect(result.evolutionEdgesApplied).toBeGreaterThan(300);
    expect(result.errors).toHaveLength(0);
  });

  it("is idempotent — re-running produces identical patched counts", () => {
    const first = initEliteReduxEvolutions();
    const second = initEliteReduxEvolutions();
    expect(second.speciesPatched).toBe(first.speciesPatched);
    expect(second.evolutionEdgesApplied).toBe(first.evolutionEdgesApplied);
    expect(second.edgesLevelUpdated).toBe(first.edgesLevelUpdated);
    expect(second.edgesAppended).toBe(first.edgesAppended);
    expect(second.formChangeEdgesSkipped).toBe(first.formChangeEdgesSkipped);
    expect(second.speciesSkippedNoMapping).toBe(first.speciesSkippedNoMapping);
    expect(second.edgesDroppedMissingTarget).toBe(first.edgesDroppedMissingTarget);
  });

  it("skips ALL form-change edges (kinds 1/2/5 = mega/primal/move-mega)", () => {
    // Sum up all kind 1/2/5 entries in ER_SPECIES — the patcher's
    // formChangeEdgesSkipped counter MUST equal this count (no edge can be
    // both a level evo and a form change).
    let expectedFormChangeEdges = 0;
    for (const draft of ER_SPECIES) {
      for (const evo of draft.evolutions) {
        if (evo.kind === 1 || evo.kind === 2 || evo.kind === 5) {
          expectedFormChangeEdges++;
        }
      }
    }
    const result = initEliteReduxEvolutions();
    expect(result.formChangeEdgesSkipped).toBe(expectedFormChangeEdges);
    // ER ships ~287 mega + 18 primal + 1 move-mega = ~306 form-change edges.
    expect(expectedFormChangeEdges).toBeGreaterThan(280);
    expect(expectedFormChangeEdges).toBeLessThan(350);
  });

  it("Bulbasaur evolves into Ivysaur at the level specified by ER", () => {
    // ER's Bulbasaur (id 1) ships kind 0 (LEVEL) requirement "16" into
    // species index 2 (Ivysaur). The patched table must reflect that.
    const draft = ER_SPECIES.find(d => d.id === 1);
    expect(draft).toBeDefined();
    if (!draft) {
      return;
    }
    const levelEvo = draft.evolutions.find(e => e.kind === 0);
    expect(levelEvo).toBeDefined();
    if (!levelEvo) {
      return;
    }
    const expectedLevel = Number.parseInt(levelEvo.requirement, 10);
    const targetDraft = ER_SPECIES[levelEvo.into];
    const expectedTarget = ER_ID_MAP.species[targetDraft.id];

    const live = pokemonEvolutions[SpeciesId.BULBASAUR];
    expect(live).toBeDefined();
    expect(live.length).toBeGreaterThan(0);
    const liveLevelEvo = live.find(e => e.speciesId === expectedTarget);
    expect(liveLevelEvo).toBeDefined();
    if (!liveLevelEvo) {
      return;
    }
    expect(liveLevelEvo.level).toBe(expectedLevel);
  });

  it("Magikarp's evolution into Gyarados reflects ER's level", () => {
    const live = pokemonEvolutions[SpeciesId.MAGIKARP];
    expect(live).toBeDefined();
    if (!live) {
      return;
    }
    const toGyarados = live.find(e => e.speciesId === SpeciesId.GYARADOS);
    expect(toGyarados).toBeDefined();
    if (!toGyarados) {
      return;
    }
    expect(toGyarados.level).toBeGreaterThan(0);
    // Verify against ER's draft: Magikarp (id 129) → Gyarados, kind 0.
    const draft = ER_SPECIES.find(d => d.id === 129);
    expect(draft).toBeDefined();
    if (!draft) {
      return;
    }
    const gyaradosEdge = draft.evolutions.find(e => {
      if (e.kind !== 0) {
        return false;
      }
      const t = ER_SPECIES[e.into];
      return t && ER_ID_MAP.species[t.id] === SpeciesId.GYARADOS;
    });
    expect(gyaradosEdge).toBeDefined();
    if (!gyaradosEdge) {
      return;
    }
    expect(toGyarados.level).toBe(Number.parseInt(gyaradosEdge.requirement, 10));
  });

  it("every patched evolution edge has a positive target species id and level", () => {
    const samples: SpeciesId[] = [
      SpeciesId.BULBASAUR,
      SpeciesId.CHARMANDER,
      SpeciesId.SQUIRTLE,
      SpeciesId.CATERPIE,
      SpeciesId.WEEDLE,
      SpeciesId.PIDGEY,
      SpeciesId.MAGIKARP,
    ];
    for (const sid of samples) {
      const entries = pokemonEvolutions[sid];
      if (!entries) {
        continue;
      }
      for (const evo of entries) {
        expect(evo.speciesId, `species ${sid} → target`).toBeGreaterThan(0);
        expect(evo.level, `species ${sid} → level`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("prevolutions table is rebuilt — Ivysaur's prevolution is Bulbasaur", () => {
    expect(pokemonPrevolutions[SpeciesId.IVYSAUR]).toBe(SpeciesId.BULBASAUR);
    expect(pokemonPrevolutions[SpeciesId.VENUSAUR]).toBe(SpeciesId.IVYSAUR);
  });

  it("merges level updates with existing pokerogue edges (preserves condition/item/formKey)", () => {
    // Tyrogue is the canonical "condition-laden" case: pokerogue ships 3
    // edges, each with a different EvoCondKey.TYROGUE condition (knows
    // Low Sweep / Mach Punch / Rapid Spin). ER ships 3 plain kind-0 level
    // edges to the same 3 targets.
    //
    // Merge contract: the 3 Tyrogue edges should STILL HAVE their
    // conditions attached after the patch. Only their `level` field can
    // have been updated by ER.
    const tyrogueEdges = pokemonEvolutions[SpeciesId.TYROGUE];
    expect(tyrogueEdges).toBeDefined();
    if (!tyrogueEdges) {
      return;
    }
    expect(tyrogueEdges.length).toBeGreaterThanOrEqual(3);
    // At least one edge should carry a condition — proving the merge
    // strategy didn't clobber pokerogue's data.
    const conditioned = tyrogueEdges.filter(e => e.condition != null);
    expect(conditioned.length).toBeGreaterThan(0);
  });

  it("preserves Nincada's SHEDINJA-conditioned split (pokerogue-only condition)", () => {
    const nincadaEdges = pokemonEvolutions[SpeciesId.NINCADA];
    expect(nincadaEdges).toBeDefined();
    if (!nincadaEdges) {
      return;
    }
    // Nincada → Shedinja is the condition-laden branch (Shedinja
    // condition); Nincada → Ninjask is the plain branch.
    const conditioned = nincadaEdges.filter(e => e.condition != null);
    expect(conditioned.length).toBeGreaterThan(0);
  });

  it("preserves Tandemaus's RANDOM_FORM condition + form-key fields", () => {
    const tandemausEdges = pokemonEvolutions[SpeciesId.TANDEMAUS];
    expect(tandemausEdges).toBeDefined();
    if (!tandemausEdges) {
      return;
    }
    // Pokerogue ships Tandemaus with two SpeciesFormEvolution edges that
    // carry evoFormKey ("three" / "four"). The merge must preserve those.
    const withFormKey = tandemausEdges.filter(e => e.evoFormKey != null);
    expect(withFormKey.length).toBeGreaterThan(0);
  });

  it("no pokerogue evolution entry contains an edge pointing to species 0", () => {
    for (const [key, entries] of Object.entries(pokemonEvolutions)) {
      const sid = Number.parseInt(key, 10);
      if (!Number.isFinite(sid)) {
        continue;
      }
      for (const evo of entries) {
        expect(evo.speciesId, `${sid} → 0 should not happen`).not.toBe(0);
      }
    }
  });

  it("edgesLevelUpdated + edgesAppended sums to evolutionEdgesApplied", () => {
    // Bookkeeping invariant: every edge is either an update (matched a
    // pokerogue target) or an append (new target). Drops are tracked
    // separately and don't count toward the applied total.
    const result = initEliteReduxEvolutions();
    expect(result.edgesLevelUpdated + result.edgesAppended).toBe(result.evolutionEdgesApplied);
  });
});
