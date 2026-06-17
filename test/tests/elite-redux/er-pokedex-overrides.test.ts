import { pokemonSpeciesLevelMoves } from "#balance/pokemon-level-moves";
import { tmSpecies } from "#balance/tm-species-map";
import { speciesTmMoves } from "#balance/tms";
import { applyErPokedexOverrides } from "#data/elite-redux/init-elite-redux-pokedex-overrides";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The editor-managed Pokedex overrides (learnsets / TM sets / ability slots).
 * Contract: ADDITIVE + FAIL-SAFE - bad ids are dropped, unmapped species are
 * skipped, and the pass can only ever no-op on error (never throws). These edit
 * shared singleton tables, so each test snapshots + restores what it touches.
 */
describe("applyErPokedexOverrides (editor Pokedex overrides)", () => {
  const ID = SpeciesId.BULBASAUR; // const → "SPECIES_BULBASAUR" → resolves to id 1
  const restores: Array<() => void> = [];

  afterEach(() => {
    while (restores.length > 0) {
      restores.pop()?.();
    }
  });

  function snapshotLearnset(): void {
    const table = pokemonSpeciesLevelMoves as Record<number, [number, number][]>;
    const prev = table[ID];
    restores.push(() => {
      table[ID] = prev;
    });
  }
  function snapshotTm(moveIds: number[]): void {
    const fwd = speciesTmMoves as Record<number, unknown>;
    const rev = tmSpecies as Record<number, unknown>;
    const prevFwd = fwd[ID];
    const prevRev = moveIds.map(m => [m, rev[m]] as const);
    restores.push(() => {
      fwd[ID] = prevFwd;
      for (const [m, v] of prevRev) {
        rev[m] = v;
      }
    });
  }
  function snapshotAbilities(): void {
    const sp = getPokemonSpecies(ID) as unknown as { ability1: number; ability2: number; abilityHidden: number };
    const { ability1, ability2, abilityHidden } = sp;
    restores.push(() => {
      sp.ability1 = ability1;
      sp.ability2 = ability2;
      sp.abilityHidden = abilityHidden;
    });
  }

  it("replaces a species' level-up learnset and drops unresolvable move ids", () => {
    snapshotLearnset();
    const res = applyErPokedexOverrides({
      learnsets: {
        SPECIES_BULBASAUR: [
          [7, MoveId.VINE_WHIP],
          [1, MoveId.TACKLE],
          [3, 9_999_999],
        ],
      },
    });
    expect(res.learnsetsApplied).toBe(1);
    expect(res.idsDropped).toBeGreaterThanOrEqual(1);
    // Kept the two valid moves, sorted by level; the bogus id is gone.
    expect((pokemonSpeciesLevelMoves as Record<number, [number, number][]>)[ID]).toEqual([
      [1, MoveId.TACKLE],
      [7, MoveId.VINE_WHIP],
    ]);
  });

  it("never clobbers a real learnset with an all-invalid override", () => {
    snapshotLearnset();
    const before = (pokemonSpeciesLevelMoves as Record<number, [number, number][]>)[ID];
    const res = applyErPokedexOverrides({ learnsets: { SPECIES_BULBASAUR: [[1, 9_999_999]] } });
    expect(res.learnsetsApplied).toBe(0);
    expect((pokemonSpeciesLevelMoves as Record<number, [number, number][]>)[ID]).toBe(before);
  });

  it("replaces a species' TM set in both the forward and reverse maps", () => {
    snapshotTm([MoveId.EMBER, MoveId.SURF]);
    const res = applyErPokedexOverrides({ tmLearnsets: { SPECIES_BULBASAUR: [MoveId.EMBER, MoveId.SURF, 9_999_999] } });
    expect(res.tmSetsApplied).toBe(1);
    expect(res.idsDropped).toBeGreaterThanOrEqual(1);
    const fwd = (speciesTmMoves as Record<number, number[]>)[ID];
    expect(fwd).toEqual(expect.arrayContaining([MoveId.EMBER, MoveId.SURF]));
    const rev = tmSpecies as Record<number, Array<number | unknown[]>>;
    const learnsEmber = rev[MoveId.EMBER].some(e => (Array.isArray(e) ? e[0] : e) === ID);
    expect(learnsEmber).toBe(true);
  });

  it("overwrites ability slots; NONE second ability mirrors the primary; hidden NONE is kept", () => {
    snapshotAbilities();
    const res = applyErPokedexOverrides({
      abilities: {
        SPECIES_BULBASAUR: { ability1: AbilityId.LEVITATE, ability2: AbilityId.NONE, hidden: AbilityId.NONE },
      },
    });
    expect(res.abilitiesApplied).toBe(1);
    const sp = getPokemonSpecies(ID);
    expect(sp.ability1).toBe(AbilityId.LEVITATE);
    expect(sp.ability2).toBe(AbilityId.LEVITATE); // NONE → mirrors ability1
    expect(sp.abilityHidden).toBe(AbilityId.NONE); // legal "no hidden ability"
  });

  it("drops an invalid ability id without changing the slot", () => {
    snapshotAbilities();
    const before = getPokemonSpecies(ID).ability1;
    const res = applyErPokedexOverrides({ abilities: { SPECIES_BULBASAUR: { ability1: 9_999_999 } } });
    expect(res.abilitiesApplied).toBe(0);
    expect(res.idsDropped).toBeGreaterThanOrEqual(1);
    expect(getPokemonSpecies(ID).ability1).toBe(before);
  });

  it("skips species consts that don't resolve to a live id", () => {
    const res = applyErPokedexOverrides({ learnsets: { SPECIES_NOT_A_REAL_MON: [[1, MoveId.TACKLE]] } });
    expect(res.learnsetsApplied).toBe(0);
    expect(res.skippedUnmapped).toBe(1);
  });

  it("is fail-safe: empty / malformed data never throws and applies nothing", () => {
    expect(() => applyErPokedexOverrides({})).not.toThrow();
    // Malformed shapes (not arrays/objects) are tolerated.
    const res = applyErPokedexOverrides({
      learnsets: { SPECIES_BULBASAUR: "nope" as unknown as [number, number][] },
      tmLearnsets: { SPECIES_BULBASAUR: 123 as unknown as number[] },
      abilities: { SPECIES_BULBASAUR: null as unknown as { ability1: number } },
    });
    expect(res.learnsetsApplied + res.tmSetsApplied + res.abilitiesApplied).toBe(0);
    expect(res.errors).toEqual([]);
  });
});
