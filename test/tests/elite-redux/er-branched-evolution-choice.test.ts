/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER lets the player CHOOSE the evolution path when a line currently offers more
// than one valid evolution. ER appends unconditional custom targets (Gyaradeath,
// the `_Three`/`_Four`/`_Female` forms, …) alongside the vanilla evolution, so at
// the evolution level BOTH validate at once — a genuine branch.
//
// `getValidEvolutions()` must return ALL currently-valid paths (so EvolutionPhase
// can prompt), while `getEvolution()` keeps returning the first (legacy default).
// Magikarp is the canonical case: Gyarados + Gyaradeath, both @20, no item/condition.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER branched-evolution choice", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("Magikarp at evolution level exposes BOTH Gyarados and Gyaradeath as valid paths", async () => {
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);
    const karp = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.MAGIKARP), 25);

    const valid = karp.getValidEvolutions();
    const targets = valid.map(e => e.speciesId);

    // Two simultaneous, ungated paths → the player must get to choose.
    expect(valid.length).toBeGreaterThanOrEqual(2);
    expect(targets).toContain(SpeciesId.GYARADOS);
    // Gyaradeath is an ER custom; assert by name so the test is robust to its id.
    expect(valid.map(e => getPokemonSpecies(e.speciesId).name)).toContain("Gyaradeath");

    // Legacy single-pick API still returns the first candidate (no behavior change
    // for callers that only need "does it evolve").
    expect(karp.getEvolution()).toBe(valid[0]);
    expect(karp.getEvolution()!.speciesId).toBe(SpeciesId.GYARADOS);
  });

  it("a non-branched line (Bulbasaur) yields exactly one valid path — no prompt", async () => {
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);
    const bulba = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.BULBASAUR), 25);

    const valid = bulba.getValidEvolutions();
    expect(valid).toHaveLength(1);
    expect(valid[0].speciesId).toBe(SpeciesId.IVYSAUR);
  });

  it("below evolution level Magikarp has zero valid paths", async () => {
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);
    const karp = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.MAGIKARP), 5);
    expect(karp.getValidEvolutions()).toHaveLength(0);
    expect(karp.getEvolution()).toBeNull();
  });
});
