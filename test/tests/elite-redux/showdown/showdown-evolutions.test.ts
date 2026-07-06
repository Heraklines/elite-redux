import {
  isMegaFormKey,
  isMegaStage,
  listEvolutionStages,
  listMegaStages,
} from "#app/data/elite-redux/showdown/showdown-evolutions";
import { SpeciesId } from "#enums/species-id";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { describe, expect, it } from "vitest";

describe("isMegaFormKey", () => {
  it.each([
    "mega",
    "mega-x",
    "mega-y",
    "primal",
    "origin",
    "hisui-mega",
    "galar-mega",
    "alola-mega",
  ])("treats %s as a mega form key", key => {
    expect(isMegaFormKey(key)).toBe(true);
  });

  it.each(["", "alola", "galar", "hisui", "gigantamax", "eternamax"])("treats %s as NOT a mega form key", key => {
    expect(isMegaFormKey(key)).toBe(false);
  });
});

describe("listEvolutionStages", () => {
  it("returns the linear Charmander line root-first", () => {
    expect(listEvolutionStages(SpeciesId.CHARMANDER)).toEqual([
      SpeciesId.CHARMANDER,
      SpeciesId.CHARMELEON,
      SpeciesId.CHARIZARD,
    ]);
  });

  it("includes the root itself for a species with no forward evolution", () => {
    expect(listEvolutionStages(SpeciesId.CHARIZARD)).toEqual([SpeciesId.CHARIZARD]);
  });

  it("returns every branch of a branching line (Eevee)", () => {
    const stages = listEvolutionStages(SpeciesId.EEVEE);
    expect(stages[0]).toBe(SpeciesId.EEVEE);
    // All eight eeveelutions are reachable branches from the shared root.
    for (const evo of [
      SpeciesId.VAPOREON,
      SpeciesId.JOLTEON,
      SpeciesId.FLAREON,
      SpeciesId.ESPEON,
      SpeciesId.UMBREON,
      SpeciesId.LEAFEON,
      SpeciesId.GLACEON,
      SpeciesId.SYLVEON,
    ]) {
      expect(stages).toContain(evo);
    }
  });

  it("dedups a stage reachable by more than one path", () => {
    const stages = listEvolutionStages(SpeciesId.EEVEE);
    expect(new Set(stages).size).toBe(stages.length);
  });
});

describe("listMegaStages", () => {
  it("finds the Charizard line's megas on the final stage only", () => {
    const stages = listMegaStages(SpeciesId.CHARMANDER);
    // Every mega stage in the line sits on Charizard (the only stage carrying mega forms).
    expect(stages.length).toBeGreaterThanOrEqual(2); // Mega X + Mega Y at minimum
    for (const stage of stages) {
      expect(stage.speciesId).toBe(SpeciesId.CHARIZARD);
      expect(isMegaStage(stage.speciesId, stage.formIndex)).toBe(true);
    }
  });

  it("returns no mega stages for a line that has none", () => {
    expect(listMegaStages(SpeciesId.RATTATA)).toEqual([]);
  });

  it("each returned stage's formIndex points at a real mega form on the species", () => {
    for (const stage of listMegaStages(SpeciesId.CHARMANDER)) {
      const form = getPokemonSpecies(stage.speciesId as SpeciesId).forms[stage.formIndex];
      expect(isMegaFormKey(form.formKey)).toBe(true);
      expect(form.formName).toBe(stage.formName);
    }
  });
});

describe("isMegaStage", () => {
  it("is false for a base (non-mega) form", () => {
    expect(isMegaStage(SpeciesId.CHARIZARD, 0)).toBe(false);
  });

  it("is true for a Charizard mega form index", () => {
    const megaIndex = getPokemonSpecies(SpeciesId.CHARIZARD).forms.findIndex(f => isMegaFormKey(f.formKey));
    expect(megaIndex).toBeGreaterThanOrEqual(0);
    expect(isMegaStage(SpeciesId.CHARIZARD, megaIndex)).toBe(true);
  });

  it("is false for an out-of-range form index", () => {
    expect(isMegaStage(SpeciesId.CHARIZARD, 999)).toBe(false);
  });

  it("is false for a species with no forms at index 0", () => {
    expect(isMegaStage(SpeciesId.RATTATA, 0)).toBe(false);
  });
});
