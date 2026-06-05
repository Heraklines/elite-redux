/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — battle-only forms (Mega/Primal/G-Max) must never be picked by
// the random form selector. ER appends Mega forms to some multi-form species
// (e.g. Oricorio, which goes through getSpeciesFormIndex's
// `randSeedInt(forms.length)` path), so a blind random roll could hatch/spawn a
// Mega form (reported: "Mega Oricorio from eggs"). getRandomObtainableFormIndex
// filters battle-only forms out.
// =============================================================================

import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("ER random form selection — excludes battle-only (Mega) forms (#egg-mega)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("never returns a Mega form index for Oricorio", () => {
    const oricorio = getPokemonSpecies(SpeciesId.ORICORIO);
    const megaFormIdxs = oricorio.forms
      .map((f, i) => ({ key: f.formKey ?? "", i }))
      .filter(x => /mega|primal|gmax/i.test(x.key))
      .map(x => x.i);

    // Sanity: ER actually appended a Mega form (otherwise the test proves nothing).
    expect(megaFormIdxs.length).toBeGreaterThan(0);

    for (let n = 0; n < 100; n++) {
      const idx = game.scene.getRandomObtainableFormIndex(oricorio);
      expect(megaFormIdxs).not.toContain(idx);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(oricorio.forms.length);
    }
  });
});
