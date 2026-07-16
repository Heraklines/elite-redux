/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Editor-created custom mons (er-custom-mons.json -> live species + balance
// tables). Tests inject mon tables directly (applyErCustomMons) and assert
// registration, table writes, validation skips and idempotency.
// Run: ER_SCENARIO=1 npx vitest run test/tests/elite-redux/er-custom-mons.test.ts
import { speciesEggMoves } from "#balance/moves/egg-moves";
import { pokemonSpeciesLevelMoves } from "#balance/pokemon-level-moves";
import { speciesEggTiers } from "#balance/species-egg-tiers";
import { speciesStarterCosts } from "#balance/starters";
import { allSpecies } from "#data/data-lists";
import { applyErCustomMons } from "#data/elite-redux/init-elite-redux-custom-mons";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import type { SpeciesId } from "#enums/species-id";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";
import { afterEach, describe, expect, it, vi } from "vitest";

// Editor mons live OUTSIDE the static SpeciesId enum (runtime-extended ids).
const TEST_ID = 60042 as SpeciesId;
const BAD_STATS_ID = 60043 as SpeciesId;
const BAD_TYPE_ID = 60044 as SpeciesId;

const TEST_MON = {
  SPECIES_EDITOR_TESTCAT: {
    id: 60042,
    name: "Testcat",
    slug: "editor-testcat",
    types: ["FIRE", "FLYING"] as [string, string | null],
    baseStats: [70, 95, 60, 80, 60, 105],
    abilities: ["Blaze", "", ""],
    innates: ["Intimidate"],
    catchRate: 90,
    eggTier: 2,
    cost: 5,
    levelUpMoves: [
      { level: 1, move: "SCRATCH" },
      { level: 7, move: "EMBER" },
    ],
    eggMoves: ["FLARE_BLITZ"],
  },
};

describe("ER editor custom mons (er-custom-mons.json loader)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a valid mon as a live species with all balance tables wired", () => {
    const result = applyErCustomMons(TEST_MON);
    expect(result.registered).toBe(1);

    const species = getPokemonSpecies(TEST_ID);
    expect(species).toBeDefined();
    expect(species?.name).toBe("Testcat");
    expect(species?.type1).toBe(PokemonType.FIRE);
    expect(species?.type2).toBe(PokemonType.FLYING);
    expect(species?.baseTotal).toBe(70 + 95 + 60 + 80 + 60 + 105);
    expect(species?.catchRate).toBe(90);
    // Ability resolved by display name; empty slots are NONE-padded.
    expect(species?.ability1).toBeGreaterThan(0);

    expect((speciesEggTiers as Record<number, number>)[60042]).toBe(2);
    expect((speciesStarterCosts as Record<number, number>)[60042]).toBe(5);
    expect((pokemonSpeciesLevelMoves as Record<number, [number, number][]>)[60042]).toEqual([
      [1, MoveId.SCRATCH],
      [7, MoveId.EMBER],
    ]);
    expect((speciesEggMoves as Record<number, number[]>)[60042]).toEqual([MoveId.FLARE_BLITZ]);
  });

  it("is idempotent: a second apply reports already-present, no duplicate species", () => {
    applyErCustomMons(TEST_MON);
    const again = applyErCustomMons(TEST_MON);
    expect(again.registered).toBe(0);
    expect(again.alreadyPresent).toBe(1);
    expect(allSpecies.filter(s => s.speciesId === TEST_ID)).toHaveLength(1);
  });

  it("resolves English ability keys when the runtime English namespace is unavailable", () => {
    vi.spyOn(i18next, "t").mockReturnValue("__LOCALIZED_NOT_ENGLISH__");
    const result = applyErCustomMons({
      SPECIES_EDITOR_LOCALE_PROOF: {
        ...TEST_MON.SPECIES_EDITOR_TESTCAT,
        id: 60046,
        name: "Localeproof",
        slug: "editor-locale-proof",
      },
    });
    expect(result.registered).toBe(1);
    const species = getPokemonSpecies(60046 as SpeciesId);
    expect(species?.ability1).toBe(AbilityId.BLAZE);
    expect(species?.getPassiveAbilities()[0]).toBe(AbilityId.INTIMIDATE);
  });

  it("skips invalid entries (bad id band, bad stats, unknown type) without registering", () => {
    const result = applyErCustomMons({
      SPECIES_EDITOR_BAD_ID: { ...TEST_MON.SPECIES_EDITOR_TESTCAT, id: 10000, slug: "bad-id" },
      SPECIES_EDITOR_BAD_STATS: {
        ...TEST_MON.SPECIES_EDITOR_TESTCAT,
        id: 60043,
        slug: "bad-stats",
        baseStats: [0, 95, 60, 80, 60, 105],
      },
      SPECIES_EDITOR_BAD_TYPE: {
        ...TEST_MON.SPECIES_EDITOR_TESTCAT,
        id: 60044,
        slug: "bad-type",
        types: ["NOT_A_TYPE", null] as [string, string | null],
      },
    });
    expect(result.registered).toBe(0);
    expect(result.skippedInvalid).toBe(3);
    expect(getPokemonSpecies(BAD_STATS_ID)).toBeUndefined();
    expect(getPokemonSpecies(BAD_TYPE_ID)).toBeUndefined();
  });

  it("a mon with no resolvable level-up moves still gets a fallback move", () => {
    const result = applyErCustomMons({
      SPECIES_EDITOR_MOVELESS: {
        id: 60045,
        name: "Moveless",
        slug: "editor-moveless",
        types: ["NORMAL", null] as [string, string | null],
        baseStats: [50, 50, 50, 50, 50, 50],
        levelUpMoves: [{ level: 1, move: "NOT_A_REAL_MOVE" }],
      },
    });
    expect(result.registered).toBe(1);
    expect((pokemonSpeciesLevelMoves as Record<number, [number, number][]>)[60045]).toEqual([[1, MoveId.TACKLE]]);
  });
});
