/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER megas/primals are PERMANENT resting forms (not battle-only transforms),
// so a mega must NEVER evolve. ER added level-up evolution edges to some lines
// (Scrafty -> Scrafster, Scyther -> ..., Cascoon -> ...) whose preFormKey is
// null, so SpeciesFormEvolution.validate() skipped the form check and the edge
// fired for the MEGA form too (reported: "Mega Scrafty can evolve into
// Scrafster"). Pokemon.getValidEvolutions() now returns [] for any
// isMega()/isMax() form; the BASE form still evolves.
//
// Gated behind ER_SCENARIO=1 (the Scrafster edge is registered by ER init).
// =============================================================================

import { pokemonEvolutions } from "#balance/pokemon-evolutions";
import { ErSpeciesId } from "#enums/er-species-id";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER mega/primal forms cannot evolve", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").enemySpecies(SpeciesId.MAGIKARP);
  });

  it("Mega Scrafty does NOT offer Scrafster (but base Scrafty does)", async () => {
    await game.classicMode.startBattle(SpeciesId.SCRAFTY);
    const scrafty = game.field.getPlayerPokemon();

    // Sanity: the ER Scrafster level edge is registered on the base line.
    const edges = pokemonEvolutions[SpeciesId.SCRAFTY] ?? [];
    const scrafsterEdge = edges.find(e => e.speciesId === (ErSpeciesId.SCRAFSTER as unknown as SpeciesId));
    expect(scrafsterEdge, "expected a Scrafty -> Scrafster evolution edge from ER init").toBeDefined();

    // Base form, above the edge's level requirement: the choice IS offered.
    scrafty.formIndex = 0;
    scrafty.level = Math.max(scrafty.level, (scrafsterEdge!.level ?? 1) + 1);
    const baseEvos = scrafty.getValidEvolutions();
    expect(baseEvos.some(e => e.speciesId === (ErSpeciesId.SCRAFSTER as unknown as SpeciesId))).toBe(true);

    // Same mon in its MEGA resting form: getValidEvolutions is empty (the gate).
    const megaIdx = scrafty.species.forms.findIndex(f => f.formKey === SpeciesFormKey.MEGA);
    expect(megaIdx, "expected Scrafty to have a mega form").toBeGreaterThanOrEqual(0);
    scrafty.formIndex = megaIdx;
    expect(scrafty.isMega()).toBe(true);
    expect(scrafty.getValidEvolutions()).toHaveLength(0);
  });
});
