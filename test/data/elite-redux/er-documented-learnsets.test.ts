import { speciesEggMoves } from "#balance/moves/egg-moves";
import { pokemonFormLevelMoves, pokemonSpeciesLevelMoves } from "#balance/pokemon-level-moves";
import { tmSpecies } from "#balance/tm-species-map";
import { speciesTmMoves } from "#balance/tms";
import { allMoves } from "#data/data-lists";
import { applyDocumentedLearnsets, DOCUMENTED_LEARNSETS } from "#data/elite-redux/er-documented-learnsets";
import { ErMoveId } from "#enums/er-move-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { describe, expect, it, vi } from "vitest";

describe("documented newcomer learnsets", () => {
  it.each(DOCUMENTED_LEARNSETS)("wires every documented move for $name", rule => {
    for (const id of rule.species) {
      const species = getPokemonSpecies(id);
      const form = rule.formKey ? species.forms.find(f => f.formKey === rule.formKey)! : species;
      const actual = form.getLevelMoves();
      for (const entry of rule.levels) {
        expect(allMoves[entry[1]], String(entry)).toBeDefined();
        expect(actual).toContainEqual(entry);
      }
      if (!rule.mergeLevels) {
        expect(actual).toEqual(rule.levels);
      }
      if (rule.eggs) {
        expect(speciesEggMoves[id]).toEqual(rule.eggs);
        expect(rule.eggs).toHaveLength(4);
      }
      if (rule.tmSources) {
        const tms = (speciesTmMoves[id] ?? []).map(entry => (Array.isArray(entry) ? entry[1] : entry));
        const donors = rule.tmSources.length ? rule.tmSources : [id];
        const expected = new Set(
          donors
            .flatMap(donor => speciesTmMoves[donor] ?? [])
            .filter(entry => !Array.isArray(entry) || entry[0] === "")
            .map(entry => (Array.isArray(entry) ? entry[1] : entry))
            .filter(move => rule.tmKeep?.includes(move) || !rule.tmExcludeTypes?.includes(allMoves[move].type)),
        );
        for (const move of rule.tmAdd ?? []) expected.add(move);
        expect(new Set(tms)).toEqual(expected);
        for (const move of tms) expect(tmSpecies[move]).toContain(id);
        for (const [move, entries] of Object.entries(tmSpecies)) {
          if (entries.some(entry => (Array.isArray(entry) ? entry[0] : entry) === id)) {
            expect(tms).toContain(Number(move));
          }
        }
      }
    }
  });

  it("replaces inherited placeholder moves rather than adding everything to TMs", () => {
    expect(pokemonSpeciesLevelMoves[70036]).not.toContainEqual([1, MoveId.SAND_ATTACK]);
    expect(pokemonSpeciesLevelMoves[70050]).toContainEqual([46, MoveId.HAMMER_DRILL]);
    expect(pokemonSpeciesLevelMoves[70037]).toContainEqual([56, MoveId.JUDGMENT]);
    expect(pokemonSpeciesLevelMoves[70051]).toContainEqual([56, ErMoveId.BIG_BLAST]);
    expect(speciesTmMoves[70050]).not.toContain(MoveId.HAMMER_DRILL);
  });

  it("restricts Decidueye's Ghost moves on partner Rowlet, retaining Spirit Shackle", () => {
    const partner = getPokemonSpecies(SpeciesId.ROWLET).forms.find(form => form.formKey === "partner")!;
    expect(
      partner
        .getLevelMoves()
        .filter(([, move]) => allMoves[move].type === PokemonType.GHOST)
        .map(([, move]) => move),
    ).toEqual([MoveId.SPIRIT_SHACKLE]);
    expect(partner.getLevelMoves()).not.toEqual(pokemonSpeciesLevelMoves[SpeciesId.ROWLET]);
  });

  it("is idempotent and never mutates base forms or donor learnsets", () => {
    const donorIds = [SpeciesId.ROWLET, SpeciesId.ONIX, SpeciesId.GIMMIGHOUL, SpeciesId.DECIDUEYE, SpeciesId.EMPOLEON];
    const before = donorIds.map(id =>
      JSON.stringify([pokemonSpeciesLevelMoves[id], speciesTmMoves[id], speciesEggMoves[id]]),
    );
    const target = JSON.stringify([
      pokemonSpeciesLevelMoves[70036],
      speciesTmMoves[70036],
      pokemonFormLevelMoves[SpeciesId.ROWLET],
    ]);
    applyDocumentedLearnsets();
    expect(
      donorIds.map(id => JSON.stringify([pokemonSpeciesLevelMoves[id], speciesTmMoves[id], speciesEggMoves[id]])),
    ).toEqual(before);
    expect(
      JSON.stringify([pokemonSpeciesLevelMoves[70036], speciesTmMoves[70036], pokemonFormLevelMoves[SpeciesId.ROWLET]]),
    ).toBe(target);
  });

  it("does nothing when the new-content gate is disabled", () => {
    const before = JSON.stringify(pokemonSpeciesLevelMoves);
    vi.stubEnv("VITE_ENABLE_NEW_POKEMON", "off");
    try {
      applyDocumentedLearnsets();
      expect(JSON.stringify(pokemonSpeciesLevelMoves)).toBe(before);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
