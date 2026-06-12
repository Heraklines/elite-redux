/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #411 - the Weedle Redux line, end to end. The live "Kakuna Redux became a
// plain Beedrill with vanilla moves" report had two suspects:
//   1. evolution edges - VERIFIED CORRECT at runtime: `evolutions[].into` is a
//      plain 0-based index into the FULL ER_SPECIES array (1907 records;
//      beware: naive regex parses of er-species.ts drop records and fabricate
//      an off-by-one - a -1 "fix" makes Weedle Redux evolve into ITSELF).
//      These tests pin the chain so any future data regen that breaks it
//      fails CI.
//   2. learnsets - REAL BUG, fixed: in-run redux mons are vanilla species
//      wearing the "redux" FORM and read the VANILLA level-moves table.
//      installReduxFormLevelMoves now mirrors each "<X> Redux" custom's kit
//      onto pokemonFormLevelMoves[vanillaId][reduxFormIndex].
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { pokemonEvolutions } from "#balance/pokemon-evolutions";
import { pokemonFormLevelMoves, pokemonSpeciesLevelMoves } from "#balance/pokemon-level-moves";
import { allSpecies } from "#data/data-lists";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Weedle Redux line (#411)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  const idByName = (name: string) => allSpecies.find(sp => sp.speciesId >= 10000 && sp.name === name)?.speciesId;

  it("the standalone custom chain is Weedle Redux -> Kakuna Redux -> Beedrill Redux", () => {
    const weedle = idByName("Weedle Redux")!;
    const kakuna = idByName("Kakuna Redux")!;
    const beedrill = idByName("Beedrill Redux")!;
    const evos = pokemonEvolutions as Record<number, { speciesId: number; level: number }[]>;

    expect(
      evos[weedle]?.some(e => e.speciesId === kakuna && e.level === 7),
      "Weedle Redux -> Kakuna Redux@7",
    ).toBe(true);
    expect(
      evos[kakuna]?.some(e => e.speciesId === beedrill && e.level === 10),
      "Kakuna Redux -> Beedrill Redux@10",
    ).toBe(true);
    // No self-evolutions and no foreign-line targets (the off-by-one traps).
    expect(evos[weedle]?.some(e => e.speciesId === weedle)).toBe(false);
    expect(evos[kakuna]?.some(e => e.speciesId === kakuna)).toBe(false);
    const stufful = idByName("Stufful Redux")!;
    expect(evos[kakuna]?.some(e => e.speciesId === stufful)).toBe(false);
  });

  it("a redux-form Beedrill reads Beedrill Redux's learnset, not vanilla Beedrill's", () => {
    const beedrillReduxId = idByName("Beedrill Redux")!;
    const reduxFormIndex = getPokemonSpecies(SpeciesId.BEEDRILL).forms.findIndex(f => f.formKey === "redux");
    expect(reduxFormIndex).toBeGreaterThan(0);

    const formMoves = (pokemonFormLevelMoves as Record<number, Record<number, [number, number][]>>)[
      SpeciesId.BEEDRILL
    ]?.[reduxFormIndex];
    expect(formMoves, "redux form learnset installed").toBeDefined();
    // It mirrors the RDX custom species' kit exactly...
    expect(formMoves).toEqual((pokemonSpeciesLevelMoves as Record<number, [number, number][]>)[beedrillReduxId]);
    // ...and differs from vanilla Beedrill's table.
    const vanilla = (pokemonSpeciesLevelMoves as Record<number, [number, number][]>)[SpeciesId.BEEDRILL];
    expect(JSON.stringify(formMoves)).not.toBe(JSON.stringify(vanilla));
  });
});
