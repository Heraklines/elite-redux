/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression: Unown REVELATION must never hatch from eggs (live report).
// The Revelation school form is an ER-injected BATTLE-ONLY form appended to
// vanilla Unown's 28 letter forms (it is reached via the Revelation ability's
// schooling transform, like Wishiwashi School). It is constructed with
// isUnobtainable = true, but getRandomObtainableFormIndex() - the roller used
// for Unown egg hatches AND wild spawns - filtered only by formKey regex
// (mega/primal/gmax/...) and ignored the flag, so 1-in-29 Unown hatches came
// out as a resting Revelation. The roller now skips isUnobtainable forms.
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allSpecies } from "#data/data-lists";
import { Egg } from "#data/egg";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Unown Revelation never hatches from eggs", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.importData("./test/utils/saves/everything.prsv");
  });

  it("the injected Revelation form exists and is flagged unobtainable", () => {
    const unown = getPokemonSpecies(SpeciesId.UNOWN);
    const revelation = unown.forms.find(f => f.formKey === "revelation");
    expect(revelation).toBeTruthy();
    expect(revelation!.isUnobtainable).toBe(true);
  });

  it("the random obtainable-form roller never lands on an unobtainable form", () => {
    const unown = getPokemonSpecies(SpeciesId.UNOWN);
    for (let i = 0; i < 300; i++) {
      const formIndex = game.scene.getRandomObtainableFormIndex(unown);
      expect(unown.forms[formIndex]?.isUnobtainable).not.toBe(true);
      expect(unown.forms[formIndex]?.formKey).not.toBe("revelation");
    }
  });

  it("END TO END: Unown eggs hatch letter forms only, never Revelation", () => {
    for (let i = 0; i < 60; i++) {
      const hatched = new Egg({ scene: game.scene, id: i + 1, species: SpeciesId.UNOWN }).generatePlayerPokemon();
      expect(hatched.species.speciesId).toBe(SpeciesId.UNOWN);
      expect(hatched.species.forms[hatched.formIndex]?.formKey).not.toBe("revelation");
      hatched.destroy();
    }
  });

  it("no other species carries a rollable unobtainable form (sweep)", () => {
    // Any vanilla species with an ER-injected unobtainable form must survive
    // the same roller. Cheap sweep: the roller's candidate list must exclude
    // every isUnobtainable form for every multi-form species.
    for (const species of allSpecies) {
      const hasObtainable = species.forms.some(f => !f.isUnobtainable);
      if (!species.forms.some(f => f.isUnobtainable) || !hasObtainable) {
        continue;
      }
      for (let i = 0; i < 30; i++) {
        const formIndex = game.scene.getRandomObtainableFormIndex(species);
        expect(species.forms[formIndex]?.isUnobtainable).not.toBe(true);
      }
    }
  });
});
